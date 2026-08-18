package com.photowall.nativevideo

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.core.content.FileProvider
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.nio.ByteBuffer

@InvokeArg
class TranscodeArgs {
    lateinit var inputPath: String
    lateinit var outputPath: String
    var audioPath: String? = null
    var duration: Double = 0.0
    var volume: Double = 0.7
    var startTime: Double = 0.0
    var endTime: Double = 0.0
    var loopAudio: Boolean = true
    var fadeIn: Double = 0.0
    var fadeOut: Double = 0.0
}

/**
 * AudioProcessor that applies a fade-in / fade-out volume envelope alongside
 * a constant peak-volume multiplier, matching the behaviour of the iOS
 * AVFoundation exporter and the ffmpeg.wasm fallback.
 */
@OptIn(UnstableApi::class)
class FadeAudioProcessor(
    private val fadeInSeconds: Float,
    private val fadeOutSeconds: Float,
    private val durationSeconds: Float,
    private val peakVolume: Float
) : BaseAudioProcessor() {

    private var samplesProcessed = 0L
    private var fadeInSamples = 0L
    private var fadeOutStartSample = 0L
    private var totalSamples = 0L

    override fun onConfigure(inputFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        val sr = inputFormat.sampleRate.coerceAtLeast(1)
        fadeInSamples = (fadeInSeconds.coerceAtLeast(0f) * sr).toLong()
        totalSamples = (durationSeconds.coerceAtLeast(0f) * sr).toLong()
        val fadeOutSamples = (fadeOutSeconds.coerceAtLeast(0f) * sr).toLong()
        fadeOutStartSample = (totalSamples - fadeOutSamples).coerceAtLeast(fadeInSamples)
        return inputFormat
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val channels = inputAudioFormat.channelCount.coerceAtLeast(1)
        val bytesPerFrame = 2 * channels // 16-bit PCM
        val remaining = inputBuffer.remaining()
        val frameCount = remaining / bytesPerFrame
        val output = replaceOutputBuffer(remaining)
        val isFloat = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT

        for (frame in 0 until frameCount) {
            val globalFrame = samplesProcessed + frame
            val gain = computeGain(globalFrame)
            for (ch in 0 until channels) {
                if (isFloat) {
                    // Should not happen in Transformer's default pipeline, but handle defensively.
                    val f = inputBuffer.float
                    output.putFloat(f * gain)
                } else {
                    val s = inputBuffer.short
                    output.putShort((s.toInt() * gain).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
                }
            }
        }
        samplesProcessed += frameCount.toLong()
        output.flip()
    }

    internal fun computeGain(frameIndex: Long): Float {
        var g = peakVolume
        if (fadeInSamples > 0 && frameIndex < fadeInSamples) {
            g *= frameIndex.toFloat() / fadeInSamples
        }
        if (totalSamples > fadeOutStartSample && frameIndex > fadeOutStartSample) {
            val remaining = (totalSamples - frameIndex).coerceAtLeast(0).toFloat()
            val fadeSpan = (totalSamples - fadeOutStartSample).coerceAtLeast(1).toFloat()
            g *= (remaining / fadeSpan).coerceIn(0f, 1f)
        }
        return g.coerceIn(0f, 1f)
    }

    override fun onReset() {
        samplesProcessed = 0
    }
}

@InvokeArg
class OpenFileArgs {
    lateinit var path: String
    var mimeType: String = "video/mp4"
}

@TauriPlugin
class NativeVideoPlugin(private val activity: Activity) : Plugin(activity) {
    private var activeTransformer: Transformer? = null
    private var activeInvoke: Invoke? = null

    /**
     * Opens a media file with the system player. Opening a plain file:// URI
     * with ACTION_VIEW is blocked by StrictMode on Android 7+, so the file is
     * exposed through the app FileProvider as a content:// URI instead.
     */
    @Command
    fun openFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenFileArgs::class.java)
            val file = java.io.File(args.path)
            if (!file.isFile) {
                invoke.reject("File to open is missing")
                return
            }
            val uri = FileProvider.getUriForFile(
                activity,
                activity.packageName + ".fileprovider",
                file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, args.mimeType.ifBlank { "video/mp4" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(intent)
            invoke.resolve()
        } catch (error: Throwable) {
            invoke.reject(error.message ?: "Unable to open file with the system player")
        }
    }

    @Command
    fun capabilities(invoke: Invoke) {
        val ret = JSObject()
        ret.put("available", true)
        ret.put("platform", "android")
        ret.put("encoder", "Android MediaCodec / Media3 Transformer")
        invoke.resolve(ret)
    }

    @OptIn(UnstableApi::class)
    @Command
    fun transcode(invoke: Invoke) {
        if (activeTransformer != null) {
            invoke.reject("A native video export is already running")
            return
        }
        val args = invoke.parseArgs(TranscodeArgs::class.java)
        val input = java.io.File(args.inputPath)
        if (!input.isFile) {
            invoke.reject("Native encoder input file is missing")
            return
        }
        val output = java.io.File(args.outputPath)
        output.parentFile?.mkdirs()
        if (output.exists()) output.delete()

        try {
            val video = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input)))
                .setRemoveAudio(true)
                .build()
            val videoSequence = EditedMediaItemSequence.Builder(video).build()

            val audioFile = args.audioPath?.let { java.io.File(it) }?.takeIf { it.isFile }
            val composition = if (audioFile != null) {
                val audioMedia = MediaItem.Builder()
                    .setUri(Uri.fromFile(audioFile))
                    .setClippingConfiguration(
                        MediaItem.ClippingConfiguration.Builder()
                            .setStartPositionMs((args.startTime.coerceAtLeast(0.0) * 1000).toLong())
                            .also { clip ->
                                if (args.endTime > args.startTime) {
                                    clip.setEndPositionMs((args.endTime * 1000).toLong())
                                }
                            }
                            .build()
                    )
                    .build()
                val peakVolume = args.volume.coerceIn(0.0, 1.0).toFloat()
                val videoDuration = if (args.duration > 0) args.duration.toFloat() else 0f
                val fadeProcessor = FadeAudioProcessor(
                    fadeInSeconds = args.fadeIn.coerceIn(0.0, 10.0).toFloat(),
                    fadeOutSeconds = args.fadeOut.coerceIn(0.0, 10.0).toFloat(),
                    durationSeconds = videoDuration,
                    peakVolume = peakVolume
                )
                val audio = EditedMediaItem.Builder(audioMedia)
                    .setRemoveVideo(true)
                    .setEffects(Effects(listOf(fadeProcessor), emptyList()))
                    .build()
                val audioSequence = EditedMediaItemSequence.Builder(audio)
                    .setIsLooping(args.loopAudio)
                    .build()
                Composition.Builder(listOf(videoSequence, audioSequence)).build()
            } else {
                Composition.Builder(listOf(videoSequence)).build()
            }

            val transformer = Transformer.Builder(activity)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        val ret = JSObject()
                        ret.put("outputPath", output.absolutePath)
                        ret.put("encoder", "Android MediaCodec H.264 / AAC")
                        activeInvoke?.resolve(ret)
                        activeInvoke = null
                        activeTransformer = null
                    }

                    override fun onError(
                        composition: Composition,
                        exportResult: ExportResult,
                        exportException: ExportException
                    ) {
                        activeInvoke?.reject(exportException.message ?: "Android native video export failed")
                        activeInvoke = null
                        activeTransformer = null
                    }
                })
                .build()
            activeInvoke = invoke
            activeTransformer = transformer
            transformer.start(composition, output.absolutePath)
        } catch (error: Throwable) {
            activeInvoke = null
            activeTransformer = null
            invoke.reject(error.message ?: "Android native video export failed")
        }
    }
}

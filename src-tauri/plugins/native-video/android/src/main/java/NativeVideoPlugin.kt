package com.photowall.nativevideo

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaCodecList
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
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
import java.io.File
import java.io.FileOutputStream
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
    /* Playback-copy mode keeps the source audio track instead of replacing it
       with a separate music file. */
    var keepAudio: Boolean = false
}

@InvokeArg
class ExtractPosterArgs {
    lateinit var inputPath: String
    lateinit var outputPath: String
    var maxDimension: Int = 1280
    /* Sample position as a fraction of the clip duration, so the JS layer can
       retry a different scene when the extracted frame comes back blank. */
    var timeFraction: Double = 0.1
}

@InvokeArg
class TranscodeFramesArgs {
    var framePaths: Array<String> = emptyArray()
    lateinit var outputPath: String
    var fps: Int = 15
    var audioPath: String? = null
    var duration: Double = 0.0
    var volume: Double = 0.7
    var startTime: Double = 0.0
    var endTime: Double = 0.0
    var loopAudio: Boolean = true
    var fadeIn: Double = 0.0
    var fadeOut: Double = 0.0
}

/** Alternates integer millisecond durations so cumulative frame time stays
 * aligned with the requested rational FPS instead of truncating every frame. */
internal fun imageFrameDurationMs(frameIndex: Int, fps: Int): Long {
    val safeFps = fps.coerceIn(1, 120)
    val start = Math.round(frameIndex * 1000.0 / safeFps)
    val end = Math.round((frameIndex + 1) * 1000.0 / safeFps)
    return (end - start).coerceAtLeast(1L)
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
        val isFloat = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
        val channels = inputAudioFormat.channelCount.coerceAtLeast(1)
        val bytesPerSample = if (isFloat) 4 else 2
        val bytesPerFrame = bytesPerSample * channels
        val remaining = inputBuffer.remaining()
        val frameCount = remaining / bytesPerFrame
        val output = replaceOutputBuffer(frameCount * bytesPerFrame)

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
        var gain = peakVolume
        if (fadeInSamples > 0 && frameIndex < fadeInSamples) {
            gain *= frameIndex.toFloat() / fadeInSamples
        }
        if (totalSamples > fadeOutStartSample && frameIndex > fadeOutStartSample) {
            val remaining = (totalSamples - frameIndex).coerceAtLeast(0).toFloat()
            val fadeSpan = (totalSamples - fadeOutStartSample).coerceAtLeast(1).toFloat()
            gain *= (remaining / fadeSpan).coerceIn(0f, 1f)
        }
        return gain.coerceIn(0f, 1f)
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

@OptIn(UnstableApi::class)
@TauriPlugin
class NativeVideoPlugin(private val activity: Activity) : Plugin(activity) {
    private var activeTransformer: Transformer? = null
    private var activeInvoke: Invoke? = null
    private var activeOutputFile: File? = null
    private var activeJobId = 0L
    private var nextJobId = 1L

    private fun clearActiveExport(deleteOutput: Boolean = false) {
        val output = activeOutputFile
        activeInvoke = null
        activeTransformer = null
        activeOutputFile = null
        activeJobId = 0L
        if (deleteOutput && output?.exists() == true) {
            runCatching { output.delete() }
        }
    }

    private fun resolveExport(jobId: Long, output: File, encoder: String) {
        if (activeJobId != jobId) return
        val pending = activeInvoke
        val ret = JSObject()
        ret.put("outputPath", output.absolutePath)
        ret.put("encoder", encoder)
        clearActiveExport(false)
        pending?.resolve(ret)
    }

    private fun rejectExport(jobId: Long, message: String, deleteOutput: Boolean = true) {
        if (activeJobId != jobId) return
        val pending = activeInvoke
        clearActiveExport(deleteOutput)
        pending?.reject(message)
    }

    /**
     * Opens a media file with the system player. Opening a plain file:// URI
     * with ACTION_VIEW is blocked by StrictMode on Android 7+, so the file is
     * exposed through the app FileProvider as a content:// URI instead.
     */
    @Command
    fun openFile(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(OpenFileArgs::class.java)
            val file = File(args.path)
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
        val h264Encoder = runCatching {
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { codec ->
                codec.isEncoder && codec.supportedTypes.any { type ->
                    type.equals(MimeTypes.VIDEO_H264, ignoreCase = true)
                }
            }
        }.getOrNull()
        ret.put("available", h264Encoder != null)
        ret.put("platform", "android")
        ret.put("encoder", h264Encoder?.name ?: "unavailable")
        ret.put("busy", activeTransformer != null)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && h264Encoder != null) {
            ret.put("hardwareAccelerated", h264Encoder.isHardwareAccelerated)
            ret.put("softwareOnly", h264Encoder.isSoftwareOnly)
        }
        invoke.resolve(ret)
    }

    @Command
    fun extractPoster(invoke: Invoke) {
        val args = invoke.parseArgs(ExtractPosterArgs::class.java)
        val input = java.io.File(args.inputPath)
        if (!input.isFile) {
            invoke.reject("Video poster input file is missing")
            return
        }
        val output = java.io.File(args.outputPath)
        output.parentFile?.mkdirs()
        val retriever = MediaMetadataRetriever()
        var sourceBitmap: Bitmap? = null
        var scaledBitmap: Bitmap? = null
        try {
            retriever.setDataSource(input.absolutePath)
            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
            val targetUs = if (durationMs > 0) {
                val fraction = args.timeFraction.coerceIn(0.0, 0.95)
                ((durationMs - 50L).coerceAtLeast(0L) * fraction).toLong() * 1000L
            } else -1L
            sourceBitmap = if (targetUs >= 0) {
                retriever.getFrameAtTime(targetUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            } else {
                retriever.frameAtTime
            }
            val bitmap = sourceBitmap ?: throw IllegalStateException("Android decoder could not extract a video frame")
            val maxDimension = args.maxDimension.coerceIn(320, 1920)
            val maxSide = maxOf(bitmap.width, bitmap.height)
            scaledBitmap = if (maxSide > maxDimension) {
                val scale = maxDimension.toFloat() / maxSide.toFloat()
                Bitmap.createScaledBitmap(
                    bitmap,
                    (bitmap.width * scale).toInt().coerceAtLeast(1),
                    (bitmap.height * scale).toInt().coerceAtLeast(1),
                    true
                )
            } else bitmap
            FileOutputStream(output).use { stream ->
                if (!scaledBitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream)) {
                    throw IllegalStateException("Android poster JPEG encode failed")
                }
            }
            val ret = JSObject()
            ret.put("outputPath", output.absolutePath)
            ret.put("width", scaledBitmap.width)
            ret.put("height", scaledBitmap.height)
            ret.put("duration", durationMs / 1000.0)
            invoke.resolve(ret)
        } catch (error: Throwable) {
            invoke.reject(error.message ?: "Android video poster extraction failed")
        } finally {
            if (scaledBitmap != null && scaledBitmap !== sourceBitmap) scaledBitmap.recycle()
            sourceBitmap?.recycle()
            retriever.release()
        }
    }

    @OptIn(UnstableApi::class)
    @Command
    fun transcodeFrames(invoke: Invoke) {
        if (activeTransformer != null) {
            invoke.reject("A native video export is already running")
            return
        }
        val args = invoke.parseArgs(TranscodeFramesArgs::class.java)
        val frameFiles = args.framePaths.map { java.io.File(it) }
        if (frameFiles.isEmpty() || frameFiles.any { !it.isFile }) {
            invoke.reject("One or more Android export frames are missing")
            return
        }
        val output = java.io.File(args.outputPath)
        output.parentFile?.mkdirs()
        if (output.exists()) output.delete()

        try {
            val fps = args.fps.coerceIn(8, 30)
            val jobId = nextJobId++
            val frameItems = frameFiles.mapIndexed { index, frame ->
                val media = MediaItem.Builder()
                    .setUri(Uri.fromFile(frame))
                    .setImageDurationMs(imageFrameDurationMs(index, fps))
                    .build()
                EditedMediaItem.Builder(media)
                    .setFrameRate(fps)
                    .build()
            }
            val videoSequence = EditedMediaItemSequence.Builder(frameItems).build()
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
                val fadeProcessor = FadeAudioProcessor(
                    fadeInSeconds = args.fadeIn.coerceIn(0.0, 10.0).toFloat(),
                    fadeOutSeconds = args.fadeOut.coerceIn(0.0, 10.0).toFloat(),
                    durationSeconds = args.duration.coerceAtLeast(0.0).toFloat(),
                    peakVolume = args.volume.coerceIn(0.0, 1.0).toFloat()
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
                        resolveExport(jobId, output, "Android Media3 image sequence / H.264")
                    }

                    override fun onError(
                        composition: Composition,
                        exportResult: ExportResult,
                        exportException: ExportException
                    ) {
                        rejectExport(jobId, exportException.message ?: "Android frame export failed")
                    }
                })
                .build()
            activeInvoke = invoke
            activeTransformer = transformer
            activeOutputFile = output
            activeJobId = jobId
            transformer.start(composition, output.absolutePath)
        } catch (error: Throwable) {
            clearActiveExport(true)
            invoke.reject(error.message ?: "Android frame export failed")
        }
    }

    @OptIn(UnstableApi::class)
    @Command
    fun transcode(invoke: Invoke) {
        if (activeTransformer != null) {
            invoke.reject("A native video export is already running")
            return
        }
        val args = invoke.parseArgs(TranscodeArgs::class.java)
        val input = File(args.inputPath)
        if (!input.isFile) {
            invoke.reject("Native encoder input file is missing")
            return
        }
        val output = File(args.outputPath)
        output.parentFile?.mkdirs()
        if (output.exists()) output.delete()

        try {
            val jobId = nextJobId++
            val video = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(input)))
                .setRemoveAudio(!(args.keepAudio && args.audioPath == null))
                .build()
            val videoSequence = EditedMediaItemSequence.Builder(video).build()

            val audioFile = args.audioPath?.let { File(it) }?.takeIf { it.isFile }
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
                        resolveExport(jobId, output, "Android MediaCodec H.264 / AAC")
                    }

                    override fun onError(
                        composition: Composition,
                        exportResult: ExportResult,
                        exportException: ExportException
                    ) {
                        rejectExport(jobId, exportException.message ?: "Android native video export failed")
                    }
                })
                .build()
            activeInvoke = invoke
            activeTransformer = transformer
            activeOutputFile = output
            activeJobId = jobId
            transformer.start(composition, output.absolutePath)
        } catch (error: Throwable) {
            clearActiveExport(true)
            invoke.reject(error.message ?: "Android native video export failed")
        }
    }

    @OptIn(UnstableApi::class)
    @Command
    fun cancelExport(invoke: Invoke) {
        activity.runOnUiThread {
            val transformer = activeTransformer
            val pending = activeInvoke
            val output = activeOutputFile
            activeTransformer = null
            activeInvoke = null
            activeOutputFile = null
            activeJobId = 0L
            try {
                transformer?.cancel()
                pending?.reject("Native video export cancelled")
                if (output?.exists() == true) runCatching { output.delete() }
                invoke.resolve()
            } catch (error: Throwable) {
                invoke.reject(error.message ?: "Unable to cancel native video export")
            }
        }
    }
}

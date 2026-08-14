package com.photowall.nativevideo

import android.app.Activity
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
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

@TauriPlugin
class ExamplePlugin(private val activity: Activity) : Plugin(activity) {
    private var activeTransformer: Transformer? = null
    private var activeInvoke: Invoke? = null

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
                            .setEndPositionMs((args.endTime.coerceAtLeast(args.startTime + 0.05) * 1000).toLong())
                            .build()
                    )
                    .build()
                val volumeProcessor = ChannelMixingAudioProcessor()
                for (channels in 1..6) {
                    volumeProcessor.putChannelMixingMatrix(
                        ChannelMixingMatrix.create(channels, channels)
                            .scaleBy(args.volume.coerceIn(0.0, 1.0).toFloat())
                    )
                }
                val audio = EditedMediaItem.Builder(audioMedia)
                    .setRemoveVideo(true)
                    .setEffects(Effects(listOf(volumeProcessor), emptyList()))
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

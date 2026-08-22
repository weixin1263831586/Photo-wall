package com.photowall.nativevideo

import org.junit.Test

import org.junit.Assert.*

/**
 * Unit tests for the native video plugin's audio fade gain computation.
 */
class NativeVideoPluginTest {

    @Test
    fun imageFrameDurations_doNotAccumulateFpsDrift() {
        val oneMinuteAt15Fps = (0 until 900).sumOf { imageFrameDurationMs(it, 15) }
        assertEquals(60_000L, oneMinuteAt15Fps)
        assertTrue(imageFrameDurationMs(0, 15) in 66L..67L)
        assertTrue(imageFrameDurationMs(1, 15) in 66L..67L)
    }

    @Test
    fun fade_gain_isZeroAtFadeInStart() {
        val processor = FadeAudioProcessor(
            fadeInSeconds = 1.0f,
            fadeOutSeconds = 1.0f,
            durationSeconds = 10.0f,
            peakVolume = 1.0f
        )
        processor.configure(androidx.media3.common.audio.AudioProcessor.AudioFormat(
            /* sampleRate= */ 44100, /* channelCount= */ 2,
            /* encoding= */ androidx.media3.common.C.ENCODING_PCM_16BIT
        ))
        assertEquals(0f, processor.computeGain(0), 0.001f)
    }

    @Test
    fun fade_gain_reachesPeakAfterFadeIn() {
        val sr = 44100
        val fadeIn = 1.0f
        val processor = FadeAudioProcessor(fadeIn, 1.0f, 10.0f, 0.7f)
        processor.configure(androidx.media3.common.audio.AudioProcessor.AudioFormat(
            sr, 2, androidx.media3.common.C.ENCODING_PCM_16BIT
        ))
        val fadeInSamples = (fadeIn * sr).toLong()
        assertEquals(0.7f, processor.computeGain(fadeInSamples), 0.01f)
    }

    @Test
    fun fade_gain_isZeroAtEndOfFadeOut() {
        val sr = 44100
        val duration = 10.0f
        val processor = FadeAudioProcessor(1.0f, 1.0f, duration, 1.0f)
        processor.configure(androidx.media3.common.audio.AudioProcessor.AudioFormat(
            sr, 2, androidx.media3.common.C.ENCODING_PCM_16BIT
        ))
        val totalSamples = (duration * sr).toLong()
        assertEquals(0f, processor.computeGain(totalSamples), 0.001f)
    }
}

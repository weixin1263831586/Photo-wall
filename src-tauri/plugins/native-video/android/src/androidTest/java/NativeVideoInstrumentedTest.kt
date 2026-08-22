package com.photowall.nativevideo

import android.media.MediaCodecList
import androidx.core.content.FileProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4

import org.junit.Test
import org.junit.runner.RunWith

import org.junit.Assert.*

/**
 * Instrumented test, which will execute on an Android device.
 *
 * Verifies the app context is accessible for the native-video plugin.
 */
@RunWith(AndroidJUnit4::class)
class NativeVideoInstrumentedTest {
    @Test
    fun useAppContext() {
        // Library instrumentation runs against Gradle's generated test host,
        // not the final Tauri application id.
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("com.photowall.nativevideo.test", appContext.packageName)
        assertTrue(appContext.cacheDir.isDirectory)
    }

    @Test
    fun deviceHasAnH264Encoder() {
        val encoder = MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.firstOrNull { codec ->
            codec.isEncoder && codec.supportedTypes.any { type ->
                type.equals("video/avc", ignoreCase = true)
            }
        }
        assertNotNull("The product requires an AVC/H.264 encoder", encoder)
    }

    @Test
    fun fileProviderCanShareAnAppCacheVideo() {
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        val video = java.io.File(appContext.cacheDir, "provider-test.mp4")
        video.writeBytes(byteArrayOf(0, 0, 0, 0))
        try {
            val uri = FileProvider.getUriForFile(
                appContext,
                appContext.packageName + ".fileprovider",
                video
            )
            assertEquals("content", uri.scheme)
            assertEquals(appContext.packageName + ".fileprovider", uri.authority)
        } finally {
            video.delete()
        }
    }
}

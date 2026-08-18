package com.photowall.nativevideo

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
        // Context of the app under test.
        val appContext = InstrumentationRegistry.getInstrumentation().targetContext
        assertEquals("com.photowall.studio", appContext.packageName)
    }
}

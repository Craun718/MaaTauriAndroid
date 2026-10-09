package top.natsuu.mta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EyeProtectionDetectorTest {
    @Test
    fun `reports the first enabled vendor setting`() {
        val source = EyeProtectionDetector.detect(
            secure = { it == "night_display_activated" },
            system = { false },
            global = { false },
            nightDisplayService = { false },
        )

        assertEquals("aosp:night_display_activated", source)
    }

    @Test
    fun `checks the samsung and oppo fallback keys`() {
        assertEquals(
            "samsung:blue_light_filter",
            EyeProtectionDetector.detect(
                secure = { false },
                system = { false },
                global = { it == "blue_light_filter" },
                nightDisplayService = { false },
            ),
        )
        assertEquals(
            "oppo:coloros_eyeprotect_enable",
            EyeProtectionDetector.detect(
                secure = { false },
                system = { it == "eyeprotect_enable" },
                global = { false },
                nightDisplayService = { false },
            ),
        )
    }

    @Test
    fun `falls back to the color display service`() {
        val source = EyeProtectionDetector.detect(
            secure = { false },
            system = { false },
            global = { false },
            nightDisplayService = { true },
        )

        assertEquals("color_display:isNightDisplayActivated", source)
    }

    @Test
    fun `returns null when no setting is enabled`() {
        assertNull(
            EyeProtectionDetector.detect(
                secure = { false },
                system = { false },
                global = { false },
                nightDisplayService = { false },
            ),
        )
    }
}

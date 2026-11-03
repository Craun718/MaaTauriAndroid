package top.natsuu.mta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutoStartResolutionTest {
    @Test
    fun `an OEM page wins over the app-details fallback`() {
        assertEquals(
            AutoStartTarget.Oem("xiaomi"),
            AutoStartResolution.select(listOf("xiaomi"), false),
        )
    }

    @Test
    fun `restrictive manufacturers still get app details when no page resolves`() {
        assertEquals(
            AutoStartTarget.AppDetails,
            AutoStartResolution.select(emptyList(), true),
        )
    }

    @Test
    fun `unknown manufacturers without a page are not guided`() {
        assertNull(AutoStartResolution.select(emptyList(), false))
    }
}

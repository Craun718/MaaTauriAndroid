package top.natsuu.mta

import org.junit.Assert.*
import org.junit.Test

class AdbInputSettingsTest {
    @Test
    fun detectionDoesNotTreatUnknownPropertiesOrOtherRomsAsDisabled() {
        assertFalse(AdbInputSettings.needsWarning(true, null))
        assertFalse(AdbInputSettings.needsWarning(false, "0"))
        assertFalse(AdbInputSettings.needsWarning(true, "1"))
        assertTrue(AdbInputSettings.needsWarning(true, "0"))
    }

    @Test
    fun rootPrecheckSkipsWritesWhenEnabledOrUnknown() {
        assertTrue(AdbInputSettings.repair({ "1" }, { fail("must not write"); false }))
        assertFalse(AdbInputSettings.repair({ null }, { fail("must not write"); false }))
    }

    @Test
    fun repairNeedsSuccessfulWriteAndIndependentReadback() {
        var enabled = false
        assertTrue(AdbInputSettings.repair({ if (enabled) "1" else "0" }, { enabled = true; true }))
        assertFalse(AdbInputSettings.repair({ "0" }, { true }))
        assertFalse(AdbInputSettings.repair({ "0" }, { false }))
    }
}

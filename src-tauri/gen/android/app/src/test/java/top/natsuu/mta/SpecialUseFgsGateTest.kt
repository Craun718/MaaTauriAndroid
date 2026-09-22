package top.natsuu.mta

import android.os.Build
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpecialUseFgsGateTest {
    @Test
    fun olderVersionsDoNotRequireSpecialUseChecks() {
        assertTrue(SpecialUseFgsGate.canStart(Build.VERSION_CODES.TIRAMISU, false, false))
    }

    @Test
    fun newerVersionsRequirePermissionAndServiceType() {
        assertTrue(
            SpecialUseFgsGate.canStart(
                Build.VERSION_CODES.UPSIDE_DOWN_CAKE,
                true,
                true,
            ),
        )
        assertFalse(
            SpecialUseFgsGate.canStart(
                Build.VERSION_CODES.UPSIDE_DOWN_CAKE,
                true,
                false,
            ),
        )
    }
}

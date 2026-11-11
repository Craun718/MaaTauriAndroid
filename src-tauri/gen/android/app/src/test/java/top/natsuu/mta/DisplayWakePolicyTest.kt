package top.natsuu.mta

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplayWakePolicyTest {
    @Test fun idleBackgroundDisplayAllowsSleep() {
        assertFalse(shouldKeepDisplayAwake(true, false, false, true, false))
        assertFalse(shouldKeepDisplayAwake(true, false, true, false, false))
    }
    @Test fun activeUseKeepsDisplayAwake() {
        assertTrue(shouldKeepDisplayAwake(true, true, false, false, false))
        assertTrue(shouldKeepDisplayAwake(true, false, true, true, false))
        assertTrue(shouldKeepDisplayAwake(true, false, false, false, true))
    }
    @Test fun disconnectedDisplayNeverHoldsALock() {
        assertFalse(shouldKeepDisplayAwake(false, true, true, true, true))
    }
}

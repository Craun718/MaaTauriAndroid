package top.natsuu.mta.control

import org.junit.Assert.*
import org.junit.Test

class RecentsExclusionPolicyTest {
    @Test
    fun onlyAndroid17TasksOnTheControlledVirtualDisplayAreClaimed() {
        val policy = RecentsExclusionPolicy()
        assertFalse(policy.claim(36, 5, 5, 1))
        assertFalse(policy.claim(37, 0, 0, 1))
        assertFalse(policy.claim(37, 5, 0, 1))
        assertFalse(policy.claim(37, 5, null, 1))
        assertTrue(policy.claim(37, 5, 5, 1))
        assertFalse(policy.claim(37, 5, 5, 1))
        assertTrue(policy.claim(37, 5, 5, 2))
    }
}

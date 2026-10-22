package top.natsuu.mta.control

import org.junit.Assert.*
import org.junit.Test

class VirtualDisplayPolicyTest {
    @Test fun flagsAreGatedBySdkAndKeepTheExistingBase() {
        val base = VirtualDisplayPolicy.tiers(32).single()
        assertTrue(base and (1 shl 1) != 0) // PRESENTATION is intentionally retained.
        for (sdk in listOf(33, 34, 35, 36)) {
            val tiers = VirtualDisplayPolicy.tiers(sdk)
            assertEquals(2, tiers.size)
            assertEquals(base, tiers.last() and base)
            for (bit in listOf(10, 11, 12, 14, 15, 16)) assertEquals(0, tiers.last() and (1 shl bit))
            assertTrue(tiers.first() and (1 shl 10) != 0)
            assertEquals(sdk >= 34, tiers.first() and (1 shl 14) != 0)
        }
    }

    @Test fun firstSuccessWinsAndOnlySecurityErrorsRetry() {
        val tried = mutableListOf<Int>()
        val success = VirtualDisplayPolicy.create(34, { _, _ -> fail("unexpected fallback") }) { tried += it; "ok" }
        assertEquals(0 to "ok", success)
        assertEquals(1, tried.size)
        tried.clear()
        val fallback = VirtualDisplayPolicy.create(34, { _, _ -> }) {
            tried += it
            if (tried.size == 1) throw SecurityException("denied")
            "compatible"
        }
        assertEquals(1 to "compatible", fallback)
        assertEquals(2, tried.size)
        tried.clear()
        val failure = runCatching {
            VirtualDisplayPolicy.create(34, { _, _ -> fail("must not retry") }) {
                tried += it
                throw IllegalStateException("surface lost")
            }
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals(1, tried.size)
    }

    @Test fun finalDenialPropagatesOnEverySdk() {
        for (sdk in listOf(32, 33, 34)) {
            var attempts = 0
            val failure = runCatching {
                VirtualDisplayPolicy.create(sdk, { _, _ -> }) { attempts++; throw SecurityException("denied") }
            }.exceptionOrNull()
            assertTrue(failure is SecurityException)
            assertEquals(VirtualDisplayPolicy.tiers(sdk).size, attempts)
        }
    }
}

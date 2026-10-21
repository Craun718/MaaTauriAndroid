package top.natsuu.mta

import org.junit.Assert.*
import org.junit.Test

class RunServiceLeaseTest {
    @Test
    fun aRestartedProcessCannotClaimAnOldRun() {
        val original = RunServiceLease().begin()
        val restarted = RunServiceLease()
        assertEquals(0L, restarted.current())
        assertFalse(restarted.finish(original))
    }

    @Test
    fun oldServiceDestructionCannotClearTheNewRun() {
        val lease = RunServiceLease()
        val old = lease.begin()
        val current = lease.begin()
        assertFalse(lease.finish(old))
        assertEquals(current, lease.current())
        assertTrue(lease.finish(current))
        assertEquals(0L, lease.current())
    }

    @Test
    fun cancellationRejectsPendingStartsButAllowsBoundServiceCleanup() {
        val lease = RunServiceLease()
        val token = lease.begin()
        lease.cancel()
        assertEquals(0L, lease.current())
        assertTrue(lease.finish(token))
        assertFalse(lease.finish(0))
    }
}

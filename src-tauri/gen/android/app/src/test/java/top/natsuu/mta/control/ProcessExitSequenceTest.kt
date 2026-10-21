package top.natsuu.mta.control

import org.junit.Assert.*
import org.junit.Test

class ProcessExitSequenceTest {
    @Test
    fun armsBeforeCleanupAndOnlyCleansOnce() {
        val events = mutableListOf<String>()
        val exit = ProcessExitSequence(
            arm = { events += "armed"; ({ events += "cancelled"; Unit }) },
            halt = { events += "halt:$it" },
        )
        exit.exit { events += "cleanup" }
        exit.exit { fail("duplicate cleanup") }
        assertEquals(listOf("armed", "cleanup", "cancelled", "halt:0"), events)
    }

    @Test
    fun deadlineCanTerminateWhileCleanupHasNotReturned() {
        var expire: (() -> Unit)? = null
        val halted = mutableListOf<Int>()
        val exit = ProcessExitSequence(arm = { expire = it; ({}) }, halt = { halted += it })
        exit.exit { expire!!.invoke(); assertEquals(listOf(1), halted) }
        assertEquals(listOf(1, 0), halted)
    }

    @Test
    fun cleanupFailureStillTerminates() {
        var halted = false
        val exit = ProcessExitSequence(arm = { ({}) }, halt = { halted = true })
        try { exit.exit { error("cleanup failed") } } catch (_: IllegalStateException) { }
        assertTrue(halted)
    }
}

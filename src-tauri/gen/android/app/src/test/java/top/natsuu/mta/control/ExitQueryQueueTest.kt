package top.natsuu.mta.control

import org.junit.Assert.*
import org.junit.Test

class ExitQueryQueueTest {
    @Test
    fun deathBypassesPollingThrottleAndBlockedReadsReceiveOneFollowup() {
        val jobs = ArrayDeque<() -> Unit>()
        var reads = 0
        lateinit var queue: ExitQueryQueue
        queue = ExitQueryQueue(now = { 100L }, enqueue = { jobs.addLast(it) }, query = {
            reads++
            if (reads == 1) {
                queue.record(it, urgent = true)
                queue.record(it, urgent = true)
            }
        })
        queue.record("game")
        queue.record("game")
        assertEquals(1, jobs.size)
        jobs.removeFirst().invoke()
        assertEquals(1, jobs.size)
        jobs.removeFirst().invoke()
        assertEquals(2, reads)
        queue.record("game")
        assertTrue(jobs.isEmpty())
        queue.record("game", urgent = true)
        assertEquals(1, jobs.size)
    }
}

package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 死亡记录只在换了进程、且没隔太久时才值得翻日志。 */
class ServiceDeathForensicsTest {
    private fun pending(pid: Int?, diedAtMs: Long) =
        PendingServiceDeath(reason = "disconnected", diedAtMs = diedAtMs, pid = pid)

    @Test
    fun acceptsADifferentProcessWithinTheAgeLimit() {
        val death = pending(pid = 1000, diedAtMs = 10_000)
        assertEquals(death, ServiceDeathForensicsLogic.accepted(death, connectedPid = 2000, nowMs = 20_000))
    }

    // 同一个 pid 说明它没死（进程被替换也会报死亡）
    @Test
    fun rejectsTheSameProcess() {
        val death = pending(pid = 1000, diedAtMs = 10_000)
        assertNull(ServiceDeathForensicsLogic.accepted(death, connectedPid = 1000, nowMs = 20_000))
    }

    @Test
    fun rejectsWhenThereIsNothingToAttributeOrNoPid() {
        assertNull(ServiceDeathForensicsLogic.accepted(null, connectedPid = 2000, nowMs = 20_000))
        assertNull(
            ServiceDeathForensicsLogic.accepted(
                pending(pid = null, diedAtMs = 10_000),
                connectedPid = 2000,
                nowMs = 20_000,
            ),
        )
        assertNull(
            ServiceDeathForensicsLogic.accepted(
                pending(pid = 1000, diedAtMs = 10_000),
                connectedPid = null,
                nowMs = 20_000,
            ),
        )
    }

    @Test
    fun rejectsAStaleRecord() {
        val death = pending(pid = 1000, diedAtMs = 10_000)
        assertNull(
            ServiceDeathForensicsLogic.accepted(
                death,
                connectedPid = 2000,
                nowMs = 10_000 + ServiceDeathForensics.MAX_AGE_MS + 1,
            ),
        )
    }
}

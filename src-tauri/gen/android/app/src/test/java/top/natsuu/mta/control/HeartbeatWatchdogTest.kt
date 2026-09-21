package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class HeartbeatWatchdogTest {

    @Test
    fun `ignores non-positive pids even when every probe reports the owner gone`() {
        val fired = CountDownLatch(1)
        val watchdog = HeartbeatWatchdog(
            intervalMs = 10,
            processAlive = { false },
            onOwnerGone = { fired.countDown() },
        )

        watchdog.heartbeat(0)
        watchdog.start()

        // Without a pid the watchdog must stay idle no matter what the probe
        // says; a paused loop can only delay it, never fabricate a firing.
        Thread.sleep(150)
        assertEquals(1, fired.count)

        watchdog.stop()
    }

    @Test
    fun `stays quiet while the app process is alive`() {
        val fired = CountDownLatch(1)
        val watchdog = HeartbeatWatchdog(
            intervalMs = 10,
            processAlive = { true },
            onOwnerGone = { fired.countDown() },
        )

        watchdog.heartbeat(4321)
        watchdog.start()

        Thread.sleep(150)
        assertEquals(1, fired.count)

        watchdog.stop()
    }

    @Test
    fun `fires exactly once with the reported pid when the app process disappears`() {
        val fired = CountDownLatch(1)
        val fireCount = AtomicInteger(0)
        val reportedPid = AtomicInteger(0)
        val watchdog = HeartbeatWatchdog(
            intervalMs = 10,
            processAlive = { false },
            onOwnerGone = { pid ->
                reportedPid.set(pid)
                fireCount.incrementAndGet()
                fired.countDown()
            },
        )

        watchdog.heartbeat(4321)
        watchdog.start()

        assertTrue(fired.await(5, TimeUnit.SECONDS))
        // Leave a (buggy) second firing time to surface before asserting.
        Thread.sleep(100)
        assertEquals(1, fireCount.get())
        assertEquals(4321, reportedPid.get())
    }

    @Test
    fun `stop keeps a later disappearance from firing`() {
        val fired = CountDownLatch(1)
        val watchdog = HeartbeatWatchdog(
            intervalMs = 10,
            processAlive = { false },
            onOwnerGone = { fired.countDown() },
        )

        watchdog.stop()
        watchdog.heartbeat(4321)
        watchdog.start()

        Thread.sleep(150)
        assertEquals(1, fired.count)
    }
}

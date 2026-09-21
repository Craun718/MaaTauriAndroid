package top.natsuu.mta.control

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Fallback owner watchdog inside the privileged process (MaaFwApp's heartbeat
 * pattern): linkToDeath on the owner token is the primary app-death signal,
 * but the recipient only exists once the app registered its token. The app
 * reports its pid via [heartbeat]; this loop polls the process and reports the
 * owner as gone when it disappears, covering the window where no death
 * recipient is registered yet.
 */
internal class HeartbeatWatchdog(
    private val intervalMs: Long,
    private val processAlive: (Int) -> Boolean,
    private val onOwnerGone: (Int) -> Unit,
) {
    private val appPid = AtomicInteger(0)
    private val stopped = AtomicBoolean(false)

    /** Records the app pid; non-positive values are ignored. */
    fun heartbeat(pid: Int) {
        if (pid > 0) {
            appPid.set(pid)
        }
    }

    fun start() {
        Thread {
            while (!stopped.get()) {
                try {
                    Thread.sleep(intervalMs)
                } catch (_: InterruptedException) {
                    return@Thread
                }
                val pid = appPid.get()
                if (pid <= 0 || processAlive(pid)) continue
                // Latch before reacting so the callback runs exactly once even
                // if a concurrent stop() races the probe.
                if (!stopped.compareAndSet(false, true)) return@Thread
                onOwnerGone(pid)
                return@Thread
            }
        }.apply {
            name = "maa-control-heartbeat-watchdog"
            isDaemon = true
        }.start()
    }

    fun stop() {
        stopped.set(true)
    }
}

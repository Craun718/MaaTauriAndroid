package top.natsuu.mta.control

import java.util.concurrent.atomic.AtomicBoolean

/** Arms an independent deadline before entering cleanup, which may block indefinitely. */
internal class ProcessExitSequence(
    private val arm: (() -> Unit) -> (() -> Unit) = { expired ->
        val deadline = Thread({
            try {
                Thread.sleep(5_000L)
                expired()
            } catch (_: InterruptedException) { }
        }, "mta-exit-deadline").apply { isDaemon = true; start() }
        val cancel: () -> Unit = { deadline.interrupt() }
        cancel
    },
    private val halt: (Int) -> Unit = { Runtime.getRuntime().halt(it) },
) {
    private val started = AtomicBoolean(false)

    fun exit(cleanup: () -> Unit) {
        if (!started.compareAndSet(false, true)) return
        val cancel = arm { halt(1) }
        try {
            cleanup()
        } finally {
            cancel()
            halt(0)
        }
    }
}

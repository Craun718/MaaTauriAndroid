package top.natsuu.mta

import android.os.SystemClock
import android.util.Log
import java.util.concurrent.atomic.AtomicLong

object StartupTrace {
    private const val TAG = "MaaStartup"
    private val startedAtMillis = AtomicLong(0)

    fun start() {
        startedAtMillis.compareAndSet(0, SystemClock.uptimeMillis())
        mark("application_start")
    }

    fun mark(stage: String) {
        val startedAt = startedAtMillis.get()
        if (startedAt == 0L) return
        val elapsed = SystemClock.uptimeMillis() - startedAt
        Log.i(TAG, "startup stage=$stage elapsed_ms=$elapsed")
    }
}

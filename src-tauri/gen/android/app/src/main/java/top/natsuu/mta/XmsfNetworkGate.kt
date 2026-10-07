package top.natsuu.mta

import android.content.Context
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import top.natsuu.mta.control.ControlHost

/**
 * Holds the privileged XMSF network block for the lifetime of a HyperOS island.
 * A durable marker records an outstanding cut because netd rules outlive both
 * app and privileged-process deaths.
 */
object XmsfNetworkGate {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mta-xmsf-gate").apply { isDaemon = true }
    }
    private val lock = Any()
    private var holds = 0

    /** Binder calls and shell fallbacks run on the gate's worker. */
    fun acquire(context: Context) {
        val appContext = context.applicationContext
        val shouldApply = synchronized(lock) {
            holds++ == 0
        }
        if (!shouldApply) return
        runOnWorker { apply(appContext, enabled = false) }
    }

    /** Blocks until the queued rollback has run; callers must not be on the main thread. */
    fun release(context: Context) {
        val appContext = context.applicationContext
        val shouldApply = synchronized(lock) {
            holds <= 0 || --holds == 0
        }
        if (!shouldApply) return
        runOnWorker { apply(appContext, enabled = true) }
    }

    /**
     * A reconnected privileged process has already repaired stale rules. Reapply
     * an active hold; otherwise clear the marker if a previous release failed.
     */
    fun onPrivilegedServiceConnected(context: Context) {
        val appContext = context.applicationContext
        val active = synchronized(lock) { holds > 0 }
        executor.execute {
            if (active) {
                apply(appContext, enabled = false)
            } else if (appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean(KEY_CUT, false)
            ) {
                Log.w(TAG, "Repairing an outstanding XMSF network cut")
                apply(appContext, enabled = true)
            }
        }
    }

    private fun runOnWorker(action: () -> Unit) {
        val future: Future<*> = try {
            executor.submit(action)
        } catch (error: Exception) {
            Log.w(TAG, "Could not queue an XMSF toggle", error)
            return
        }
        try {
            future.get()
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (error: Exception) {
            Log.w(TAG, "XMSF toggle worker failed", error)
        }
    }

    private fun apply(context: Context, enabled: Boolean) {
        val service = ControlHost.current()
        if (service == null) {
            if (!enabled) markCut(context, true)
            Log.w(TAG, "XMSF toggle skipped (enabled=$enabled): service disconnected")
            return
        }

        if (!enabled) markCut(context, true)
        val result = runCatching {
            service.setXmsfNetworkingEnabled(enabled)
        }.onFailure { error ->
            Log.w(TAG, "XMSF toggle failed (enabled=$enabled)", error)
        }
        val ok = result.getOrDefault(false)
        when {
            enabled && ok -> markCut(context, false)
            enabled -> Unit
            result.isSuccess && !ok -> markCut(context, false)
        }
    }

    private fun markCut(context: Context, cut: Boolean) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_CUT, cut)
            .commit()
    }

    private const val TAG = "MTARun"
    private const val PREFS_NAME = "live_xmsf_gate"
    private const val KEY_CUT = "cut_outstanding"
}

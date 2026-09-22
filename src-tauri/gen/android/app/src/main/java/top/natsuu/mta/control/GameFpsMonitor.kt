package top.natsuu.mta.control

import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import android.os.SystemClock
import java.lang.reflect.Proxy

/**
 * Game frame rate on the virtual display, ported from MAA-Meow's GameFpsMonitor.
 *
 * Main path only: Android 13+ `IWindowManager.registerTaskFpsCallback`, where
 * SurfaceFlinger pushes a present-to-present average for the game task roughly
 * every 500 ms. Shell uid holds ACCESS_FPS_COUNTER since Android 13. When this
 * source is unavailable (API < 33, method missing) or goes stale the app side
 * falls back to the native frame counter, so no frame-count source lives here.
 */
internal object GameFpsMonitor {

    /** Returned by [currentFps] when nothing is being monitored. */
    const val UNKNOWN = -1f

    // SurfaceFlinger only dispatches while it composites, so a silent screen
    // (game crashed, loading screen with no frames) reports as 0 after this.
    private const val TASK_FPS_STALE_MS = 2_000L

    @Volatile
    private var source: TaskFpsSource? = null

    @Volatile
    private var unavailable = false

    /**
     * Binds the callback to [taskId], rebinding when the game restarted and its
     * task id changed. Once a start attempt failed for an environmental reason
     * (API level, missing method) further attempts are skipped: the app side
     * sees [UNKNOWN] and switches to its own frame-count fallback.
     */
    @Synchronized
    fun ensureStarted(taskId: Int) {
        if (unavailable) return
        val current = source
        if (current != null && current.taskId == taskId && current.started) return
        current?.stop()
        val next = TaskFpsSource(taskId)
        source = if (next.start()) next else null
        unavailable = source == null
    }

    @Synchronized
    fun stop() {
        source?.stop()
        source = null
        unavailable = false
    }

    /** [UNKNOWN] when not monitoring; 0 when the display went silent. */
    fun currentFps(): Float {
        val source = source ?: return UNKNOWN
        val fps = source.fps
        return if (SystemClock.elapsedRealtime() - source.lastReportMs > TASK_FPS_STALE_MS) {
            0f
        } else {
            fps
        }
    }

    /**
     * ITaskFpsCallback's hand-rolled Binder: the AIDL interface carries a single
     * oneway onFpsReported(float), so a hidden-class copy is unnecessary. The
     * registration needs an object implementing the framework-side interface;
     * system_server only ever calls back through asBinder → onTransact, which a
     * dynamic Proxy satisfies.
     */
    private class TaskFpsSource(val taskId: Int) {

        @Volatile
        var fps: Float = 0f
            private set

        @Volatile
        var lastReportMs: Long = 0L
            private set

        @Volatile
        var started: Boolean = false
            private set

        private val binder = object : Binder() {
            init {
                attachInterface(null, DESCRIPTOR)
            }

            override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
                if (code != TRANSACTION_ON_FPS_REPORTED) {
                    return super.onTransact(code, data, reply, flags)
                }
                data.enforceInterface(DESCRIPTOR)
                fps = data.readFloat()
                lastReportMs = SystemClock.elapsedRealtime()
                return true
            }
        }

        private val callback: Any? = runCatching {
            val iface = taskFpsCallbackClass() ?: return@runCatching null
            Proxy.newProxyInstance(iface.classLoader, arrayOf(iface)) { proxy, method, args ->
                when (method.name) {
                    "asBinder" -> binder
                    "hashCode" -> System.identityHashCode(proxy)
                    "equals" -> proxy === args?.getOrNull(0)
                    "toString" -> "TaskFps(task=$taskId)"
                    else -> null
                }
            }
        }.getOrNull()

        fun start(): Boolean {
            val callback = callback ?: return false
            val manager = windowManager() ?: return false
            val callbackClass = taskFpsCallbackClass() ?: return false
            val method = manager.javaClass.methods.firstOrNull { candidate ->
                candidate.name == "registerTaskFpsCallback" &&
                    candidate.parameterTypes.contentEquals(
                        arrayOf(Int::class.javaPrimitiveType, callbackClass),
                    )
            }
            val ok = method != null &&
                runCatching { method.invoke(manager, taskId, callback) }.isSuccess
            if (ok) {
                // Treat the registration instant as fresh so the first poll does
                // not report a stale 0 before SurfaceFlinger's first push.
                lastReportMs = SystemClock.elapsedRealtime()
                started = true
            } else {
                android.util.Log.w(TAG, "registerTaskFpsCallback failed for task=$taskId")
            }
            return ok
        }

        fun stop() {
            started = false
            val callback = callback ?: return
            val manager = windowManager() ?: return
            val callbackClass = taskFpsCallbackClass() ?: return
            val method = manager.javaClass.methods.firstOrNull { candidate ->
                candidate.name == "unregisterTaskFpsCallback" &&
                    candidate.parameterTypes.contentEquals(arrayOf(callbackClass))
            } ?: return
            runCatching { method.invoke(manager, callback) }
        }

        private fun taskFpsCallbackClass(): Class<*>? {
            return runCatching { Class.forName("android.window.ITaskFpsCallback") }.getOrNull()
        }

        private fun windowManager(): Any? {
            val binder = runCatching {
                Class.forName("android.os.ServiceManager")
                    .getDeclaredMethod("getService", String::class.java)
                    .invoke(null, "window")
            }.getOrNull() ?: return null
            return runCatching {
                val stub = Class.forName("android.view.IWindowManager\$Stub")
                stub.getMethod("asInterface", android.os.IBinder::class.java).invoke(null, binder)
            }.getOrNull()
        }

        private companion object {
            const val TAG = "MaaTauriAndroidControl"
            const val DESCRIPTOR = "android.window.ITaskFpsCallback"
            const val TRANSACTION_ON_FPS_REPORTED = IBinder.FIRST_CALL_TRANSACTION
        }
    }
}

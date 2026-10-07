package top.natsuu.mta

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/** 进度条的一个刻度：经典模板与 ProgressStyle 共用 0..[PROGRESS_MAX] 位置 */
private const val PROGRESS_MAX = 1_000

/**
 * 做完 [done] 个、正在跑下一条时再加半格；半格只是条子位置，文案仍是 done/total。
 * 与 MaaFwApp 的 progressValue 半格算法一致。
 */
private fun progressValue(done: Int, total: Int): Int {
    if (total <= 0) return 0
    val finished = done.coerceIn(0, total)
    val units = if (finished < total) finished * 2L + 1 else finished * 2L
    return (units * PROGRESS_MAX / (total * 2L)).toInt()
}

/** 通知栏进度快照；Rust 侧每个任务开始时推一帧（JSON，见 run_progress.rs） */
data class RunProgressSnapshot(
    val done: Int,
    val total: Int,
    val label: String?,
    val status: String?,
    val indeterminate: Boolean = false,
) {
    val progress: Int
        get() = progressValue(done, total)
}

class RunForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        running.set(true)
        RunNotificationFactory.ensureChannels(this)
        prepareVendorSurfaces()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        clearProgress()
        releaseVendorGate()
        stopForeground(STOP_FOREGROUND_REMOVE)
        RuntimeBridge.stopVirtualDisplay()
        super.onDestroy()
    }

    private fun startInForeground() {
        val notification = buildNotification(this, snapshot)
        runCatching {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        }.onFailure { error ->
            android.util.Log.e(TAG, "Android rejected the run foreground service", error)
            stopSelf()
        }
    }

    private fun prepareVendorSurfaces() {
        islandReady = false
        islandFloated = false
        vivoReady = false
        vivoStarted = false
        flymeReady = false
        flymeStarted = false
        islandExecutor.execute {
            val context = applicationContext
            if (HyperIslandCapability.isAvailable(context)) {
                XmsfNetworkGate.acquire(context)
                islandReady = true
                mainHandler.post { if (running.get()) publish() }
                return@execute
            }
            if (VivoAtomicNotificationCapability.isAvailable(context)) {
                vivoReady = true
                mainHandler.post { if (running.get()) publish() }
                return@execute
            }
            if (FlymeLiveNotificationCapability.isAvailable(context)) {
                flymeReady = true
                mainHandler.post { if (running.get()) publish() }
            }
        }
    }

    private fun releaseVendorGate() {
        islandReady = false
        islandFloated = false
        vivoReady = false
        vivoStarted = false
        flymeReady = false
        flymeStarted = false
        islandExecutor.execute { XmsfNetworkGate.release(applicationContext) }
    }

    companion object {
        private const val TAG = "MTARun"
        const val NOTIFICATION_ID = 1

        /** MaaFW 的进度帧一秒能来好几条，通知原地刷新按 1s 节流（对齐 MaaFwApp） */
        private const val MIN_UPDATE_INTERVAL_MS = 1_000L
        private const val VIVO_MIN_UPDATE_INTERVAL_MS = 10_000L

        private val running = AtomicBoolean(false)
        private val mainHandler = Handler(Looper.getMainLooper())

        @Volatile
        private var appContext: Context? = null

        @Volatile
        private var snapshot: RunProgressSnapshot? = null

        @Volatile
        private var lastNotifyAt = 0L

        @Volatile
        private var notifyScheduled = false

        private val islandExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mta-run-island").apply { isDaemon = true }
        }

        @Volatile
        private var islandReady = false

        @Volatile
        private var islandFloated = false

        @Volatile
        private var vivoReady = false

        @Volatile
        private var vivoStarted = false

        @Volatile
        private var flymeReady = false

        @Volatile
        private var flymeStarted = false

        private val notifyRunnable = Runnable {
            notifyScheduled = false
            publish()
        }

        val isRunning: Boolean
            get() = running.get()

        fun start(context: Context): Boolean {
            if (!SpecialUseFgsGate.canStart(context)) return false
            appContext = context.applicationContext
            // The submitter may be a scheduled run on another async worker while
            // ScheduleExecutionService checks this flag from the main thread.
            // Mark the run before Android asynchronously creates the service.
            running.set(true)
            val submitted = runCatching {
                context.startForegroundService(Intent(context, RunForegroundService::class.java))
                true
            }.onFailure { error ->
                running.set(false)
                android.util.Log.e(TAG, "Could not start the run foreground service", error)
            }.getOrDefault(false)
            return submitted
        }

        fun stop(context: Context) {
            finishVivoNotification(context)
            clearProgress()
            context.stopService(Intent(context, RunForegroundService::class.java))
        }

        /**
         * Rust 侧每个任务开始时推来的一帧进度。服务没跑、JSON 不合法都按 no-op
         * 处理——进度上报是旁路，不能反过来影响 run 本身。
         */
        @Synchronized
        fun updateProgress(context: Context, json: String): Boolean {
            if (!running.get()) return false
            val next = parseSnapshot(json) ?: return false
            snapshot = next
            return notifyThrottled(context)
        }

        /** focus 内容首行作为状态句合并进当前快照；还没有进度帧时直接丢弃 */
        @Synchronized
        fun updateStatus(context: Context, status: String): Boolean {
            if (!running.get()) return false
            val trimmed = status.trim()
            if (trimmed.isEmpty()) return false
            val current = snapshot ?: return false
            snapshot = current.copy(status = trimmed)
            return notifyThrottled(context)
        }

        /** 清掉待发的节流回调与快照，避免陈旧 label 残留到下一轮 */
        fun clearProgress() {
            mainHandler.removeCallbacks(notifyRunnable)
            notifyScheduled = false
            snapshot = null
        }

        private fun parseSnapshot(json: String): RunProgressSnapshot? = runCatching {
            val payload = JSONObject(json)
            RunProgressSnapshot(
                done = payload.optInt("done"),
                total = payload.optInt("total"),
                label = payload.optString("label").takeIf { it.isNotEmpty() },
                status = payload.optString("status").takeIf { it.isNotEmpty() },
                indeterminate = payload.optBoolean("indeterminate", false),
            )
        }.getOrNull()

        /** 1s 节流：窗口内只保留最新快照，尾随补发保证最后一个状态一定上屏 */
        private fun notifyThrottled(context: Context): Boolean {
            val now = SystemClock.elapsedRealtime()
            val interval = if (
                RunNotificationFactory.backend(context, islandReady, vivoReady, flymeReady) ==
                    RunNotificationBackend.VIVO_ATOMIC
            ) {
                VIVO_MIN_UPDATE_INTERVAL_MS
            } else {
                MIN_UPDATE_INTERVAL_MS
            }
            val wait = interval - (now - lastNotifyAt)
            if (wait > 0) {
                if (!notifyScheduled) {
                    notifyScheduled = true
                    mainHandler.postDelayed(notifyRunnable, wait)
                }
                return true
            }
            lastNotifyAt = now
            publishWith(context)
            return true
        }

        private fun publish() {
            val context = appContext ?: return
            publishWith(context)
        }

        /** 通知权限被拒时 notify 会抛 SecurityException，不能让它掀翻调用线程 */
        private fun publishWith(context: Context) {
            val state = snapshot ?: return
            val notification = buildNotification(context, state)
            runCatching {
                context.getSystemService(NotificationManager::class.java)
                    ?.notify(NOTIFICATION_ID, notification)
            }.onFailure { error ->
                android.util.Log.w(TAG, "Could not update the run progress notification", error)
            }
        }

        private fun buildNotification(context: Context, state: RunProgressSnapshot?): Notification {
            val backend = RunNotificationFactory.backend(
                context,
                islandReady,
                vivoReady,
                flymeReady,
            )
            val firstFloat = backend == RunNotificationBackend.HYPER_ISLAND && !islandFloated
            if (firstFloat) islandFloated = true
            if (
                state == null || (
                    backend != RunNotificationBackend.VIVO_ATOMIC &&
                        backend != RunNotificationBackend.FLYME_LIVE
                    )
            ) {
                return RunNotificationFactory.build(context, state, backend, firstFloat)
            }

            val firstVivo = !vivoStarted
            val firstFlyme = !flymeStarted
            val changedRecord = if (backend == RunNotificationBackend.VIVO_ATOMIC) {
                RunNotificationFactory.nextVivoChangedRecord(context)
            } else {
                0
            }
            val notification = RunNotificationFactory.build(
                context = context,
                state = state,
                backend = backend,
                firstFloat = firstFloat,
                vivoChangedRecord = changedRecord,
                firstVivo = firstVivo,
                firstFlyme = firstFlyme,
            )
            vivoStarted = vivoStarted || backend == RunNotificationBackend.VIVO_ATOMIC
            flymeStarted = flymeStarted || backend == RunNotificationBackend.FLYME_LIVE
            return notification
        }

        private fun finishVivoNotification(context: Context) {
            val state = snapshot ?: return
            if (!vivoReady || !vivoStarted) return
            val notification = RunNotificationFactory.build(
                context = context,
                state = state,
                backend = RunNotificationBackend.VIVO_ATOMIC,
                vivoChangedRecord = RunNotificationFactory.nextVivoChangedRecord(context),
                firstVivo = false,
                finishVivo = true,
            )
            runCatching {
                context.getSystemService(NotificationManager::class.java)
                    ?.notify(NOTIFICATION_ID, notification)
            }.onFailure { error ->
                android.util.Log.w(TAG, "Could not finish the vivo atomic notification", error)
            }
            vivoStarted = false
        }
    }
}

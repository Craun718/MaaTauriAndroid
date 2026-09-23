package top.natsuu.mta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
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
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        clearProgress()
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

    private fun ensureChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.run_notification_channel),
                // LOW：常驻不该出声；MIN 进不了状态栏，Live Update 也只禁 MIN
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    companion object {
        private const val TAG = "TTFlowRun"
        private const val CHANNEL_ID = "maa-run"
        private const val NOTIFICATION_ID = 1

        /** MaaFW 的进度帧一秒能来好几条，通知原地刷新按 1s 节流（对齐 MaaFwApp） */
        private const val MIN_UPDATE_INTERVAL_MS = 1_000L

        /** 与前端 `--tt-accent` 同源：亮色 teal-700，暗色 emerald-400 */
        private const val ACCENT_LIGHT = 0xFF0F766E.toInt()
        private const val ACCENT_DARK = 0xFF34D399.toInt()

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
            val wait = MIN_UPDATE_INTERVAL_MS - (now - lastNotifyAt)
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
            val contentIntent = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE,
            )
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(context.getString(R.string.run_notification_title))
                .setContentText(contentText(context, state))
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setSilent(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            if (state != null && state.total > 0) {
                builder
                    // 经典模板仍靠 setProgress，否则 Android 9–15 没有条子
                    .setProgress(state.total, state.progress, state.indeterminate)
                    // ProgressStyle 只在 36+ 生效；经 compat 设置在旧平台被忽略
                    .setStyle(progressStyle(context, state))
                    // 状态栏 chip / 锁屏卡片上的短文案
                    .setShortCriticalText(
                        context.getString(
                            R.string.run_notification_progress_fraction,
                            state.done,
                            state.total,
                        ),
                    )
                    .setRequestPromotedOngoing(canRequestPromotedOngoing(context))
            }
            return builder.build()
        }

        /** `setStyledByProgress(true)` + 单段 accent：系统按 progress 分色，done/剩余两色 */
        private fun progressStyle(
            context: Context,
            state: RunProgressSnapshot,
        ): NotificationCompat.ProgressStyle {
            val style = NotificationCompat.ProgressStyle()
                .setStyledByProgress(true)
                .setProgressIndeterminate(state.indeterminate)
                .addProgressSegment(
                    NotificationCompat.ProgressStyle.Segment(PROGRESS_MAX)
                        .setColor(accentColor(context)),
                )
            if (!state.indeterminate) {
                style.setProgress(state.progress)
            }
            return style
        }

        /** 36 以下没有实时动态开关；36+ 尊重系统里 promoted notifications 的用户开关 */
        private fun canRequestPromotedOngoing(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < 36) return true
            val manager = context.getSystemService(NotificationManager::class.java) ?: return false
            return manager.canPostPromotedNotifications()
        }

        private fun contentText(context: Context, state: RunProgressSnapshot?): String {
            if (state == null) return context.getString(R.string.run_notification_text)
            if (!state.status.isNullOrBlank()) return state.status
            if (!state.label.isNullOrBlank()) {
                return context.getString(
                    R.string.run_notification_task_progress,
                    state.label,
                    state.done,
                    state.total,
                )
            }
            return context.getString(R.string.run_notification_text)
        }

        private fun accentColor(context: Context): Int {
            val night = (context.resources.configuration.uiMode and
                Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            return if (night) ACCENT_DARK else ACCENT_LIGHT
        }
    }
}

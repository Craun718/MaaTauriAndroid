package top.natsuu.mta

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import kotlin.concurrent.thread

class ScheduleExecutionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        AppPreparationManager.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ruleId = intent?.getStringExtra(ScheduleReceiver.EXTRA_RULE_ID)
        val scheduledTimeMs = intent?.getLongExtra(
            ScheduleReceiver.EXTRA_SCHEDULED_TIME_MS,
            Long.MIN_VALUE,
        )
        if (!startInForeground(ruleId, scheduledTimeMs) || ruleId == null || scheduledTimeMs == null ||
            scheduledTimeMs == Long.MIN_VALUE
        ) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (RuntimeBridge.isAppReady()) {
            ScheduleAlarmManager.sync(this)
        }
        thread(name = "mta-schedule-execution") {
            if (!RuntimeBridge.isProjectReady()) {
                if (!ScheduleAlarmManager.isAutoStartAllowed(this@ScheduleExecutionService, ruleId)) {
                    android.util.Log.i(
                        TAG,
                        "Skipping scheduled run: auto-start is disabled for rule $ruleId",
                    )
                    stopSelf()
                    return@thread
                }
                if (!RuntimeBridge.isAppReady()) {
                    launchMainActivityToInitialize()
                }
                if (!waitForProjectReady()) {
                    android.util.Log.w(
                        TAG,
                        "The app project was not ready before the schedule timeout expired",
                    )
                    stopSelf()
                    return@thread
                }
            }
            if (!waitForEngineReady()) {
                android.util.Log.w(
                    TAG,
                    "The app engine was not ready before the scheduled run",
                )
                stopSelf()
                return@thread
            }
            if (!RuntimeBridge.connectPrivilegedService(CONNECT_TIMEOUT_MS)) {
                android.util.Log.w(
                    TAG,
                    "The privileged control service was not connected before the scheduled run",
                )
            }
            RuntimeBridge.startScheduledRun(ruleId, scheduledTimeMs)
            if (RunForegroundService.isRunning) {
                while (RunForegroundService.isRunning) {
                    Thread.sleep(1_000)
                }
            }
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun waitForProjectReady(): Boolean {
        val deadline = System.currentTimeMillis() + APP_READY_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (RuntimeBridge.isProjectReady()) return true
            if (RuntimeBridge.isPreparationFailed()) return false
            Thread.sleep(APP_READY_POLL_INTERVAL_MS)
        }
        return RuntimeBridge.isProjectReady()
    }

    private fun launchMainActivityToInitialize() {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching {
            startActivity(intent)
        }.onFailure { error ->
            android.util.Log.e(TAG, "Could not launch MainActivity for schedule initialization", error)
        }
    }

    private fun waitForEngineReady(): Boolean {
        val deadline = System.currentTimeMillis() + APP_READY_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (RuntimeBridge.isEngineReady()) return true
            if (RuntimeBridge.isPreparationFailed()) return false
            Thread.sleep(APP_READY_POLL_INTERVAL_MS)
        }
        return RuntimeBridge.isEngineReady()
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    private fun startInForeground(ruleId: String?, scheduledTimeMs: Long?): Boolean {
        if (!SpecialUseFgsGate.canStart(this, ScheduleExecutionService::class.java)) {
            if (ruleId != null && scheduledTimeMs != null && scheduledTimeMs != Long.MIN_VALUE) {
                RuntimeBridge.recordScheduleForegroundServiceDenied(ruleId, scheduledTimeMs)
            }
            return false
        }
        val notification = notification()
        return runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 34) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            true
        }.onFailure { error ->
            android.util.Log.e(TAG, "Android rejected the schedule foreground service", error)
            if (ruleId != null && scheduledTimeMs != null && scheduledTimeMs != Long.MIN_VALUE) {
                RuntimeBridge.recordScheduleForegroundServiceDenied(ruleId, scheduledTimeMs)
            }
            stopSelf()
        }.getOrDefault(false)
    }

    private fun notification() = NotificationCompat.notification(
        this,
        CHANNEL_ID,
        R.string.schedule_notification_channel,
        R.string.schedule_notification_title,
        R.string.schedule_notification_text,
    )

    companion object {
        private const val TAG = "MTASchedule"
        private const val CHANNEL_ID = "mta-schedule"
        private const val NOTIFICATION_ID = 2
        private const val CONNECT_TIMEOUT_MS = 15_000L
        private const val APP_READY_TIMEOUT_MS = 120_000L
        private const val APP_READY_POLL_INTERVAL_MS = 500L

        fun start(context: Context, ruleId: String, scheduledTimeMs: Long) {
            if (!SpecialUseFgsGate.canStart(context, ScheduleExecutionService::class.java)) {
                RuntimeBridge.recordScheduleForegroundServiceDenied(ruleId, scheduledTimeMs)
                return
            }
            runCatching {
                context.startForegroundService(
                    Intent(context, ScheduleExecutionService::class.java)
                        .putExtra(ScheduleReceiver.EXTRA_RULE_ID, ruleId)
                        .putExtra(ScheduleReceiver.EXTRA_SCHEDULED_TIME_MS, scheduledTimeMs),
                )
            }.onFailure { error ->
                android.util.Log.e(TAG, "Could not start schedule execution", error)
            }
        }
    }
}

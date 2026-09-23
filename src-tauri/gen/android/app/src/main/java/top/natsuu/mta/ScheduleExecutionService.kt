package top.natsuu.mta

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import kotlin.concurrent.thread
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

class ScheduleExecutionService : Service() {
    private lateinit var controlClient: ControlServiceClient

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        MaaRuntime.load()
        RuntimeBridge.attachContext(this)
        RuntimeBridge.initializeSecretBridge()
        PiInstaller.install(this)?.let { projectRoot ->
            RuntimeBridge.setBootstrapProjectRoot(projectRoot.absolutePath)
        }
        RuntimeBridge.configureScreen(
            resources.displayMetrics.widthPixels,
            resources.displayMetrics.heightPixels,
        )
        ControlHost.configure(
            0,
            resources.displayMetrics.widthPixels,
            resources.displayMetrics.heightPixels,
        )
        controlClient = ControlServiceClient(this)
        RuntimeBridge.attachControlClient(controlClient)
        RuntimeBridge.setPrivilegedBackend(controlClient.getSelectedPrivilegedBackend())
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
        ScheduleAlarmManager.sync(this)
        thread(name = "mta-schedule-execution") {
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

    override fun onDestroy() {
        RuntimeBridge.detachControlClient(controlClient)
        if (::controlClient.isInitialized) {
            controlClient.disconnect()
        }
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

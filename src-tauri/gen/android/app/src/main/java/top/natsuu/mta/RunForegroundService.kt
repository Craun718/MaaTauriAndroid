package top.natsuu.mta

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.util.concurrent.atomic.AtomicBoolean

class RunForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running.set(true)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running.set(false)
        RuntimeBridge.stopVirtualDisplay()
        super.onDestroy()
    }

    private fun startInForeground() {
        val notification = notification()
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

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.run_notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.run_notification_title))
            .setContentText(getString(R.string.run_notification_text))
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "maa-run"
        private const val NOTIFICATION_ID = 1
        private val running = AtomicBoolean(false)

        val isRunning: Boolean
            get() = running.get()

        fun start(context: Context): Boolean {
            if (!SpecialUseFgsGate.canStart(context)) return false
            return runCatching {
                context.startForegroundService(Intent(context, RunForegroundService::class.java))
                true
            }.onFailure { error ->
                android.util.Log.e(TAG, "Could not start the run foreground service", error)
            }.getOrDefault(false)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RunForegroundService::class.java))
        }

        private const val TAG = "TTFlowRun"
    }
}

package top.natsuu.mta

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.NotificationCompat as CoreNotificationCompat
import org.json.JSONArray
import top.natsuu.mta.control.ControlServiceClient
import kotlin.concurrent.thread

/**
 * Shizuku 没在跑就提前提醒，别等定时到点才知道。
 *
 * 只在本进程见过它活着（CONNECTED）之后又没了才算「停了」，冷启动时 binder 还没到不算。
 * 用允许 idle 的闹钟排检查而不是 sleep/delay：进程进了缓存会被冻结，定时器到不了点。
 * 只在后端选的是 Shizuku、且有启用的定时规则时才提醒。
 */
object ShizukuDownMonitor {
    private const val TAG = "MTASchedule"
    private const val NOTIFICATION_ID = 3
    private const val CHANNEL_ID = "mta-schedule-warning"
    private const val ALARM_REQUEST = 0x4D545253
    private const val CONNECT_WAIT_MS = 3_000L
    private const val BOOT_GRACE_MS = 3 * 60_000L
    private const val STOPPED_GRACE_MS = 60_000L

    /** 本进程见过 Shizuku 连着；冷启动的 binder 还没到不算 */
    @Volatile
    private var seenAlive = false

    /** 每次连上就清掉待查的提醒，迟到的闹钟只会在 check 里再确认一次。 */
    fun onConnected(context: Context) {
        seenAlive = true
        cancel(context)
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    fun onDisconnected(context: Context) {
        if (!seenAlive) return
        Log.i(TAG, "Shizuku stopped; re-checking in ${STOPPED_GRACE_MS / 1000}s")
        arm(context, STOPPED_GRACE_MS, afterBoot = false)
    }

    fun armAfterBoot(context: Context) {
        arm(context, BOOT_GRACE_MS, afterBoot = true)
    }

    /** 闹钟到点：离主线程，等 binder 连上再决定要不要提醒。 */
    fun check(context: Context, afterBoot: Boolean) {
        val appContext = context.applicationContext
        thread(name = "mta-shizuku-check") {
            runCatching { checkNow(appContext, afterBoot) }
                .onFailure { Log.w(TAG, "Shizuku down check failed", it) }
        }
    }

    private fun checkNow(context: Context, afterBoot: Boolean) {
        if (RuntimeBridge.getSelectedPrivilegedBackend() != ControlServiceClient.BACKEND_SHIZUKU) {
            return
        }
        if (enabledScheduleCount() == 0) return
        if (awaitConnected()) return
        Log.w(TAG, "Shizuku is down with enabled schedules (afterBoot=$afterBoot)")
        notifyDown(context, afterBoot)
    }

    /**
     * 闹钟拉起的冷进程 binder 可能还在路上：先踢一次连接，再等控制状态落到「已连接」。
     * 只看 [RuntimeBridge.connectPrivilegedService] 的返回值不行——准备流程还没挂上
     * client 时它直接返回 false，会被误判成 Shizuku 没在跑。
     */
    private fun awaitConnected(): Boolean {
        if (RuntimeBridge.connectPrivilegedService(CONNECT_WAIT_MS)) return true
        val deadline = SystemClock.elapsedRealtime() + CONNECT_WAIT_MS
        while (SystemClock.elapsedRealtime() < deadline) {
            if (RuntimeBridge.privilegedControlState() == ControlServiceClient.STATE_CONNECTED) {
                return true
            }
            Thread.sleep(200)
        }
        return false
    }

    private fun enabledScheduleCount(): Int = runCatching {
        val json = RuntimeBridge.scheduleRulesJson() ?: return 0
        val rules = JSONArray(json)
        (0 until rules.length()).count { index ->
            rules.optJSONObject(index)?.optBoolean("enabled") == true
        }
    }.getOrDefault(0)

    private fun notifyDown(context: Context, afterBoot: Boolean) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName(context.getString(R.string.schedule_shizuku_down_channel))
                .build(),
        )
        val notification = CoreNotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(context.getString(R.string.schedule_shizuku_down_title))
            .setContentText(
                context.getString(
                    if (afterBoot) {
                        R.string.schedule_shizuku_down_after_boot
                    } else {
                        R.string.schedule_shizuku_down_text
                    },
                ),
            )
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context))
            .build()
        runCatching { manager.notify(NOTIFICATION_ID, notification) }
    }

    private fun contentIntent(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    // 不用精确闹钟：晚几分钟提醒无妨，也不必占精确闹钟权限。
    private fun arm(context: Context, delayMs: Long, afterBoot: Boolean) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = checkIntent(context, afterBoot, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
        runCatching {
            manager.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + delayMs,
                intent,
            )
        }.onFailure { Log.w(TAG, "Could not arm the Shizuku check", it) }
    }

    private fun cancel(context: Context) {
        val manager = context.getSystemService(AlarmManager::class.java) ?: return
        val intent = checkIntent(context, false, PendingIntent.FLAG_NO_CREATE) ?: return
        manager.cancel(intent)
        intent.cancel()
    }

    // extras 不参与 PendingIntent 判等，两种检查共用一个闹钟，后排的覆盖先排的。
    private fun checkIntent(context: Context, afterBoot: Boolean, flag: Int): PendingIntent? {
        val intent = Intent(context, ShizukuCheckReceiver::class.java)
            .setAction(ShizukuCheckReceiver.ACTION_SHIZUKU_CHECK)
            .putExtra(ShizukuCheckReceiver.EXTRA_AFTER_BOOT, afterBoot)
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST,
            intent,
            flag or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

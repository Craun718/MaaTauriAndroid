package top.natsuu.mta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 闹钟拉起的 Shizuku 可用性复查，见 [ShizukuDownMonitor]。 */
class ShizukuCheckReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SHIZUKU_CHECK) return
        val afterBoot = intent.getBooleanExtra(EXTRA_AFTER_BOOT, false)
        ShizukuDownMonitor.check(context, afterBoot)
    }

    companion object {
        const val ACTION_SHIZUKU_CHECK = "top.natsuu.mta.action.SHIZUKU_CHECK"
        const val EXTRA_AFTER_BOOT = "afterBoot"
    }
}

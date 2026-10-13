package top.natsuu.mta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File

class ScheduleBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
            )
        ) {
            return
        }
        val schedules = File(context.filesDir, "schedule-alarm-state.json")
        ScheduleAlarmManager.syncFromLocalJson(context, schedules.readTextOrNull())
        // Shizuku (adb mode) is gone after a restart; give it a grace window and
        // then remind the user instead of failing at the first scheduled trigger.
        ShizukuDownMonitor.armAfterBoot(context)
    }

    private fun File.readTextOrNull(): String? = runCatching {
        if (isFile) readText() else null
    }.getOrNull()
}

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
        runCatching { ScheduleAlarmManager.syncFromLocalJson(context, schedules.readTextOrNull()) }
            .onFailure { android.util.Log.e("MTASchedule", "Could not restore schedule alarms", it) }
        // Shizuku (adb mode) is gone after a restart; give it a grace window and
        // then remind the user instead of failing at the first scheduled trigger.
        ShizukuDownMonitor.armAfterBoot(context)
    }

    private fun File.readTextOrNull(): String? = runCatching {
        android.util.AtomicFile(this).openRead().bufferedReader().use { it.readText() }
    }.getOrNull()
}

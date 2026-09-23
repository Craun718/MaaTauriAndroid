package top.natsuu.mta

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.time.Instant
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

data class ScheduledTrigger(
    val ruleId: String,
    val scheduledAtMs: Long,
) {
    companion object {
        fun fromStatus(status: JSONObject): ScheduledTrigger? {
            val ruleId = status.optString("id")
            val scheduledAtMs = status.optLong("nextTriggerEpochMs", Long.MIN_VALUE)
            if (ruleId.isEmpty() || scheduledAtMs == Long.MIN_VALUE) return null
            return ScheduledTrigger(ruleId, scheduledAtMs)
        }
    }
}

object ScheduleAlarmManager {
    private const val TAG = "MTASchedule"

    fun schedulesFromJson(json: String?, now: Instant = Instant.now()): List<ScheduledTrigger> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            val statuses = JSONArray(json)
            val triggers = mutableListOf<ScheduledTrigger>()
            for (index in 0 until statuses.length()) {
                val status = statuses.optJSONObject(index) ?: continue
                ScheduledTrigger.fromStatus(status)?.let(triggers::add)
            }
            triggers.filter { it.scheduledAtMs > now.toEpochMilli() }
        }.getOrDefault(emptyList())
    }

    fun sync(context: Context) {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        val schedules = schedulesFromJson(RuntimeBridge.scheduleRulesJson())
        val stateFile = File(context.filesDir, "schedule-alarm-state.json")
        val previousRules = schedulesFromJson(stateFile.readTextOrNull()).map { it.ruleId }
        schedules.forEach { schedule(context, alarmManager, it) }
        (previousRules - schedules.map { it.ruleId }.toSet()).forEach {
            // PendingIntent equality ignores extras, so the placeholder time is fine here.
            alarmManager.cancel(operation(context, it, 0L))
        }
        runCatching {
            stateFile.writeText(JSONArray(schedules.map { rule ->
                JSONObject().put("id", rule.ruleId)
                    .put("nextTriggerEpochMs", rule.scheduledAtMs)
            }).toString())
        }
    }

    fun syncFromLocalJson(context: Context, json: String?) {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        schedulesFromJson(json).forEach { schedule(context, alarmManager, it) }
    }

    fun cancel(context: Context, ruleId: String) {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        alarmManager.cancel(operation(context, ruleId, 0L))
    }

    private fun schedule(context: Context, alarmManager: AlarmManager, trigger: ScheduledTrigger) {
        val operation = operation(context, trigger.ruleId, trigger.scheduledAtMs)
        val canUseExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            alarmManager.canScheduleExactAlarms()
        if (canUseExact) {
            try {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    trigger.scheduledAtMs,
                    operation,
                )
                return
            } catch (error: SecurityException) {
                // Some OEM builds answer the capability check affirmatively and
                // still reject the exact set; the alarm-clock form needs no grant.
                Log.w(TAG, "Exact alarm rejected; falling back to the alarm clock", error)
            }
        }
        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(trigger.scheduledAtMs, null),
            operation,
        )
    }

    private fun operation(context: Context, ruleId: String, scheduledAtMs: Long): PendingIntent {
        val intent = Intent(context, ScheduleReceiver::class.java)
            .setAction(ScheduleReceiver.ACTION_SCHEDULE_TRIGGER)
            .putExtra(ScheduleReceiver.EXTRA_RULE_ID, ruleId)
            .putExtra(ScheduleReceiver.EXTRA_SCHEDULED_TIME_MS, scheduledAtMs)
        return PendingIntent.getBroadcast(
            context,
            requestCode(ruleId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun requestCode(ruleId: String): Int {
        return 1_000_000 + (ruleId.hashCode() and Int.MAX_VALUE) % 1_000_000_000
    }

    private fun File.readTextOrNull(): String? = runCatching {
        if (isFile) readText() else null
    }.getOrNull()
}

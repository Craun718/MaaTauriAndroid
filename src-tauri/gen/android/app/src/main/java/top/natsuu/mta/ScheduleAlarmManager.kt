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
    val autoStart: Boolean = true,
) {
    companion object {
        fun fromStatus(status: JSONObject): ScheduledTrigger? {
            val ruleId = status.optString("id")
            val scheduledAtMs = status.optLong("nextTriggerEpochMs", Long.MIN_VALUE)
            if (ruleId.isEmpty() || scheduledAtMs == Long.MIN_VALUE) return null
            val autoStart = if (status.has("autoStart")) status.optBoolean("autoStart") else true
            return ScheduledTrigger(ruleId, scheduledAtMs, autoStart)
        }
    }
}

object ScheduleAlarmManager {
    private const val TAG = "MTASchedule"

    fun allSchedulesFromJson(json: String?): List<ScheduledTrigger> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            val statuses = JSONArray(json)
            val triggers = mutableListOf<ScheduledTrigger>()
            for (index in 0 until statuses.length()) {
                val status = statuses.optJSONObject(index) ?: continue
                ScheduledTrigger.fromStatus(status)?.let(triggers::add)
            }
            triggers
        }.getOrDefault(emptyList())
    }

    fun schedulesFromJson(json: String?, now: Instant = Instant.now()): List<ScheduledTrigger> =
        allSchedulesFromJson(json).filter { it.scheduledAtMs > now.toEpochMilli() }

    private fun evidenceFile(context: Context) = File(context.filesDir, "schedule-evidence.json")

    @Synchronized
    fun markDelivered(context: Context, ruleId: String, scheduledAtMs: Long) {
        val evidence = ScheduleEvidence.read(evidenceFile(context))
        evidence.markDelivered(AlarmIdentity(ruleId, scheduledAtMs))
        writeScheduleFile(evidenceFile(context), evidence.json().toString())
    }

    @Synchronized
    fun sync(context: Context) {
        val json = RuntimeBridge.scheduleRulesJson() ?: return
        syncSchedules(context, allSchedulesFromJson(json))
    }

    private fun syncSchedules(context: Context, rules: List<ScheduledTrigger>) {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        val stateFile = File(context.filesDir, "schedule-alarm-state.json")
        val previous = allSchedulesFromJson(stateFile.readTextOrNull())
        val evidence = ScheduleEvidence.read(evidenceFile(context))
        val ids = rules.map { it.ruleId }.toSet()
        (previous.map { it.ruleId }.toSet() - ids).forEach {
            alarmManager.cancel(operation(context, it, 0L))
        }
        evidence.retainRules(ids)
        val registered = rules.filter { it.scheduledAtMs > System.currentTimeMillis() }.filter { trigger ->
            runCatching { schedule(context, alarmManager, trigger) }
                .onFailure { Log.e(TAG, "Could not register schedule ${trigger.ruleId}", it) }
                .isSuccess
        }
        evidence.armed.clear()
        evidence.armed.addAll(registered.map { AlarmIdentity(it.ruleId, it.scheduledAtMs) })
        writeScheduleFile(evidenceFile(context), evidence.json().toString())
        writeScheduleFile(stateFile, JSONArray(registered.map { rule ->
            JSONObject().put("id", rule.ruleId)
                .put("nextTriggerEpochMs", rule.scheduledAtMs)
                .put("autoStart", rule.autoStart)
        }).toString())
    }

    @Synchronized
    fun isAutoStartAllowed(context: Context, ruleId: String): Boolean =
        allSchedulesFromJson(File(context.filesDir, "schedule-alarm-state.json").readTextOrNull())
            .find { it.ruleId == ruleId }?.autoStart ?: false

    @Synchronized
    fun syncFromLocalJson(context: Context, json: String?) {
        syncSchedules(context, allSchedulesFromJson(json))
    }

    @Synchronized
    fun cancel(context: Context, ruleId: String) {
        context.getSystemService(AlarmManager::class.java)?.cancel(operation(context, ruleId, 0L))
        val evidence = ScheduleEvidence.read(evidenceFile(context))
        evidence.armed.removeAll { it.ruleId == ruleId }
        evidence.delivered.removeAll { it.ruleId == ruleId }
        writeScheduleFile(evidenceFile(context), evidence.json().toString())
        val stateFile = File(context.filesDir, "schedule-alarm-state.json")
        val remaining = allSchedulesFromJson(stateFile.readTextOrNull()).filter { it.ruleId != ruleId }
        writeScheduleFile(stateFile, JSONArray(remaining.map {
            JSONObject().put("id", it.ruleId).put("nextTriggerEpochMs", it.scheduledAtMs)
                .put("autoStart", it.autoStart)
        }).toString())
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

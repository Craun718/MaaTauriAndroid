package top.natsuu.mta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class ScheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SCHEDULE_TRIGGER) return
        val ruleId = intent.getStringExtra(EXTRA_RULE_ID)
        val scheduledTimeMs = intent.getLongExtra(EXTRA_SCHEDULED_TIME_MS, Long.MIN_VALUE)
        if (ruleId == null || scheduledTimeMs == Long.MIN_VALUE) {
            Log.w(
                TAG,
                "Ignoring malformed schedule trigger: ruleId present = ${ruleId != null}," +
                    " scheduledTimeMs present = ${intent.hasExtra(EXTRA_SCHEDULED_TIME_MS)}",
            )
            return
        }
        ScheduleExecutionService.start(context, ruleId, scheduledTimeMs)
    }

    companion object {
        private const val TAG = "MTASchedule"
        const val ACTION_SCHEDULE_TRIGGER = "top.natsuu.mta.action.SCHEDULE_TRIGGER"
        const val EXTRA_RULE_ID = "ruleId"
        const val EXTRA_SCHEDULED_TIME_MS = "scheduledTimeMs"
    }
}

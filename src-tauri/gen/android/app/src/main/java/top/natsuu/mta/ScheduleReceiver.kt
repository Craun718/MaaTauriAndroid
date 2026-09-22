package top.natsuu.mta

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ScheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SCHEDULE_TRIGGER) return
        val ruleId = intent.getStringExtra(EXTRA_RULE_ID) ?: return
        val scheduledTimeMs = intent.getLongExtra(EXTRA_SCHEDULED_TIME_MS, Long.MIN_VALUE)
        if (scheduledTimeMs == Long.MIN_VALUE) return
        ScheduleExecutionService.start(context, ruleId, scheduledTimeMs)
    }

    companion object {
        const val ACTION_SCHEDULE_TRIGGER = "top.natsuu.mta.action.SCHEDULE_TRIGGER"
        const val EXTRA_RULE_ID = "ruleId"
        const val EXTRA_SCHEDULED_TIME_MS = "scheduledTimeMs"
    }
}

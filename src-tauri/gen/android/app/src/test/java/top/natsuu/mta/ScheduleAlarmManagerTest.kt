package top.natsuu.mta

import java.time.Instant
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleAlarmManagerTest {
    @Test
    fun parsesFutureSchedulesAndIgnoresDisabledData() {
        val now = Instant.parse("2026-01-02T03:04:05Z")
        val json = JSONArray().put(
            org.json.JSONObject()
                .put("id", "daily")
                .put("nextTriggerEpochMs", now.plusSeconds(60).toEpochMilli()),
        ).put(
            org.json.JSONObject()
                .put("id", "past")
                .put("nextTriggerEpochMs", now.minusSeconds(60).toEpochMilli()),
        )

        val schedules = ScheduleAlarmManager.schedulesFromJson(json.toString(), now)

        assertEquals(listOf(ScheduledTrigger("daily", now.plusSeconds(60).toEpochMilli())), schedules)
    }

    @Test
    fun malformedJsonYieldsNoSchedules() {
        assertTrue(ScheduleAlarmManager.schedulesFromJson("{").isEmpty())
        assertTrue(ScheduleAlarmManager.schedulesFromJson(null).isEmpty())
    }

    @Test
    fun requestCodesRemainPositiveAndStable() {
        assertEquals(ScheduleAlarmManager.requestCode("rule"), ScheduleAlarmManager.requestCode("rule"))
        assertTrue(ScheduleAlarmManager.requestCode("rule") > 0)
    }
}

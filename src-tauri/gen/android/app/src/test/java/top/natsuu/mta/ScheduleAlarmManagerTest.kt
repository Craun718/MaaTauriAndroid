package top.natsuu.mta

import java.time.Instant
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleAlarmManagerTest {
    @Test
    fun evidenceRoundTripsPendingReportsAndActualAlarmMode() {
        val identity = AlarmIdentity("daily", 1000L)
        val evidence = ScheduleEvidence(alarmMode = "alarmClock")
        evidence.missed[identity] = true
        val restored = ScheduleEvidence.parse(evidence.json().toString())
        assertEquals("alarmClock", restored.alarmMode)
        assertEquals(true, restored.missed[identity])
    }

    @Test
    fun failedRegistrationDoesNotLeaveAnArmedFutureSlot() {
        val identity = AlarmIdentity("daily", 1000L)
        val evidence = ScheduleEvidence(armed = mutableListOf(identity))
        evidence.replaceArmed(emptyList(), 999L)
        evidence.collectMissed(1001L + ScheduleEvidence.GRACE_MS, 0L)
        assertTrue(evidence.armed.isEmpty())
        assertTrue(evidence.missed.isEmpty())
    }

    @Test
    fun recentlyExpiredSlotsSurviveRearmingAndBecomeMissedAfterGrace() {
        val previous = AlarmIdentity("daily", 1000L)
        val next = AlarmIdentity("daily", 1000L + 86_400_000L)
        val evidence = ScheduleEvidence(armed = mutableListOf(previous))
        evidence.collectMissed(2000L, 0L)
        evidence.replaceArmed(listOf(next), 2000L)
        assertTrue(previous in evidence.armed)
        evidence.collectMissed(1001L + ScheduleEvidence.GRACE_MS, 0L)
        assertEquals(false, evidence.missed[previous])
        evidence.replaceArmed(listOf(next), 1001L + ScheduleEvidence.GRACE_MS)
        assertTrue(previous !in evidence.armed)
        assertEquals(false, evidence.missed[previous])
    }

    @Test
    fun disabledRulesAreNotRegisteredEvenWhenTheyHaveAFutureTime() {
        val json = """[{"id":"disabled","enabled":false,"nextTriggerEpochMs":9999999999999}]"""
        assertTrue(ScheduleAlarmManager.allSchedulesFromJson(json).isEmpty())
    }

    @Test
    fun missedEvidenceHasGraceAndLateDeliveriesCancelPendingReports() {
        val evidence = ScheduleEvidence()
        val identity = AlarmIdentity("daily", 1_000L)
        evidence.armed.add(identity)
        evidence.collectMissed(1_000L + ScheduleEvidence.GRACE_MS, 0L)
        assertTrue(evidence.missed.isEmpty())
        evidence.collectMissed(1_001L + ScheduleEvidence.GRACE_MS, 2_000L)
        assertEquals(true, evidence.missed[identity])
        evidence.collectMissed(1_002L + ScheduleEvidence.GRACE_MS, 0L)
        assertEquals(1, evidence.missed.size)
        evidence.markDelivered(identity)
        assertTrue(evidence.missed.isEmpty())
    }

    @Test
    fun rawSchedulesKeepPastAutoStartAndLegacyHasNoEvidence() {
        val json = """[{"id":"old","nextTriggerEpochMs":1,"autoStart":true}]"""
        assertTrue(ScheduleAlarmManager.allSchedulesFromJson(json).single().autoStart)
        assertTrue(ScheduleAlarmManager.schedulesFromJson(json).isEmpty())
        assertTrue(ScheduleEvidence().armed.isEmpty())
    }

    @Test
    fun deliveriesAreIdempotentAndRemovedRulesArePruned() {
        val evidence = ScheduleEvidence()
        val identity = AlarmIdentity("daily", 123)
        evidence.markDelivered(identity)
        evidence.markDelivered(identity)
        assertEquals(listOf(identity), evidence.delivered)
        evidence.armed.add(identity)
        evidence.retainRules(emptySet())
        assertTrue(evidence.armed.isEmpty())
        assertTrue(evidence.delivered.isEmpty())
    }

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

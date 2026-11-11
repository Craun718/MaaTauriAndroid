package top.natsuu.mta

import android.util.AtomicFile
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal data class AlarmIdentity(val ruleId: String, val scheduledAtMs: Long) {
    fun json(): JSONObject = JSONObject().put("ruleId", ruleId).put("scheduledAtMs", scheduledAtMs)
    companion object {
        fun parse(value: JSONObject): AlarmIdentity = AlarmIdentity(
            value.getString("ruleId"), value.getLong("scheduledAtMs"),
        )
    }
}

/** Delivery evidence is independent of Rust's execution claims. */
internal class ScheduleEvidence(
    val armed: MutableList<AlarmIdentity> = mutableListOf(),
    val delivered: MutableList<AlarmIdentity> = mutableListOf(),
    val missed: MutableMap<AlarmIdentity, Boolean> = linkedMapOf(),
    var alarmMode: String = "unknown",
) {
    fun markDelivered(identity: AlarmIdentity) {
        missed.remove(identity)
        armed.remove(identity)
        delivered.remove(identity)
        delivered.add(0, identity)
        while (delivered.size > 200) delivered.removeAt(delivered.lastIndex)
    }

    fun retainRules(ids: Set<String>) {
        missed.keys.removeAll { it.ruleId !in ids }
        armed.removeAll { it.ruleId !in ids }
        delivered.removeAll { it.ruleId !in ids }
    }

    fun replaceArmed(registered: List<AlarmIdentity>, nowMs: Long) {
        // A just-expired slot must survive a resync until its grace period expires.
        armed.removeAll { it.scheduledAtMs > nowMs || it in delivered || it in missed }
        armed.addAll(registered.filter { it !in armed })
    }

    fun collectMissed(nowMs: Long, bootAtMs: Long) {
        armed.filter { it.scheduledAtMs > 0 && nowMs - it.scheduledAtMs > GRACE_MS && it !in delivered }
            .forEach { missed.putIfAbsent(it, bootAtMs > it.scheduledAtMs) }
    }

    fun json(): JSONObject = JSONObject()
        .put("alarmMode", alarmMode)
        .put("missed", JSONArray(missed.map { (identity, rebooted) -> identity.json().put("rebooted", rebooted) }))
        .put("armed", JSONArray(armed.map { it.json() }))
        .put("delivered", JSONArray(delivered.map { it.json() }))

    companion object {
        const val GRACE_MS = 10 * 60_000L

        fun read(file: File): ScheduleEvidence {
            if (!file.exists() && !File(file.path + ".bak").exists()) return ScheduleEvidence()
            return parse(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
        }

        fun parse(json: String): ScheduleEvidence {
            val value = JSONObject(json)
            fun identities(key: String): MutableList<AlarmIdentity> {
                val array = value.optJSONArray(key) ?: JSONArray()
                return (0 until array.length()).map { AlarmIdentity.parse(array.getJSONObject(it)) }.toMutableList()
            }
            val evidence = ScheduleEvidence(identities("armed"), identities("delivered"), alarmMode = value.optString("alarmMode", "unknown"))
            val pending = value.optJSONArray("missed") ?: JSONArray()
            for (index in 0 until pending.length()) {
                val item = pending.getJSONObject(index)
                evidence.missed[AlarmIdentity.parse(item)] = item.optBoolean("rebooted")
            }
            return evidence
        }
    }
}

internal fun writeScheduleFile(file: File, text: String) {
    val atomic = AtomicFile(file)
    val stream = atomic.startWrite()
    try {
        stream.write(text.toByteArray(Charsets.UTF_8))
        atomic.finishWrite(stream)
    } catch (error: Exception) {
        atomic.failWrite(stream)
        throw error
    }
}

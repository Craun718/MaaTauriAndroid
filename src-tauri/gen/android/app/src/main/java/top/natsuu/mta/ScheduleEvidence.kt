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
) {
    fun markDelivered(identity: AlarmIdentity) {
        delivered.remove(identity)
        delivered.add(0, identity)
        while (delivered.size > 200) delivered.removeAt(delivered.lastIndex)
    }

    fun retainRules(ids: Set<String>) {
        armed.removeAll { it.ruleId !in ids }
        delivered.removeAll { it.ruleId !in ids }
    }

    fun json(): JSONObject = JSONObject()
        .put("armed", JSONArray(armed.map { it.json() }))
        .put("delivered", JSONArray(delivered.map { it.json() }))

    companion object {
        fun read(file: File): ScheduleEvidence {
            if (!file.exists() && !File(file.path + ".bak").exists()) return ScheduleEvidence()
            val value = JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
            fun identities(key: String): MutableList<AlarmIdentity> {
                val array = value.optJSONArray(key) ?: JSONArray()
                return (0 until array.length()).map { AlarmIdentity.parse(array.getJSONObject(it)) }.toMutableList()
            }
            return ScheduleEvidence(identities("armed"), identities("delivered"))
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

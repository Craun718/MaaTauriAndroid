package top.natsuu.mta.control

import android.content.Context
import org.json.JSONObject

/** 一次待取证的提权进程死亡：死亡时刻与 pid，pid 用来在系统日志里认人。 */
internal data class PendingServiceDeath(
    val reason: String,
    val diedAtMs: Long,
    val pid: Int?,
) {
    val sinceMs: Long get() = diedAtMs - ServiceDeathForensics.LOOK_BACK_MS
    val untilMs: Long get() = diedAtMs + ServiceDeathForensics.LOOK_AHEAD_MS
}

/**
 * 提权进程被杀，凶手只记在系统日志里，死者自己读不了。
 *
 * 死亡时记下死亡时刻与 pid，下次连上新进程时让它翻那段日志，挂回原事件；落盘是因为
 * 本进程未必活到那时。只留最近一次，连死几次多是同一个原因。
 */
internal class ServiceDeathForensics(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val prefs by lazy { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }

    @Synchronized
    fun remember(reason: String, pid: Int?) {
        val json = JSONObject()
            .put("reason", reason)
            .put("diedAtMs", clock())
            .put("pid", pid ?: JSONObject.NULL)
        // 进程随时可能没，落盘要同步
        prefs.edit().putString(KEY_PENDING, json.toString()).commit()
    }

    /** 取出待取证的死亡并清空；同一个 pid、或隔太久（日志早被冲掉）都丢弃。 */
    @Synchronized
    fun take(connectedPid: Int?): PendingServiceDeath? {
        val stored = prefs.getString(KEY_PENDING, null) ?: return null
        val pending = runCatching { parse(stored) }.getOrNull()
        if (pending == null) {
            // 存坏了就别留着占位
            prefs.edit().remove(KEY_PENDING).commit()
            return null
        }
        // 还没问到新进程的 pid，留到下次连上再取，别把取证机会丢掉
        if (connectedPid == null) return null
        // 取过即清：一次死亡只取证一次
        prefs.edit().remove(KEY_PENDING).commit()
        return ServiceDeathForensicsLogic.accepted(pending, connectedPid, clock())
    }

    private fun parse(raw: String): PendingServiceDeath {
        val json = JSONObject(raw)
        return PendingServiceDeath(
            reason = json.optString("reason", "unknown"),
            diedAtMs = json.optLong("diedAtMs", 0L),
            pid = if (json.isNull("pid")) null else json.optInt("pid"),
        )
    }

    companion object {
        /** 往回多看一分钟：内存吃紧、冻结这类前兆也在里面。 */
        const val LOOK_BACK_MS = 60_000L
        const val LOOK_AHEAD_MS = 15_000L

        /** 隔太久系统日志早被冲掉，翻了也是别的进程的噪声。 */
        const val MAX_AGE_MS = 24 * 60 * 60_000L
        private const val PREFS_NAME = "service_death_forensics"
        private const val KEY_PENDING = "pending"
    }
}

/** 纯判定，单测用；[accepted] 返回可取证的那一条，否则 null。 */
internal object ServiceDeathForensicsLogic {
    fun accepted(
        pending: PendingServiceDeath?,
        connectedPid: Int?,
        nowMs: Long,
    ): PendingServiceDeath? {
        if (pending == null || connectedPid == null) return null
        // 没记下 pid 就认不出死者，翻日志也只能翻到别的进程
        if (pending.pid == null) return null
        // 同一个 pid 说明它没死（进程被替换也会报死亡）
        if (pending.pid == connectedPid) return null
        if (nowMs - pending.diedAtMs > ServiceDeathForensics.MAX_AGE_MS) return null
        return pending
    }
}

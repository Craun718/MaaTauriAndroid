package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 提权进程死亡日志只留死者相关行，别的应用不出设备。 */
class SystemLogFilterTest {
    private val prefix = "top.natsuu.mta:maa_tauri_android_control"

    private fun line(atMs: Long, body: String): String =
        "${atMs / 1000}.${(atMs % 1000).toString().padStart(3, '0')} $body"

    @Test
    fun keepsOnlyLinesMentioningTheDeadProcess() {
        val lines = sequenceOf(
            line(1_000, "10-13 12:00:00.000  9999  9999 I Other: unrelated"),
            line(1_100, "10-13 12:00:00.100  1234  5678 I System: pid 1234 died"),
            line(1_200, "10-13 12:00:00.200  1111  2222 I System: $prefix exited"),
            line(1_300, "10-13 12:00:00.300  9999  9999 I Other: still unrelated"),
        )

        val result = SystemLogFilter.filter(lines, pid = 1234, processPrefix = prefix, untilMs = 9_999)

        assertEquals(2, result.kept.size)
        assertEquals(4, result.scanned)
        assertEquals(0, result.otherKills)
    }

    // 整数匹配：1234 不命中 12345
    @Test
    fun doesNotMatchLongerPids() {
        val lines = sequenceOf(line(1_000, "10-13 12:00:00.000  12345  12345 I System: other"))

        val result = SystemLogFilter.filter(lines, pid = 1234, processPrefix = prefix, untilMs = 9_999)

        assertEquals(0, result.kept.size)
    }

    @Test
    fun stopsAtTheWindowEnd() {
        val lines = sequenceOf(
            line(1_000, "10-13 12:00:00.000  1234  1 I System: in window"),
            line(5_000, "10-13 12:00:05.000  9999  1 I System: after window"),
            line(5_100, "10-13 12:00:05.100  1234  1 I System: never scanned"),
        )

        val result = SystemLogFilter.filter(lines, pid = 1234, processPrefix = prefix, untilMs = 2_000)

        assertEquals(1, result.kept.size)
        // 越窗的那行只用来结束扫描，不算进去
        assertEquals(1, result.scanned)
    }

    @Test
    fun countsOtherKillsWithoutShippingThem() {
        val lines = sequenceOf(
            line(1_000, "10-13 12:00:00.000  9999  1 I lmkd: Kill 'com.other' (9999)"),
            line(1_100, "10-13 12:00:00.100  8888  1 I lmkd: Kill 'com.other2' (8888)"),
            line(1_200, "10-13 12:00:00.200  1234  1 I System: dead"),
        )

        val result = SystemLogFilter.filter(lines, pid = 1234, processPrefix = prefix, untilMs = 9_999)

        assertEquals(1, result.kept.size)
        assertEquals(2, result.otherKills)
    }

    @Test
    fun keepsTheLinesNearestToDeath() {
        val lines = (1..5).asSequence().map { index ->
            line(index * 1_000L, "10-13 12:00:00.000  1234  1 I System: line $index")
        }

        val result = SystemLogFilter.filter(lines, pid = 1234, processPrefix = prefix, untilMs = 9_999, maxLines = 2)

        assertEquals(2, result.kept.size)
        assertEquals(listOf(true, true), result.kept.map { it.endsWith("line 4") || it.endsWith("line 5") })
    }

    @Test
    fun parsesEpochTimestampsAndIgnoresSeparators() {
        assertEquals(1_234L, SystemLogFilter.epochMs("1.234  1234  1 I System: x"))
        assertEquals(1_200L, SystemLogFilter.epochMs("1.2  1234  1 I System: x"))
        assertNull(SystemLogFilter.epochMs("--------- beginning of main"))
    }
}

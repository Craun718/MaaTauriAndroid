package top.natsuu.mta.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/** 悬浮层只吃 Rust 推来的 JSON，解析契约是这两个模块之间最容易断的地方。 */
class RunOverlayControllerTest {
    @Test
    fun `parses every field of a pushed frame`() {
        val snapshot = parseRunOverlaySnapshot(
            """
            {"foreground":true,"phase":"running","done":2,"total":5,
             "label":"Daily","status":"fighting",
             "tasks":["Login","Daily"],"active":1,
             "log":[{"at":1700000000000,"level":"warn","message":"watch out"}]}
            """.trimIndent(),
        )

        assertEquals(
            RunOverlaySnapshot(
                foreground = true,
                phase = PHASE_RUNNING,
                done = 2,
                total = 5,
                label = "Daily",
                status = "fighting",
                tasks = listOf("Login", "Daily"),
                active = 1,
                log = listOf(RunOverlayLogLine(1_700_000_000_000, "warn", "watch out")),
            ),
            snapshot,
        )
    }

    @Test
    fun `defaults missing fields instead of failing the push`() {
        val snapshot = parseRunOverlaySnapshot("""{"phase":"preparing"}""")

        assertEquals(
            RunOverlaySnapshot(
                foreground = false,
                phase = PHASE_PREPARING,
                done = 0,
                total = 0,
                label = "",
                status = "",
                tasks = emptyList(),
                active = -1,
                log = emptyList(),
            ),
            snapshot,
        )
    }

    @Test
    fun `keeps blank task labels so the active index still lines up`() {
        val snapshot = parseRunOverlaySnapshot(
            """{"foreground":true,"tasks":["Login","","Daily"],"active":2}""",
        )

        assertEquals(listOf("Login", "", "Daily"), snapshot?.tasks)
        assertEquals(2, snapshot?.active)
    }

    @Test
    fun `drops log rows without a body and keeps only the newest lines`() {
        val rows = (0 until MAX_LOG_LINES + 5).joinToString(",") { index ->
            """{"at":$index,"level":"info","message":"line $index"}"""
        }
        val snapshot = parseRunOverlaySnapshot(
            """{"foreground":true,"log":[$rows,{"at":9,"level":"info","message":""}]}""",
        )

        assertEquals(MAX_LOG_LINES, snapshot?.log?.size)
        assertEquals("line 5", snapshot?.log?.first()?.message)
        assertEquals("line ${MAX_LOG_LINES + 4}", snapshot?.log?.last()?.message)
    }

    @Test
    fun `log rows are stamped with the local wall clock time`() {
        val previous = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        try {
            assertEquals(
                "22:13:20  Maa task Daily started",
                formatLogLine(RunOverlayLogLine(1_700_000_000_000, "info", "Maa task Daily started")),
            )
            assertEquals("no clock", formatLogLine(RunOverlayLogLine(0, "info", "no clock")))
        } finally {
            TimeZone.setDefault(previous)
        }
    }

    @Test
    fun `treats an unknown phase as running`() {
        val snapshot = parseRunOverlaySnapshot("""{"foreground":true,"phase":"teleporting"}""")

        assertEquals(PHASE_RUNNING, snapshot?.phase)
    }

    @Test
    fun `drops a frame that is not an object`() {
        assertNull(parseRunOverlaySnapshot(""))
        assertNull(parseRunOverlaySnapshot("not json"))
        assertNull(parseRunOverlaySnapshot("[1,2,3]"))
    }

    @Test
    fun `only the finished phase dismisses the panel`() {
        assertTrue(snapshot(PHASE_FINISHED).finished)
        assertFalse(snapshot(PHASE_PREPARING).finished)
        assertFalse(snapshot(PHASE_RUNNING).finished)
        assertFalse(snapshot(PHASE_STOPPING).finished)
    }

    private fun snapshot(phase: String) = RunOverlaySnapshot(
        foreground = true,
        phase = phase,
        done = 0,
        total = 0,
        label = "",
        status = "",
        tasks = emptyList(),
        active = -1,
        log = emptyList(),
    )
}

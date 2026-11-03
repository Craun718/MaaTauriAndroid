package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Test

class AnrExitInfoTest {
    @Test
    fun classifies_aosp_anr_descriptions() {
        assertEquals(
            "input",
            AnrExitInfo.kindOf(
                "Input dispatching timed out (Application does not have a focused window)",
            ),
        )
        assertEquals(
            "fgs_start",
            AnrExitInfo.kindOf(
                "Context.startForegroundService() did not then call Service.startForeground()",
            ),
        )
        assertEquals(
            "service",
            AnrExitInfo.kindOf("Executing service top.natsuu.mta/.RunForegroundService"),
        )
        assertEquals(
            "broadcast",
            AnrExitInfo.kindOf("Broadcast of Intent { act=top.natsuu.mta.SCHEDULE }"),
        )
        assertEquals("provider", AnrExitInfo.kindOf("ContentProvider not responding"))
    }

    @Test
    fun keeps_user_dismissals_and_unknown_text_separate() {
        assertEquals(
            "input",
            AnrExitInfo.kindOf(
                "user request after error: Input dispatching timed out (no focused window)",
            ),
        )
        assertEquals("unknown", AnrExitInfo.kindOf(null))
        assertEquals("unknown", AnrExitInfo.kindOf(" "))
        assertEquals("other", AnrExitInfo.kindOf("user request after error"))
    }
}

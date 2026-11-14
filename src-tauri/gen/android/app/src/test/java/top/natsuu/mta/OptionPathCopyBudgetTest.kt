package top.natsuu.mta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class OptionPathCopyBudgetTest {
    @Test fun preservesNamesAndRejectsTraversal() {
        assertEquals("中文 file.txt", OptionPathCopyBudget.safeName("中文 file.txt"))
        for (name in listOf(null, "", " ", ".", "..", "../secret", "/absolute", "a/b", "a\\b", "a\u0000b")) {
            assertThrows(IllegalArgumentException::class.java) { OptionPathCopyBudget.safeName(name) }
        }
    }

    @Test fun countsActualBytesAcrossFiles() {
        val budget = OptionPathCopyBudget()
        budget.bytes(128 * 1024 * 1024)
        budget.bytes(128 * 1024 * 1024)
        assertThrows(OptionPathLimitExceeded::class.java) { budget.bytes(1) }
    }

}

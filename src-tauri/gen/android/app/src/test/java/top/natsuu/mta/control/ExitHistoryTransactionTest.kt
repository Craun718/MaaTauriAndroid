package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Test

class ExitHistoryTransactionTest {
    @Test
    fun firstQueryIsBoundedAndSubsequentQueryUsesPersistedWatermark() {
        var watermark: ExitStamp? = null
        val records = (1..6).map { ExitStamp(it.toLong(), it) }
        val emitted = mutableListOf<ExitStamp>()
        val transaction = ExitHistoryTransaction(
            query = { records.reversed() }, stamp = { it }, load = { watermark },
            save = { watermark = it }, emit = { emitted += it }, failed = { throw AssertionError(it) },
        )
        transaction.record()
        transaction.record()
        assertEquals(records.takeLast(3), emitted)
        assertEquals(records.last(), watermark)
    }

    @Test
    fun everyDiagnosticFailureIsContainedAndFailedEmissionDoesNotAdvanceWatermark() {
        for (stage in listOf("load", "query", "emit", "save")) {
            var failure = 0
            var saved = false
            fun failAt(value: String) { if (stage == value) error(value) }
            ExitHistoryTransaction(
                query = { failAt("query"); listOf(ExitStamp(1L, 2)) }, stamp = { it },
                load = { failAt("load"); null }, save = { failAt("save"); saved = true },
                emit = { failAt("emit") }, failed = { failure++ },
            ).record()
            assertEquals(stage, 1, failure)
            assertEquals(stage, false, saved)
        }
    }

    @Test
    fun equalTimestampsAreOrderedByPid() {
        val emitted = mutableListOf<ExitStamp>()
        ExitHistoryTransaction(
            query = { listOf(ExitStamp(5, 1), ExitStamp(5, 2), ExitStamp(6, 1)) },
            stamp = { it }, load = { ExitStamp(5, 1) }, save = {},
            emit = { emitted += it }, failed = { throw AssertionError(it) },
        ).record()
        assertEquals(listOf(ExitStamp(5, 2), ExitStamp(6, 1)), emitted)
    }
}

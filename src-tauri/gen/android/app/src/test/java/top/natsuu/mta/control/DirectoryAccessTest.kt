package top.natsuu.mta.control

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException

class DirectoryAccessTest {
    @Test fun mountSelectsDeepestBoundaryAndDecodesEscapes() {
        val lines = listOf(
            "1 0 0:1 / / rw - rootfs rootfs rw",
            "2 1 0:2 / /data rw - ext4 /dev/a rw",
            "3 2 0:3 / /data/local\\040tmp ro - tmpfs tmpfs ro",
            "invalid",
        )
        assertEquals("/data/local tmp", DirectoryAccess.mount("/data/local tmp/a", lines.asSequence())?.point)
        assertEquals("/", DirectoryAccess.mount("/database/a", lines.asSequence())?.point)
        assertEquals("/data", DirectoryAccess.mount("/data", lines.asSequence())?.point)
        assertNull(DirectoryAccess.mount("/data", emptySequence()))
    }

    @Test fun diagnosticsAreOptionalAndNeverHideTheOriginalFailure() {
        val directory = File("/runtime")
        assertEquals(7, DirectoryAccess.guard(directory, "probe", { _, _, _ -> error("not called") }) { 7 })
        val original = IOException("read only")
        val failure = runCatching {
            DirectoryAccess.guard(directory, "probe", { _, _, _ -> error("stat unavailable") }) { throw original }
        }.exceptionOrNull()
        assertTrue(failure is DirectoryAccessFailure)
        assertSame(original, failure?.cause)
        assertTrue(failure?.message?.contains("MTA_DIRECTORY_ACCESS=") == true)
        assertTrue(failure?.message?.contains("unknown") == true)
        assertSame(original, DirectoryAccess.confirmedFailure(directory, "extract", original))
        assertSame(failure, DirectoryAccess.confirmedFailure(directory, "extract", requireNotNull(failure)))
        val invalid = IllegalArgumentException("bad descriptor")
        assertSame(invalid, runCatching {
            DirectoryAccess.guard(directory, "probe", { _, _, _ -> error("not called") }) { throw invalid }
        }.exceptionOrNull())
    }
}

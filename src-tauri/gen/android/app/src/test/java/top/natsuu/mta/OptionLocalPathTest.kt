package top.natsuu.mta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OptionLocalPathTest {
    private fun resolve(id: String): String? = OptionLocalPath.externalDocumentPath(id, "/storage/emulated/0") {
        if (it == "ABCD-1234") "/storage/ABCD-1234" else null
    }

    @Test fun preservesLocalDirectoriesAndFilenames() {
        assertEquals("/storage/emulated/0/Documents/输出", resolve("primary:Documents/输出"))
        assertEquals("/storage/emulated/0", resolve("primary:"))
        assertEquals("/storage/ABCD-1234/dir/file.txt", resolve("ABCD-1234:dir/file.txt"))
        assertNull(resolve("unknown:dir"))
        assertNull(resolve("cloud-id"))
    }

    @Test fun rejectsAbsoluteAndTraversalDocumentIds() {
        for (id in listOf("primary:/etc", "primary:../etc", "primary:a/../b", "primary:./a", "primary:a\\b", "primary:a\u0000b")) {
            assertNull(resolve(id))
        }
    }

    @Test fun acceptsExternalPathsWithoutAssumingAppUidAccess() {
        for (path in listOf(
            "/storage/emulated/0/Download/output",
            "/storage/ABCD-1234/Documents/file",
            "/storage/emulated/0/Android/data/app/files/user-data",
            "/storage/emulated/0/Android/obb/app/file",
        )) {
            assertTrue(OptionLocalPath.isSharedPath(path))
        }
        for (path in listOf(
            "/data/user/0/app/files/file", "content://provider/file",
            "/storage/emulated/0/../secret", "/storage//alias", "/storage/a\\b",
        )) {
            assertFalse(OptionLocalPath.isSharedPath(path))
        }
    }
}

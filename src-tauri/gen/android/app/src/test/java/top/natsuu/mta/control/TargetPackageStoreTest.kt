package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class TargetPackageStoreTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun `reading a missing file returns an empty list`() {
        val store = TargetPackageStore(File(folder.root, "target_packages"))

        assertEquals(emptyList<String>(), store.read())
    }

    @Test
    fun `written packages survive a round trip`() {
        val store = TargetPackageStore(File(folder.root, "target_packages"))

        store.write(listOf("com.example.game", "com.example.other"))

        assertEquals(
            listOf("com.example.game", "com.example.other"),
            store.read(),
        )
    }

    @Test
    fun `reading drops blank lines and surrounding whitespace`() {
        val file = File(folder.root, "target_packages").apply {
            writeText("com.example.game\n\n   com.example.other  \n")
        }
        val store = TargetPackageStore(file)

        assertEquals(
            listOf("com.example.game", "com.example.other"),
            store.read(),
        )
    }

    @Test
    fun `writing an empty list deletes the file`() {
        val file = File(folder.root, "target_packages").apply { writeText("com.example.game\n") }
        val store = TargetPackageStore(file)

        store.write(emptyList())

        assertFalse(file.exists())
    }

    @Test
    fun `write failures surface through onError`() {
        val blocker = File(folder.root, "blocker").apply { writeText("a file, not a directory") }
        val errors = mutableListOf<String>()
        val store = TargetPackageStore(File(blocker, "target_packages")) { errors.add(it) }

        store.write(listOf("com.example.game"))

        assertEquals(1, errors.size)
    }
}

package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class TargetPackagesTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun `add keeps unique package names in launch order and ignores empty names`() {
        val packages = TargetPackages()

        packages.add("com.example.game")
        packages.add("com.example.other")
        packages.add("com.example.game")
        packages.add("")

        assertEquals(
            listOf("com.example.game", "com.example.other"),
            packages.drain(),
        )
    }

    @Test
    fun `remove drops only the matching package`() {
        val packages = TargetPackages()
        packages.add("com.example.game")
        packages.add("com.example.other")

        packages.remove("com.example.game")

        assertEquals(listOf("com.example.other"), packages.drain())
    }

    @Test
    fun `peek returns the live set without clearing it`() {
        val packages = TargetPackages()
        packages.add("com.example.game")
        packages.add("com.example.other")

        assertEquals(
            listOf("com.example.game", "com.example.other"),
            packages.peek(),
        )
        assertEquals(
            listOf("com.example.game", "com.example.other"),
            packages.drain(),
        )
        assertEquals(emptyList<String>(), packages.peek())
    }

    @Test
    fun `store persists every change for a fresh instance to pick up`() {
        val store = TargetPackageStore(File(folder.root, "target_packages"))
        val packages = TargetPackages(store)

        packages.add("com.example.game")
        packages.add("com.example.other")
        packages.remove("com.example.game")

        assertEquals(listOf("com.example.other"), store.read())

        packages.drain()

        assertEquals(emptyList<String>(), store.read())
    }

    @Test
    fun `store write failures surface through onError and leave the live set intact`() {
        val blocker = File(folder.root, "blocker").apply { writeText("a file, not a directory") }
        val errors = mutableListOf<String>()
        val store = TargetPackageStore(File(blocker, "target_packages")) { errors.add(it) }
        val packages = TargetPackages(store)

        packages.add("com.example.game")

        assertEquals(listOf("com.example.game"), packages.peek())
        assertEquals(1, errors.size)
    }
}

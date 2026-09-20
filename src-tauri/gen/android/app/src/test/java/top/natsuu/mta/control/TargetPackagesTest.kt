package top.natsuu.mta.control

import org.junit.Assert.assertEquals
import org.junit.Test

class TargetPackagesTest {
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
}

package top.natsuu.mta.kotlin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PiProfileReaderTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun readsAgentRuntimeAndResolvesPathsFromTheProfileDirectory() {
        val profileDirectory = temporaryFolder.newFolder("profile")
        val assetsDirectory = temporaryFolder.newFolder("pi")
        val bundle = temporaryFolder.newFile("runtime.zip")
        val profile = profileDirectory.resolve("pi.toml").apply {
            writeText(
                """
                pi_assets = "../pi"
                resource_id = "game"
                maa_dir = "../vendor/maa/android"

                [agent]
                timeout_ms = 20_000

                [[agent.runtimes]]
                bundle = "../runtime.zip"
                exec = "python/bin/python3"
                executables = ["python/bin/python3"]
                args = ["-u"]
                working_dir = "{pi}"

                [agent.runtimes.env]
                PYTHONHOME = "{bundle}/python"
                """.trimIndent(),
            )
        }

        val result = PiProfileReader.read(profile)

        assertEquals(assetsDirectory.canonicalPath, result.assets)
        assertEquals("game", result.resourceId)
        assertEquals("../vendor/maa/android", result.maaDir)
        val agent = requireNotNull(result.agent)
        assertEquals(20_000L, agent.timeoutMs)
        assertEquals(bundle.canonicalFile, agent.runtimes.single().bundle)
        assertEquals("PYTHONHOME={bundle}/python", agent.runtimes.single().env.entries.single().toString())
    }

    @Test
    fun rejectsApplicationIdUnsafeResourceIds() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText("pi_assets = \".\"\nresource_id = \"../escape\"")
        }

        assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
    }

    @Test
    fun rejectsTheRetiredIncludeAllowList() {
        // The pack set now comes from interface.json; a leftover list would be ignored and
        // silently give the profile author a false picture of what ships.
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"
                pi_include = ["interface.json"]
                """.trimIndent(),
            )
        }

        val error = assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
        assertTrue(error.message.orEmpty().contains("pi_include"))
    }

    @Test
    fun rejectsTheRetiredExcludeList() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"
                pi_exclude = ["resource/announcement/*.md"]
                """.trimIndent(),
            )
        }

        val error = assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
        assertTrue(error.message.orEmpty().contains("pi_exclude"))
    }
}

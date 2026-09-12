package top.natsuu.mta.kotlin

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
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
                bundle_sha256 = "${"a".repeat(64)}"
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
    fun leavesTheBundlePinUnsetWhenTheProfileOmitsIt() {
        val profileDirectory = temporaryFolder.newFolder("profile")
        temporaryFolder.newFolder("pi")
        temporaryFolder.newFile("runtime.zip")
        val profile = profileDirectory.resolve("pi.toml").apply {
            writeText(
                """
                pi_assets = "../pi"
                resource_id = "game"

                [[agent.runtimes]]
                bundle = "../runtime.zip"
                exec = "python/bin/python3"
                executables = ["python/bin/python3"]
                args = ["-u"]
                working_dir = "{pi}"
                """.trimIndent(),
            )
        }

        val runtime = requireNotNull(requireNotNull(PiProfileReader.read(profile).agent).runtimes.single())

        assertEquals(null, runtime.bundleSha256)
    }

    @Test
    fun rejectsABundlePinThatIsNotASha256Digest() {
        val profileDirectory = temporaryFolder.newFolder("profile")
        temporaryFolder.newFolder("pi")
        temporaryFolder.newFile("runtime.zip")
        val profile = profileDirectory.resolve("pi.toml").apply {
            writeText(
                """
                pi_assets = "../pi"
                resource_id = "game"

                [[agent.runtimes]]
                bundle = "../runtime.zip"
                bundle_sha256 = "not-a-digest"
                exec = "python/bin/python3"
                executables = ["python/bin/python3"]
                args = ["-u"]
                working_dir = "{pi}"
                """.trimIndent(),
            )
        }

        assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
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
}

package top.natsuu.mta.kotlin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
                app_name = "Game"
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
        assertEquals("Game", result.appName)
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
    fun rejectsBlankApplicationNames() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText("pi_assets = \".\"\napp_name = \"\"")
        }

        assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
    }

    @Test
    fun readsAndTrimsOptionalMirrorchyanRid() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"
                mirrorchyan_rid = "  M9A  "
                """.trimIndent(),
            )
        }

        val result = PiProfileReader.read(profile)

        assertEquals("M9A", result.mirrorchyanRid)
    }

    @Test
    fun leavesMirrorchyanRidUnsetWhenOmittedFromTheProfile() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText("pi_assets = \".\"\nresource_id = \"game\"")
        }

        val result = PiProfileReader.read(profile)

        assertNull(result.mirrorchyanRid)
    }

    @Test
    fun rejectsBlankMirrorchyanRid() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText("pi_assets = \".\"\nresource_id = \"game\"\nmirrorchyan_rid = \"   \"")
        }

        assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
    }

    @Test
    fun readsPiIncludeAsExtraEntriesRatherThanAnAllowList() {
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"
                pi_include = ["assets/extra.png"]
                """.trimIndent(),
            )
        }

        val result = PiProfileReader.read(profile)

        assertEquals(listOf("assets/extra.png"), result.extraEntries)
    }

    @Test
    fun stillRejectsTheExcludeList() {
        // The derived pack set cannot be pruned, so pi_exclude would be a no-op pretending
        // to be a filter.
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

    @Test
    fun readsSigningAndFallsBackToTheStorePassword() {
        val profileDirectory = temporaryFolder.newFolder("profile")
        val keystore = temporaryFolder.newFile("release.jks")
        val profile = profileDirectory.resolve("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"

                [signing]
                store_file = "../release.jks"
                store_password = "store-secret"
                key_alias = "mta"
                """.trimIndent(),
            )
        }

        val signing = requireNotNull(PiProfileReader.read(profile).signing)

        assertEquals(keystore.canonicalFile.absolutePath, signing.storeFile)
        assertEquals("store-secret", signing.storePassword)
        assertEquals("mta", signing.keyAlias)
        assertEquals("store-secret", signing.keyPassword)
    }

    @Test
    fun readsSigningWithAnAbsoluteKeystoreAndExplicitKeyPassword() {
        val keystore = temporaryFolder.newFile("release.jks")
        val profile = temporaryFolder.newFile("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"

                [signing]
                store_file = "${keystore.canonicalPath}"
                store_password = "store-secret"
                key_alias = "mta"
                key_password = "key-secret"
                """.trimIndent(),
            )
        }

        val signing = requireNotNull(PiProfileReader.read(profile).signing)

        assertEquals(keystore.canonicalFile.absolutePath, signing.storeFile)
        assertEquals("key-secret", signing.keyPassword)
    }

    @Test
    fun rejectsSigningKeystorePathsThatDoNotExist() {
        val profileDirectory = temporaryFolder.newFolder("profile")
        val profile = profileDirectory.resolve("pi.toml").apply {
            writeText(
                """
                pi_assets = "."
                resource_id = "game"

                [signing]
                store_file = "../missing.jks"
                store_password = "store-secret"
                key_alias = "mta"
                """.trimIndent(),
            )
        }

        val error = assertThrows(IllegalArgumentException::class.java) {
            PiProfileReader.read(profile)
        }
        assertTrue(error.message.orEmpty().contains("signing keystore does not exist"))
    }
}

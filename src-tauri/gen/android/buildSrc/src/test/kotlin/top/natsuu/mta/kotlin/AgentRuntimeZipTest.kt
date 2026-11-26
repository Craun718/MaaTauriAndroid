package top.natsuu.mta.kotlin

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AgentRuntimeZipTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private val abi = "arm64-v8a"
    private val release = "v6.0.0-beta.3"

    private fun zip(vararg extra: Pair<String, String>): File {
        val file = temporaryFolder.newFile()
        ZipOutputStream(file.outputStream()).use { archive ->
            for ((name, data) in AgentRuntimeZip.agentLibraries.map { "lib/$abi/$it" to it } + extra) {
                archive.putNextEntry(ZipEntry(name))
                archive.write(data.toByteArray())
                archive.closeEntry()
            }
        }
        return file
    }

    @Test
    fun acceptsMatchingPythonBetaButRejectsOlderCoreOrWrongAbi() {
        val valid = zip("agent-core.json" to """{"abi":"$abi","provides":{"maafw":"6.0.0b3"}}""")
        AgentRuntimeZip.validate(valid, abi, release, null)
        val old = zip("agent-core.json" to """{"abi":"$abi","provides":{"maafw":"5.16.0"}}""")
        assertThrows(IllegalArgumentException::class.java) {
            AgentRuntimeZip.validate(old, abi, release, null)
        }
        val wrong = zip("agent-core.json" to """{"abi":"x86_64","provides":{"maafw":"6.0.0b3"}}""")
        assertThrows(IllegalArgumentException::class.java) {
            AgentRuntimeZip.validate(wrong, abi, release, null)
        }
    }

    @Test
    fun doesNotLetPythonRuntimeBypassValidationByOmittingManifest() {
        val file = zip("bin/python3" to "test")
        val error = assertThrows(IllegalArgumentException::class.java) {
            AgentRuntimeZip.validate(file, abi, release, null)
        }
        assertTrue(error.message.orEmpty().contains("missing agent-core.json"))
    }

    @Test
    fun acceptsCompiledManifestWithoutPython() {
        val compiled = zip("agent-runtime.json" to """{"abi":"$abi","maafw":"$release"}""")
        AgentRuntimeZip.validate(compiled, abi, release, null)
    }

    @Test
    fun validatesLegacyCompiledZipOnlyAgainstKnownOfficialLibraries() {
        val compiled = zip("bin/agent" to "test")
        val native = temporaryFolder.newFolder()
        AgentRuntimeZip.agentLibraries.forEach { native.resolve(it).writeText(it) }
        AgentRuntimeZip.validate(compiled, abi, release, native)
        native.resolve(AgentRuntimeZip.agentLibraries.first()).writeText("older library")
        assertThrows(IllegalArgumentException::class.java) {
            AgentRuntimeZip.validate(compiled, abi, release, native)
        }
        AgentRuntimeZip.validate(compiled, abi, release, null)
    }
}

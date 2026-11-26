package top.natsuu.mta.kotlin

import groovy.json.JsonSlurper
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.zip.ZipFile

object AgentRuntimeZip {
    private const val PYTHON_MANIFEST = "agent-core.json"
    private const val COMPILED_MANIFEST = "agent-runtime.json"
    private val preRelease = Regex("-(alpha|beta|rc)\\.(\\d+)$")
    val agentLibraries = listOf("libMaaAgentClient.so", "libMaaAgentServer.so")

    private fun normalizedRelease(value: String): String =
        preRelease.replace(value.trim().lowercase(Locale.ROOT).removePrefix("v")) {
            val stage = when (it.groupValues[1]) {
                "alpha" -> "a"
                "beta" -> "b"
                else -> "rc"
            }
            stage + it.groupValues[2]
        }

    private fun sha256(stream: InputStream): ByteArray = stream.use {
        val digest = MessageDigest.getInstance("SHA-256")
        DigestInputStream(it, digest).transferTo(OutputStream.nullOutputStream())
        digest.digest()
    }

    fun validate(file: File, abi: String, expectedVersion: String, officialLibraries: File?) {
        ZipFile(file).use { archive ->
            val entries = archive.entries().asSequence()
                .associateBy { it.name.removePrefix("./") }
            val bundledLibraries = agentLibraries.associateWith { name ->
                requireNotNull(entries["lib/$abi/$name"]?.takeUnless { it.isDirectory }) {
                    "agent runtime is missing lib/$abi/$name: $file"
                }
            }
            val pythonManifest = entries[PYTHON_MANIFEST]
            val compiledManifest = entries[COMPILED_MANIFEST]
            val manifest = pythonManifest ?: compiledManifest
            require(pythonManifest != null ||
                entries.keys.none { it == "bin/python3" || it.startsWith("site-packages/") }) {
                "Python agent runtime is missing $PYTHON_MANIFEST: $file"
            }
            if (manifest != null) {
                val data = requireNotNull(archive.getInputStream(manifest).bufferedReader(Charsets.UTF_8).use {
                    JsonSlurper().parse(it) as? Map<*, *>
                }) { "invalid agent runtime manifest: $file" }
                val actualAbi = data["abi"]
                require(actualAbi == abi) {
                    "agent runtime ABI is $actualAbi, expected $abi: $file"
                }
                val actualVersion = (if (pythonManifest != null) {
                    (data["provides"] as? Map<*, *>)?.get("maafw")
                } else {
                    data["maafw"]
                }) as? String
                require(actualVersion != null && normalizedRelease(actualVersion) == normalizedRelease(expectedVersion)) {
                    "agent runtime MaaFramework is $actualVersion, expected $expectedVersion: $file"
                }
            } else if (officialLibraries != null) {
                // Legacy compiled ZIPs carry no version; compare them only when
                // the APK uses the standard downloaded native distribution.
                bundledLibraries.forEach { (name, entry) ->
                    val reference = officialLibraries.resolve(name)
                    require(reference.isFile &&
                        sha256(archive.getInputStream(entry)).contentEquals(sha256(reference.inputStream()))) {
                        "legacy agent runtime $name differs from MaaFramework $expectedVersion; rebuild $file"
                    }
                }
            }
        }
    }
}

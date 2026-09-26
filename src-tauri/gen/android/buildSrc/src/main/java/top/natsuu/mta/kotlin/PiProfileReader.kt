package top.natsuu.mta.kotlin

import org.tomlj.Toml
import org.tomlj.TomlTable
import java.io.File

data class PiProfile(
    val file: File,
    val assets: String?,
    /**
     * Extra project-relative paths packed on top of the set that interface.json resolves.
     * Nothing here can shrink the derived set, and a listed path that does not exist
     * fails the build like any other declared path.
     */
    val extraEntries: List<String>,
    val resourceId: String,
    val mirrorchyanRid: String?,
    val appName: String?,
    val maaDir: String,
    val agent: AgentProfile?,
    val signing: SigningProfile?,
    val virtualDisplayOrientation: VirtualDisplayOrientation,
)

enum class VirtualDisplayOrientation {
    Landscape,
    Portrait,
}

data class AgentProfile(
    val timeoutMs: Long,
    val runtimes: List<AgentRuntimeProfile>,
)

data class AgentRuntimeProfile(
    val bundle: File,
    val exec: String,
    val executables: List<String>,
    val args: List<String>,
    val workingDir: String,
    val env: Map<String, String>,
)

/**
 * Release signing credentials declared by the packager in `[signing]`. Keystores never
 * live in the repository, so the profile points at a publisher-local file and the path
 * must exist when the build reads it.
 */
data class SigningProfile(
    val storeFile: String,
    val storePassword: String,
    val keyAlias: String,
    val keyPassword: String,
)

object PiProfileReader {
    fun read(file: File, abi: String = "arm64-v8a"): PiProfile {
        val result = Toml.parse(file.toPath())
        val errors = result.errors()
        require(errors.isEmpty()) {
            errors.joinToString("\n") { error -> "${file.invariantSeparatorsPath}:$error" }
        }

        // The pack set comes from interface.json, so a filter would not do what its name
        // promises. Refuse pi_exclude rather than let a profile believe it can prune.
        require(!result.keySet().contains("pi_exclude")) {
            "pi_exclude is no longer supported: the Project Interface pack set is derived " +
                "from interface.json. Remove it from ${file.invariantSeparatorsPath}"
        }

        val agentTable = result.getTable("agent")
        val agent: AgentProfile? = agentTable?.let { table -> readAgent(table, file, abi) }
        val signingTable = result.getTable("signing")
        val signing: SigningProfile? = signingTable?.let { table -> readSigning(table, file) }
        return PiProfile(
            file = file,
            assets = requiredPath(result, "pi_assets", file),
            // pi_include now means "also pack this", never "pack only this".
            extraEntries = stringArray(result, "pi_include").orEmpty(),
            resourceId = resourceId(result),
            mirrorchyanRid = optionalMirrorchyanRid(result),
            appName = optionalString(result, "app_name"),
            maaDir = result.getString("maa_dir") ?: "vendor/maa/android",
            agent = agent,
            signing = signing,
            virtualDisplayOrientation = virtualDisplayOrientation(result),
        )
    }

    private fun readAgent(table: TomlTable, profileFile: File, abi: String): AgentProfile {
        val runtimes: List<Any> = table.getArray("runtimes")?.toList() ?: emptyList()
        require(runtimes.isNotEmpty()) { "agent.runtimes must contain at least one runtime" }
        return AgentProfile(
            timeoutMs = table.getLong("timeout_ms") ?: 15_000L,
            runtimes = runtimes.map { value ->
                require(value is TomlTable) { "agent.runtimes entries must be tables" }
                readRuntime(value, profileFile, abi)
            },
        )
    }

    private fun readRuntime(table: TomlTable, profileFile: File, abi: String): AgentRuntimeProfile {
        val bundle = requiredPath(table, "bundle", profileFile, abi)
            .let(::File)
            .canonicalFile
        require(bundle.isFile) { "agent bundle does not exist: $bundle" }
        return AgentRuntimeProfile(
            bundle = bundle,
            exec = requiredString(table, "exec"),
            executables = requireNotNull(stringArray(table, "executables")) {
                "agent runtime executables is required"
            },
            args = requireNotNull(stringArray(table, "args")) {
                "agent runtime args is required"
            },
            workingDir = requiredString(table, "working_dir"),
            env = table.getTable("env")?.toMap()?.mapValues { (_, value) ->
                require(value is String) { "agent environment values must be strings" }
                value.replace("{abi}", abi)
            } ?: emptyMap(),
        )
    }

    private fun readSigning(table: TomlTable, profileFile: File): SigningProfile {
        val storeFile = File(requiredPath(table, "store_file", profileFile))
        require(storeFile.isFile) { "signing keystore does not exist: $storeFile" }
        val storePassword = requiredString(table, "store_password")
        return SigningProfile(
            storeFile = storeFile.absolutePath,
            storePassword = storePassword,
            keyAlias = requiredString(table, "key_alias"),
            // Keystores commonly use one password for both the store and its key.
            keyPassword = table.getString("key_password")?.takeIf(String::isNotEmpty)
                ?: storePassword,
        )
    }

    private fun requiredString(table: TomlTable, key: String): String {
        val value: String? = table.getString(key)
        return value?.takeIf(String::isNotEmpty)
            ?: throw IllegalArgumentException("$key is required")
    }

    private fun requiredPath(
        table: TomlTable,
        key: String,
        profileFile: File,
        abi: String = "arm64-v8a",
    ): String {
        val value = requiredString(table, key)
        val expandedValue = value.replace("{abi}", abi)
        if (File(expandedValue).isAbsolute) {
            return expandedValue
        }
        val parent = requireNotNull(profileFile.parentFile) {
            "${profileFile.invariantSeparatorsPath} must have a parent directory"
        }
        return parent.resolve(expandedValue).canonicalPath
    }

    private fun resourceId(table: TomlTable): String {
        val value = table.getString("resource_id") ?: "fixture"
        require(value.isNotEmpty() && value.all { char ->
            char in 'a'..'z' || char in '0'..'9' || char == '_'
        } && !value[0].isDigit()) {
            "resource_id may contain only lowercase letters, digits, and underscores"
        }
        return value
    }

    private fun optionalMirrorchyanRid(table: TomlTable): String? {
        val value = table.getString("mirrorchyan_rid") ?: return null
        val trimmed = value.trim()
        require(trimmed.isNotEmpty()) { "mirrorchyan_rid must not be empty" }
        return trimmed
    }

    private fun optionalString(table: TomlTable, key: String): String? {
        val value = table.getString(key) ?: return null
        require(value.isNotEmpty()) { "$key must not be empty" }
        return value
    }

    private fun virtualDisplayOrientation(table: TomlTable): VirtualDisplayOrientation {
        val value = table.get("virtual_display_orientation")
            ?: return VirtualDisplayOrientation.Landscape
        require(value is String) {
            "virtual_display_orientation must be \"landscape\" or \"portrait\""
        }
        return when (value) {
            "landscape" -> VirtualDisplayOrientation.Landscape
            "portrait" -> VirtualDisplayOrientation.Portrait
            else -> throw IllegalArgumentException(
                "virtual_display_orientation must be \"landscape\" or \"portrait\"",
            )
        }
    }

    private fun stringArray(table: TomlTable, key: String): List<String>? {
        val values = table.getArray(key) ?: return null
        return values.toList().map { value ->
            require(value is String) { "$key must contain only strings" }
            value
        }
    }

}

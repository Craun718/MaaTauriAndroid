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
    val maaDir: String,
    val agent: AgentProfile?,
)

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

object PiProfileReader {
    fun read(file: File): PiProfile {
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
        val agent: AgentProfile? = agentTable?.let { table -> readAgent(table, file) }
        return PiProfile(
            file = file,
            assets = requiredPath(result, "pi_assets", file),
            // pi_include now means "also pack this", never "pack only this".
            extraEntries = stringArray(result, "pi_include").orEmpty(),
            resourceId = resourceId(result),
            maaDir = result.getString("maa_dir") ?: "vendor/maa/android",
            agent = agent,
        )
    }

    private fun readAgent(table: TomlTable, profileFile: File): AgentProfile {
        val runtimes: List<Any> = table.getArray("runtimes")?.toList() ?: emptyList()
        require(runtimes.isNotEmpty()) { "agent.runtimes must contain at least one runtime" }
        return AgentProfile(
            timeoutMs = table.getLong("timeout_ms") ?: 15_000L,
            runtimes = runtimes.map { value ->
                require(value is TomlTable) { "agent.runtimes entries must be tables" }
                readRuntime(value, profileFile)
            },
        )
    }

    private fun readRuntime(table: TomlTable, profileFile: File): AgentRuntimeProfile {
        val bundle = requiredPath(table, "bundle", profileFile)
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
                value
            } ?: emptyMap(),
        )
    }

    private fun requiredString(table: TomlTable, key: String): String {
        val value: String? = table.getString(key)
        return value?.takeIf(String::isNotEmpty)
            ?: throw IllegalArgumentException("$key is required")
    }

    private fun requiredPath(table: TomlTable, key: String, profileFile: File): String {
        val value = requiredString(table, key)
        if (File(value).isAbsolute) {
            return value
        }
        val parent = requireNotNull(profileFile.parentFile) {
            "${profileFile.invariantSeparatorsPath} must have a parent directory"
        }
        return parent.resolve(value).canonicalPath
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

    private fun stringArray(table: TomlTable, key: String): List<String>? {
        val values = table.getArray(key) ?: return null
        return values.toList().map { value ->
            require(value is String) { "$key must contain only strings" }
            value
        }
    }

}

package top.natsuu.mta.kotlin

import org.tomlj.Toml
import org.tomlj.TomlTable
import java.io.File

data class PiProfile(
    val file: File,
    val assets: String?,
    val include: List<String>?,
    val exclude: List<String>,
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
    /**
     * Optional pin. When set, the build refuses to package an archive whose digest differs.
     * When omitted, the build records the archive's actual digest instead, which is what the
     * on-device check compares the packaged runtime against.
     */
    val bundleSha256: String?,
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

        val agentTable = result.getTable("agent")
        val agent: AgentProfile? = agentTable?.let { table -> readAgent(table, file) }
        return PiProfile(
            file = file,
            assets = requiredPath(result, "pi_assets", file),
            include = stringArray(result, "pi_include"),
            exclude = stringArray(result, "pi_exclude").orEmpty(),
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
            bundleSha256 = table.getString("bundle_sha256")?.lowercase()?.also { value ->
                require(value.length == 64 && value.all { char ->
                    char in '0'..'9' || char in 'a'..'f'
                }) {
                    "agent bundle_sha256 must be a SHA-256 digest"
                }
            },
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

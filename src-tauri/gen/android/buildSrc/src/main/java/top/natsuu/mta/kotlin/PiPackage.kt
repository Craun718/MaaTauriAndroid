package top.natsuu.mta.kotlin

import groovy.json.JsonSlurper
import java.io.File

/**
 * Resolves the file set a MaaFramework Project Interface needs at runtime.
 *
 * The set is derived from `interface.json` rather than from a hand-written glob list,
 * because a glob list rots silently. M9A v4.9.0 renamed its translation directory from
 * `i18n` to `locales` while the profile still matched the old name: nothing was copied,
 * the build stayed green, and the APK shipped an `interface.json` pointing at translation
 * files that were not inside it. On device that is a hard project-load failure.
 *
 * So the resolver follows the protocol's own references and reports a declared path that
 * is absent instead of quietly skipping it.
 */
object PiPackage {
    const val INTERFACE_FILE = "interface.json"

    /**
     * Root of the Agent payload. The protocol points `agent[].child_args` at an entrypoint
     * inside the project (`agent/main.py` for M9A) but never names the directory that has
     * to ship with it, so the Client fixes it here. Upstream's own release builder ships
     * the same `agent` directory whenever `interface.json` declares an agent, see
     * `resource/m9a/tools/build-release.mjs` (`releasePackagePaths`).
     */
    private const val AGENT_DIRECTORY = "agent"

    /**
     * Directories the Client ships although the protocol does not declare them: the Agent
     * reads its bundled tables from `data/` and keeps its hot-update manifests there.
     * Upstream lists the same directory under `optionalPackagePaths`.
     */
    private val OPTIONAL_DIRECTORIES = listOf("data")

    /**
     * Keys whose value may name a file. The schema documents these as "file path, URL or
     * plain text", so a value is only treated as a path when it actually resolves.
     */
    private val PATH_KEYS = setOf("icon", "contact", "license", "welcome", "description", "doc", "desc")

    /** Markdown inline links and images, e.g. `![guide](resource/announcement/images/x.png)`. */
    private val MARKDOWN_LINK = Regex("""!?\[[^\]]*]\(\s*([^)\s]+)""")

    /** A URI scheme, which marks a value as remote rather than project-relative. */
    private val URL_SCHEME = Regex("""^[A-Za-z][A-Za-z0-9+.-]*://""")

    /** A Windows drive letter, which is never project-relative. */
    private val DRIVE_LETTER = Regex("""^[A-Za-z]:""")

    fun plan(projectRoot: File, extraEntries: List<String> = emptyList()): PiPackagePlan {
        val root = projectRoot.canonicalFile
        val interfaceFile = root.resolve(INTERFACE_FILE)
        require(interfaceFile.isFile) {
            "the Project Interface has no $INTERFACE_FILE: ${root.invariantSeparatorsPath}"
        }
        val document = readObject(interfaceFile, INTERFACE_FILE)

        val entries = linkedSetOf<String>()
        val missing = linkedSetOf<String>()
        val imported = mutableListOf<Map<*, *>>()

        // Records `path` when it resolves inside the project. A protocol-declared path that
        // does not exist is reported rather than dropped, so a rename upstream cannot pass.
        fun record(path: String, required: Boolean) {
            val normalized = normalize(path) ?: return
            if (root.resolve(normalized).exists()) {
                entries += normalized
            } else if (required) {
                missing += normalized
            }
        }

        entries += INTERFACE_FILE

        // `import` names the files that actually hold tasks, options and presets.
        for (path in stringList(document["import"])) {
            record(path, required = true)
            val file = normalize(path)?.let(root::resolve)
            if (file != null && file.isFile) {
                imported += readObject(file, path)
            }
        }

        // `languages` maps a locale to its translation file.
        val languagePaths = (document["languages"] as? Map<*, *>)
            ?.values
            ?.filterIsInstance<String>()
            .orEmpty()
        languagePaths.forEach { record(it, required = true) }

        // `resource[].path` and `controller[].attach_resource_path` are MaaFW load roots.
        objectMapList(document["resource"]).forEach { resource ->
            stringList(resource["path"]).forEach { record(it, required = true) }
        }
        objectMapList(document["controller"]).forEach { controller ->
            stringList(controller["attach_resource_path"]).forEach { record(it, required = true) }
        }

        // Icon and rich-text keys at any depth, on the interface and on every imported file.
        val translations = defaultTranslations(root, languagePaths)
        for (documentFile in listOf(document) + imported) {
            collectPathValues(documentFile, translations) { record(it, required = false) }
        }

        // Rich text may embed project-relative images with markdown. Missing ones are not
        // reported, because plain prose is indistinguishable from a path that broke.
        for (locale in languagePaths) {
            val file = normalize(locale)?.let(root::resolve) ?: continue
            if (!file.isFile) continue
            readObject(file, locale).values
                .filterIsInstance<String>()
                .forEach { value -> markdownTargets(value).forEach { record(it, required = false) } }
        }

        // An interface that declares `agent` needs the payload its `child_args` run.
        val agents = objectMapList(document["agent"])
        if (agents.isNotEmpty()) {
            record(AGENT_DIRECTORY, required = true)
            for (agent in agents) {
                for (argument in stringList(agent["child_args"])) {
                    if (argument.startsWith("-") || URL_SCHEME.containsMatchIn(argument)) continue
                    if (DRIVE_LETTER.containsMatchIn(argument) || argument.startsWith("/")) continue
                    if (argument.endsWith(".py") && !root.resolve(argument).isFile) {
                        missing += argument
                    }
                }
            }
        }
        OPTIONAL_DIRECTORIES.forEach { record(it, required = false) }

        // Profile extras can only widen the pack set. They are treated as declared paths:
        // a missing entry fails the build rather than being quietly skipped.
        extraEntries.forEach { record(it, required = true) }

        return PiPackagePlan(entries.toList(), missing.toList())
    }

    /**
     * Walks any document and visits every value held by a path-capable key. Keys that name
     * a path are not recursed into, since their value is a string or a list of strings.
     */
    private fun collectPathValues(
        value: Any?,
        translations: Map<String, String>,
        visit: (String) -> Unit,
    ) {
        when (value) {
            is Map<*, *> -> value.forEach { (key, nested) ->
                if (key is String && key in PATH_KEYS) {
                    stringList(nested).forEach { visitPathValue(it, translations, visit) }
                } else {
                    collectPathValues(nested, translations, visit)
                }
            }
            is List<*> -> value.forEach { collectPathValues(it, translations, visit) }
        }
    }

    /**
     * A path-capable value may be a `$Key` translation reference, plain prose, a bare path,
     * or markdown that embeds images. Only the latter two can name project files.
     */
    private fun visitPathValue(
        value: String,
        translations: Map<String, String>,
        visit: (String) -> Unit,
    ) {
        val text = if (value.startsWith("\$")) {
            translations[value.substring(1)] ?: return
        } else {
            value
        }
        val trimmed = text.trim()
        if (URL_SCHEME.containsMatchIn(trimmed)) return
        // A bare path never contains whitespace or newlines; prose does.
        if (trimmed.isNotEmpty() && trimmed.none { it.isWhitespace() }) {
            visit(trimmed)
        }
        markdownTargets(text).forEach(visit)
    }

    private fun markdownTargets(text: String): List<String> =
        MARKDOWN_LINK.findAll(text)
            .map { it.groupValues[1] }
            .filter { !URL_SCHEME.containsMatchIn(it) && !it.startsWith("#") }
            .toList()

    /**
     * Translations used to resolve `$Key` icon references. Mirrors the runtime loader and
     * [PiLauncherIcon]: `zh_cn` first, then the first declared language.
     */
    private fun defaultTranslations(root: File, languagePaths: List<String>): Map<String, String> {
        for (path in languagePaths.sortedBy { if (it.contains("zh_cn")) 0 else 1 }) {
            val file = normalize(path)?.let(root::resolve) ?: continue
            if (!file.isFile) continue
            val parsed = runCatching { readObject(file, path) }.getOrNull() ?: continue
            return parsed.entries.mapNotNull { (key, value) ->
                if (key is String && value is String) key to value else null
            }.toMap()
        }
        return emptyMap()
    }

    private fun readObject(file: File, label: String): Map<*, *> {
        val parsed = JsonSlurper().parse(file)
        require(parsed is Map<*, *>) { "$label must contain a JSON object" }
        return parsed
    }

    private fun objectMapList(value: Any?): List<Map<*, *>> =
        (value as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()

    private fun stringList(value: Any?): List<String> = when (value) {
        is String -> listOf(value)
        is List<*> -> value.filterIsInstance<String>()
        else -> emptyList()
    }

    /**
     * Returns the project-relative form of `path`, or null when it is empty, absolute or
     * tries to escape the project root with `..`.
     */
    private fun normalize(path: String): String? {
        val trimmed = path.trim().removePrefix("./")
        if (trimmed.isEmpty() || trimmed == ".") return null
        if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return null
        if (DRIVE_LETTER.containsMatchIn(trimmed)) return null
        val segments = trimmed.split('/', '\\').filter { it.isNotEmpty() }
        if (segments.any { it == ".." }) return null
        return segments.joinToString("/")
    }
}

/**
 * The Project Interface tree to package.
 *
 * @param entries project-relative files and directories to copy.
 * @param missing paths declared by the protocol that do not exist in the source project.
 *   A non-empty list must fail the build.
 */
data class PiPackagePlan(
    val entries: List<String>,
    val missing: List<String>,
)

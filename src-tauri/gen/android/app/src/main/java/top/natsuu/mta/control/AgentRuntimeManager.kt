package top.natsuu.mta.control

import android.os.Binder
import android.os.ParcelFileDescriptor
import top.natsuu.mta.AgentLaunch
import top.natsuu.mta.ZipSafety
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

class AgentRuntimeManager(private val workspaceRoot: File) {
    private val processes = ConcurrentHashMap<String, ConcurrentHashMap<Int, AgentProcess>>()

    @Synchronized
    fun prepare(
        descriptorJson: String,
        fingerprint: String,
        runtimeIndex: Int,
        piArchive: ParcelFileDescriptor,
        runtimeBundle: ParcelFileDescriptor,
    ) {
        val uid = Binder.getCallingUid()
        val descriptor = parseDescriptor(descriptorJson)
        requireFingerprint(descriptor.optString("fingerprint"), "descriptor fingerprint")
        requireFingerprint(fingerprint, "fingerprint")
        require(descriptor.optString("fingerprint") == fingerprint) {
            "the supplied fingerprint does not match the descriptor"
        }

        val runtimes = descriptor.getJSONArray("runtimes")
        require(runtimeIndex in 0 until runtimes.length()) {
            "runtime index $runtimeIndex is out of range"
        }
        val runtime = runtimes.getJSONObject(runtimeIndex)
        val staging = stagingRoot(uid, fingerprint)
        if (runtimeIndex == 0) {
            staging.deleteRecursively()
            staging.mkdirs()
        } else {
            require(staging.isDirectory) { "agent runtime preparation is not sequential" }
        }

        try {
            if (runtimeIndex == 0) {
                val piZip = staging.resolve("pi.zip")
                val piHash = copyAndDigest(piArchive, piZip)
                require(piHash == descriptor.optString("piSha256")) {
                    "the Project Interface archive does not match its digest"
                }
            ZipSafety.validateNoSymlinks(piZip)
            ZipInstaller.extract(piZip, staging.resolve("pi"))
                val interfaceHash = sha256(staging.resolve("pi/interface.json"))
                require(interfaceHash == descriptor.optString("interfaceSha256")) {
                    "the Project Interface hash does not match the agent descriptor"
                }
            }

            val runtimeRoot = staging.resolve("runtime-$runtimeIndex")
            val runtimeZip = staging.resolve("runtime-$runtimeIndex.zip")
            val bundleHash = copyAndDigest(runtimeBundle, runtimeZip)
            require(bundleHash == runtime.optString("bundleSha256")) {
                "agent runtime $runtimeIndex does not match its bundle digest"
            }
            ZipSafety.validateNoSymlinks(runtimeZip)
            ZipInstaller.extract(runtimeZip, runtimeRoot)
            markExecutables(runtimeRoot, runtime.getJSONArray("executables"))

            staging.resolve("runtime.json").writeText(descriptorJson)
            staging.resolve("runtime.fingerprint").writeText(fingerprint)
            if (runtimeIndex == runtimes.length() - 1) {
                val final = finalRoot(uid, fingerprint)
                final.deleteRecursively()
                require(staging.renameTo(final)) { "could not publish the prepared agent runtime" }
            }
        } catch (error: Throwable) {
            staging.deleteRecursively()
            throw error
        }
    }

    @Synchronized
    fun start(
        fingerprint: String,
        runtimeIndex: Int,
        port: Int,
        nativeLibraryDir: String,
        executionId: String,
        piEnvironment: String,
    ): AgentLaunch {
        requireFingerprint(fingerprint, "fingerprint")
        require(port in 1024..65535) { "agent port $port is outside the allowed range" }
        requireExecutionId(executionId)
        require(nativeLibraryDir.isNotEmpty() && !nativeLibraryDir.contains('\u0000')) {
            "the native library directory is invalid"
        }
        val trackedProcesses = processes.computeIfAbsent(executionId) { ConcurrentHashMap() }
        require(runtimeIndex == trackedProcesses.size) {
            "agent runtimes must be launched in interface order"
        }
        require(!trackedProcesses.containsKey(runtimeIndex)) {
            "agent runtime $runtimeIndex is already running for this execution"
        }

        val root = finalRoot(Binder.getCallingUid(), fingerprint)
        val descriptor = parseDescriptor(root.resolve("runtime.json").readText())
        require(root.resolve("runtime.fingerprint").readText().trim() == fingerprint) {
            "the prepared agent fingerprint is invalid"
        }
        require(canonicalJsonWithoutFingerprint(descriptor) == descriptor.optString("fingerprint").toDigest()) {
            "the prepared agent descriptor fingerprint is invalid"
        }
        val runtimes = descriptor.getJSONArray("runtimes")
        require(runtimeIndex in 0 until runtimes.length()) {
            "runtime index $runtimeIndex is out of range"
        }
        val runtime = runtimes.getJSONObject(runtimeIndex)

        val executable = safeEntry(root, runtime.getString("exec"))
        require(executable.isFile && executable.canExecute()) {
            "the declared agent executable is missing or not executable"
        }
        val workingDir = safeEntry(
            root,
            substitute(runtime.getString("workingDir"), root, port, nativeLibraryDir),
        )
        require(workingDir.isDirectory) { "the declared agent working directory is missing" }

        val stdoutPipes = ParcelFileDescriptor.createPipe()
        val stdoutReadEnd = stdoutPipes[0]
        val stdoutWriteEnd = stdoutPipes[1]
        val stderrPipes = ParcelFileDescriptor.createPipe()
        val stderrReadEnd = stderrPipes[0]
        val stderrWriteEnd = stderrPipes[1]
        var started = false
        try {
            val command = mutableListOf(executable.absolutePath)
            runtime.getJSONArray("args").let { args ->
                for (index in 0 until args.length()) {
                    command.add(substitute(args.getString(index), root, port, nativeLibraryDir))
                }
            }
            val builder = ProcessBuilder(command)
                .directory(workingDir)
                .redirectInput(ProcessBuilder.Redirect.from(File("/dev/null")))
            val environment = builder.environment()
            environment.remove("LD_PRELOAD")
            runtime.optJSONObject("env")?.let { values ->
                val keys = values.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    require(key != "LD_PRELOAD") { "the descriptor may not override LD_PRELOAD" }
                    require(!key.startsWith("PI_")) {
                        "the descriptor may not set reserved PI_* environment variables"
                    }
                    environment[key] = substitute(values.getString(key), root, port, nativeLibraryDir)
                }
            }
            JSONObject(piEnvironment).let { overrides ->
                val keys = overrides.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    require(key.startsWith("PI_")) {
                        "the Project Interface environment may only set PI_* variables"
                    }
                    environment[key] = overrides.getString(key)
                }
            }
            environment["HOME"] = root.resolve("home").absolutePath
            environment["TMPDIR"] = root.resolve("tmp").absolutePath
            root.resolve("home").mkdirs()
            root.resolve("tmp").mkdirs()

            val process = builder.start()
            started = true
            pipeOutput(process.inputStream, stdoutWriteEnd, executionId, "stdout")
            pipeOutput(process.errorStream, stderrWriteEnd, executionId, "stderr")
            val launchId = UUID.randomUUID().toString()
            val tracked = AgentProcess(launchId, process, stdoutReadEnd, stderrReadEnd)
            trackedProcesses[runtimeIndex] = tracked
            thread(name = "maa-tauri-agent-wait-$executionId") {
                process.waitFor()
                trackedProcesses.remove(runtimeIndex, tracked)
            }
            return AgentLaunch(
                launchId,
                stdoutReadEnd,
                stderrReadEnd,
            )
        } finally {
            if (!started) {
                runCatching { stdoutReadEnd.close() }
                runCatching { stdoutWriteEnd.close() }
                runCatching { stderrReadEnd.close() }
                runCatching { stderrWriteEnd.close() }
            }
        }
    }

    @Synchronized
    fun stop(executionId: String) {
        requireExecutionId(executionId)
        processes.remove(executionId)?.values?.forEach(AgentProcess::stop)
    }

    @Synchronized
    fun stopAll() {
        val entries = processes.entries.toList()
        processes.clear()
        entries.forEach { entry -> entry.value.values.forEach(AgentProcess::stop) }
    }

    private fun copyAndDigest(input: ParcelFileDescriptor, target: File): String {
        target.parentFile?.mkdirs()
        val digest = MessageDigest.getInstance("SHA-256")
        ParcelFileDescriptor.AutoCloseInputStream(input).use { stream ->
            target.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                    output.write(buffer, 0, count)
                }
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun pipeOutput(
        input: InputStream,
        output: ParcelFileDescriptor,
        executionId: String,
        stream: String,
    ) {
        thread(name = "maa-tauri-agent-$executionId-$stream") {
            ParcelFileDescriptor.AutoCloseOutputStream(output).use { destination ->
                input.use { source -> source.copyTo(destination) }
            }
        }
    }

    private fun markExecutables(root: File, paths: JSONArray) {
        for (index in 0 until paths.length()) {
            val file = safeEntry(root, paths.getString(index))
            require(file.isFile) { "declared executable is missing: ${paths.getString(index)}" }
            require(file.setExecutable(true, false)) {
                "could not mark executable: ${paths.getString(index)}"
            }
        }
    }

    private fun safeEntry(root: File, relative: String): File {
        require(relative.isNotEmpty() && !relative.contains('\u0000')) {
            "an agent path may not be empty or contain NUL"
        }
        require(!File(relative).isAbsolute) { "an agent path may not be absolute: $relative" }
        require(relative.split('/', '\\').none { it == ".." }) {
            "an agent path may not escape its runtime root: $relative"
        }
        val output = root.resolve(relative)
        require(output.canonicalPath.startsWith(root.canonicalPath + File.separator)) {
            "an agent path escapes its runtime root: $relative"
        }
        return output
    }

    private fun substitute(
        value: String,
        root: File,
        port: Int,
        nativeLibraryDir: String,
    ): String = value
        .replace("{identifier}", port.toString())
        .replace("{bundle}", root.absolutePath)
        .replace("{pi}", root.resolve("pi").absolutePath)
        .replace("{nativeLib}", nativeLibraryDir)

    private fun parseDescriptor(descriptorJson: String): JSONObject {
        val descriptor = JSONObject(descriptorJson)
        require(descriptor.optInt("schemaVersion") == 1) { "unsupported agent descriptor schema" }
        require(descriptor.optString("abi") == "arm64-v8a") { "unsupported Android agent ABI" }
        requireFingerprint(descriptor.optString("interfaceSha256"), "interface hash")
        requireFingerprint(descriptor.optString("piSha256"), "PI archive hash")
        requireFingerprint(descriptor.optString("fingerprint"), "descriptor fingerprint")
        require(descriptor.optLong("timeoutMs") in 1..600_000) { "invalid agent timeout" }
        val runtimes = descriptor.optJSONArray("runtimes")
        require(runtimes != null && runtimes.length() > 0) { "the descriptor has no agent runtime" }
        for (index in 0 until runtimes.length()) {
            val runtime = runtimes.getJSONObject(index)
            require(runtime.optInt("interfaceIndex") == index) { "agent runtime indexes are not ordered" }
            requireFingerprint(runtime.optString("bundleSha256"), "runtime bundle hash")
            validateRelativePath(runtime.getString("exec"), index, "exec")
            val executables = runtime.getJSONArray("executables")
            require(executables.length() > 0) { "runtime $index declares no executables" }
            for (pathIndex in 0 until executables.length()) {
                validateRelativePath(executables.getString(pathIndex), index, "executables")
            }
            require(runtime.getJSONArray("args").length() > 0) { "runtime $index has no command" }
            validateRelativePath(runtime.getString("workingDir"), index, "workingDir")
            runtime.optJSONObject("env")?.let { values ->
                require(!values.has("LD_PRELOAD")) { "runtime $index may not override LD_PRELOAD" }
            }
        }
        return descriptor
    }

    private fun validateRelativePath(value: String, index: Int, field: String) {
        require(value.isNotEmpty() && !File(value).isAbsolute &&
            value.split('/', '\\').none { it == ".." } && !value.contains('\u0000')) {
            "runtime $index $field is not a safe relative path"
        }
    }

    private fun requireFingerprint(value: String, label: String) {
        require(value.length == 64 && value.all { char ->
            char in '0'..'9' || char in 'a'..'f'
        }) { "$label is not a SHA-256 digest" }
    }

    private fun requireExecutionId(value: String) {
        require(value.length <= 128 && value.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
            "the execution id contains unsafe characters"
        }
    }

    private fun stagingRoot(uid: Int, fingerprint: String): File =
        workspaceRoot.resolve(uid.toString()).resolve(".staging-$fingerprint")

    private fun finalRoot(uid: Int, fingerprint: String): File {
        val root = workspaceRoot.resolve(uid.toString()).resolve(fingerprint)
        require(root.exists() || root.mkdirs()) { "the prepared agent workspace is unavailable" }
        return root
    }

    private fun canonicalJsonWithoutFingerprint(descriptor: JSONObject): String {
        val canonical = JSONObject(descriptor.toString())
        canonical.remove("fingerprint")
        return canonicalJson(canonical)
    }

    private fun canonicalJson(value: Any): String = when (value) {
        is JSONObject -> value.keys().asSequence().sorted().joinToString(
            ",",
            "{",
            "}",
        ) { key -> "${JSONObject.quote(key)}:${canonicalJson(value.get(key))}" }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { index ->
            canonicalJson(value.get(index))
        }
        is String -> JSONObject.quote(value)
        else -> value.toString()
    }

    private fun String.toDigest(): String = MessageDigest.getInstance("SHA-256")
        .digest(toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private class AgentProcess(
        val launchId: String,
        val process: Process,
        val stdout: ParcelFileDescriptor,
        val stderr: ParcelFileDescriptor,
    ) {
        fun stop() {
            process.destroy()
            if (!process.waitFor(2_000, java.util.concurrent.TimeUnit.MILLISECONDS)) {
                process.destroyForcibly()
            }
            runCatching { stdout.close() }
            runCatching { stderr.close() }
        }
    }

    private object ZipInstaller {
        private const val MAX_ENTRIES = 100_000
        private const val MAX_TOTAL_BYTES = 1L shl 30
        private const val MAX_RATIO = 1_000L

        fun extract(archiveFile: File, destination: File) {
            destination.deleteRecursively()
            destination.mkdirs()
            var entries = 0
            var totalUncompressed = 0L
            var totalCompressed = 0L
            val prefix = destination.canonicalPath + File.separator
            java.util.zip.ZipInputStream(archiveFile.inputStream().buffered()).use { archive ->
                while (true) {
                    val entry = archive.nextEntry ?: break
                    require(++entries <= MAX_ENTRIES) { "agent archive has too many entries" }
                    val output = destination.resolve(entry.name)
                    require(!entry.name.contains('\u0000') && !File(entry.name).isAbsolute &&
                        entry.name.split('/', '\\').none { it == ".." } &&
                        output.canonicalPath.startsWith(prefix)) {
                        "unsafe agent archive entry: ${entry.name}"
                    }
                    if (entry.isDirectory) {
                        require(output.mkdirs() || output.isDirectory) {
                            "could not create agent archive directory: ${entry.name}"
                        }
                    } else {
                        output.parentFile?.mkdirs()
                        output.outputStream().use { stream -> archive.copyTo(stream) }
                        totalUncompressed += output.length()
                        totalCompressed += entry.compressedSize.takeIf { it >= 0 } ?: output.length()
                        require(totalUncompressed <= MAX_TOTAL_BYTES) {
                            "agent archive exceeds the installed size limit"
                        }
                        require(totalUncompressed <= totalCompressed * MAX_RATIO + (1 shl 20)) {
                            "agent archive has an unsafe compression ratio"
                        }
                    }
                    archive.closeEntry()
                }
            }
        }
    }
}

package top.natsuu.mta.control

import android.system.Os
import android.system.OsConstants
import android.os.Binder
import android.os.ParcelFileDescriptor
import top.natsuu.mta.AgentLaunch
import top.natsuu.mta.ZipSafety
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

class AgentRuntimeManager(private val workspaceRoot: File) {
    private val processes = ConcurrentHashMap<String, ConcurrentHashMap<Int, AgentProcess>>()

    @Synchronized
    fun prepare(
        descriptorJson: String,
        runtimeIndex: Int,
        piArchive: ParcelFileDescriptor,
        runtimeBundle: ParcelFileDescriptor,
    ) {
        val uid = Binder.getCallingUid()
        val descriptor = parseDescriptor(descriptorJson)

        val runtimes = descriptor.getJSONArray("runtimes")
        require(runtimeIndex in 0 until runtimes.length()) {
            "runtime index $runtimeIndex is out of range"
        }
        val runtime = runtimes.getJSONObject(runtimeIndex)
        val staging = stagingRoot(uid)
        if (runtimeIndex == 0) {
            staging.deleteRecursively()
            staging.mkdirs()
        } else {
            require(staging.isDirectory) { "agent runtime preparation is not sequential" }
        }

        try {
            if (runtimeIndex == 0) {
                val piZip = staging.resolve("pi.zip")
                copyTo(piArchive, piZip)
                ZipSafety.validateNoSymlinks(piZip)
                ZipInstaller.extract(piZip, staging.resolve("pi"))
            }

            val runtimeRoot = staging.resolve("runtime-$runtimeIndex")
            val runtimeZip = staging.resolve("runtime-$runtimeIndex.zip")
            copyTo(runtimeBundle, runtimeZip)
            ZipSafety.validateNoSymlinks(runtimeZip)
            ZipInstaller.extract(runtimeZip, runtimeRoot)
            markTreeExecutable(runtimeRoot)
            markExecutables(runtimeRoot, runtime.getJSONArray("executables"))

            staging.resolve("runtime.json").writeText(descriptorJson)
            if (runtimeIndex == runtimes.length() - 1) {
                val final = finalRoot(uid)
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
        runtimeIndex: Int,
        port: Int,
        nativeLibraryDir: String,
        executionId: String,
        piEnvironment: String,
    ): AgentLaunch {
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

        val root = finalRoot(Binder.getCallingUid())
        val descriptor = parseDescriptor(root.resolve("runtime.json").readText())
        val runtimes = descriptor.getJSONArray("runtimes")
        require(runtimeIndex in 0 until runtimes.length()) {
            "runtime index $runtimeIndex is out of range"
        }
        val runtime = runtimes.getJSONObject(runtimeIndex)

        val runtimeRoot = safeEntry(root, "runtime-$runtimeIndex")
        val executable = safeEntry(runtimeRoot, runtime.getString("exec"))
        require(executable.isFile && executable.canExecute()) {
            "the declared agent executable is missing or not executable: " +
                executableDiagnostics(executable)
        }
        val workingDirValue = substitute(
            runtime.getString("workingDir"),
            runtimeRoot,
            root,
            port,
            nativeLibraryDir,
        )
        val workingDir = safeEntry(
            if (File(workingDirValue).isAbsolute) root else runtimeRoot,
            workingDirValue,
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
                    command.add(
                        substitute(args.getString(index), runtimeRoot, root, port, nativeLibraryDir),
                    )
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
                    environment[key] = substitute(
                        values.getString(key),
                        runtimeRoot,
                        root,
                        port,
                        nativeLibraryDir,
                    )
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

    private fun copyTo(input: ParcelFileDescriptor, target: File) {
        target.parentFile?.mkdirs()
        ParcelFileDescriptor.AutoCloseInputStream(input).use { stream ->
            target.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
            }
        }
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

    private fun markTreeExecutable(root: File) {
        root.walkBottomUp().filter(File::isFile).forEach { file ->
            require(file.setExecutable(true, false)) {
                "could not mark agent runtime file executable: ${file.relativeToOrNull(root)}"
            }
        }
    }

    private fun executableDiagnostics(executable: File): String {
        val canonicalPath = runCatching { executable.canonicalPath }.getOrDefault("<unknown>")
        val accessX = runCatching {
            Os.access(executable.absolutePath, OsConstants.X_OK)
        }.getOrNull()
        val permissions = runCatching {
            val mode = Os.stat(executable.absolutePath).st_mode
            val mask = OsConstants.S_IRWXU or OsConstants.S_IRWXG or OsConstants.S_IRWXO
            mode.and(mask).toString(8).padStart(3, '0')
        }.getOrNull()

        return buildString {
            append(executable.absolutePath)
            append(" (canonical=$canonicalPath")
            append(", exists=${executable.exists()}")
            append(", isFile=${executable.isFile}")
            append(", isDirectory=${executable.isDirectory}")
            append(", canRead=${executable.canRead()}")
            append(", canWrite=${executable.canWrite()}")
            append(", canExecute=${executable.canExecute()}")
            append(", accessX_OK=$accessX")
            append(", mode=$permissions")
            append(", uid=${Os.getuid()}")
            append(", gid=${Os.getgid()}")
            append(")")
        }
    }

    private fun safeEntry(root: File, relative: String): File {
        require(relative.isNotEmpty() && !relative.contains('\u0000')) {
            "an agent path may not be empty or contain NUL"
        }
        require(relative.split('/', '\\').none { it == ".." }) {
            "an agent path may not escape its runtime root: $relative"
        }
        val rawPath = File(relative)
        val output = if (rawPath.isAbsolute) rawPath else root.resolve(relative)
        require(output.canonicalPath.startsWith(root.canonicalPath + File.separator)) {
            "an agent path escapes its runtime root: $relative"
        }
        return output
    }

    private fun substitute(
        value: String,
        runtimeRoot: File,
        agentRoot: File,
        port: Int,
        nativeLibraryDir: String,
    ): String = value
        .replace("{identifier}", port.toString())
        .replace("{bundle}", runtimeRoot.absolutePath)
        .replace("{pi}", agentRoot.resolve("pi").absolutePath)
        .replace("{nativeLib}", nativeLibraryDir)

    private fun parseDescriptor(descriptorJson: String): JSONObject {
        val descriptor = JSONObject(descriptorJson)
        require(descriptor.optInt("schemaVersion") == 1) { "unsupported agent descriptor schema" }
        require(descriptor.optString("abi") == "arm64-v8a") { "unsupported Android agent ABI" }
        require(descriptor.optLong("timeoutMs") in 1..600_000) { "invalid agent timeout" }
        val runtimes = descriptor.optJSONArray("runtimes")
        require(runtimes != null && runtimes.length() > 0) { "the descriptor has no agent runtime" }
        for (index in 0 until runtimes.length()) {
            val runtime = runtimes.getJSONObject(index)
            require(runtime.optInt("interfaceIndex") == index) { "agent runtime indexes are not ordered" }
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

    private fun requireExecutionId(value: String) {
        require(value.length <= 128 && value.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
            "the execution id contains unsafe characters"
        }
    }

    private fun stagingRoot(uid: Int): File =
        workspaceRoot.resolve(uid.toString()).resolve(".staging-agent")

    private fun finalRoot(uid: Int): File {
        val root = workspaceRoot.resolve(uid.toString()).resolve("agent")
        require(root.exists() || root.mkdirs()) { "the prepared agent workspace is unavailable" }
        return root
    }

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

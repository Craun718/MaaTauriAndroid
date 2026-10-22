package top.natsuu.mta.control

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID

/** A failure remains actionable even if optional stat/mount diagnostics fail. */
internal class DirectoryAccessFailure(val diagnostic: String, cause: Exception) :
    IllegalStateException("MTA_DIRECTORY_ACCESS=$diagnostic", cause)

internal data class DirectoryMount(val point: String, val fs: String, val options: String)

internal object DirectoryAccess {
    fun mount(path: String, lines: Sequence<String>): DirectoryMount? = lines.mapNotNull { line ->
        val halves = line.split(" - ", limit = 2)
        if (halves.size != 2) return@mapNotNull null
        val fields = halves[0].split(' ')
        val filesystem = halves[1].split(' ')
        if (fields.size < 6 || filesystem.size < 3) return@mapNotNull null
        val point = Regex("\\\\([0-7]{3})").replace(fields[4]) { it.groupValues[1].toInt(8).toChar().toString() }
        if (path != point && !path.startsWith(if (point == "/") "/" else "$point/")) return@mapNotNull null
        DirectoryMount(point, filesystem[0], fields[5] + "," + filesystem[2])
    }.maxByOrNull { it.point.length }

    fun kind(errno: Int?): String = when (errno) {
        OsConstants.EACCES, OsConstants.EPERM -> "permission"
        OsConstants.EROFS -> "readOnly"
        OsConstants.ENOSPC, OsConstants.EDQUOT -> "noSpace"
        OsConstants.ENOTDIR, OsConstants.EEXIST -> "notDirectory"
        else -> "unknown"
    }

    fun check(directory: File) {
        checked(directory, "createDirectory") { ensureDirectory(directory) }
        checked(directory, "accessDirectory") {
            kotlin.check(Os.access(directory.path, OsConstants.R_OK or OsConstants.W_OK or OsConstants.X_OK)) {
                "directory access was rejected"
            }
        }
        val probe = File(directory, ".mta-probe-${UUID.randomUUID()}")
        checked(directory, "writeReadProbe") {
            val descriptor = Os.open(probe.path, OsConstants.O_RDWR or OsConstants.O_CREAT or OsConstants.O_EXCL, 384)
            try {
                val value = byteArrayOf(77, 84, 65)
                if (Os.write(descriptor, value, 0, value.size) != value.size) throw IOException("short probe write")
                Os.lseek(descriptor, 0, OsConstants.SEEK_SET)
                val read = ByteArray(value.size)
                if (Os.read(descriptor, read, 0, read.size) != value.size || !value.contentEquals(read)) {
                    throw IOException("directory probe read-back mismatch")
                }
            } finally {
                runCatching { Os.close(descriptor) }
                runCatching { Os.unlink(probe.path) }
            }
        }
    }

    private fun ensureDirectory(directory: File) {
        if (directory.isDirectory) return
        directory.parentFile?.let(::ensureDirectory)
        try {
            // Match File.mkdirs(): permissions are narrowed by the process umask.
            Os.mkdir(directory.path, 511)
        } catch (error: ErrnoException) {
            if (error.errno != OsConstants.EEXIST || !directory.isDirectory) throw error
        }
    }

    fun <T> checked(directory: File, operation: String, action: () -> T): T =
        guard(directory, operation, ::diagnose, action)

    /** Archive/agent errors stay intact unless the cause confirms a filesystem failure. */
    fun confirmedFailure(directory: File, operation: String, error: Throwable): Throwable {
        if (error is DirectoryAccessFailure || error !is Exception) return error
        if (kind(errno(error)) == "unknown") return error
        return runCatching { DirectoryAccessFailure(diagnose(directory, operation, error), error) }
            .getOrDefault(error)
    }

    private fun errno(error: Throwable): Int? = generateSequence(error) { it.cause }
        .filterIsInstance<ErrnoException>().firstOrNull()?.errno

    internal fun <T> guard(
        directory: File,
        operation: String,
        diagnose: (File, String, Exception) -> String,
        action: () -> T,
    ): T {
        try {
            return action()
        } catch (error: DirectoryAccessFailure) {
            throw error
        } catch (error: Exception) {
            if (error !is IOException && error !is ErrnoException && error !is SecurityException && error !is IllegalStateException) throw error
            val diagnostic = runCatching { diagnose(directory, operation, error) }.getOrElse {
                JSONObject().put("scope", "agentRuntime").put("operation", operation)
                    .put("path", directory.path).put("kind", "unknown")
                    .put("error", error.javaClass.simpleName).toString()
            }
            throw DirectoryAccessFailure(diagnostic, error)
        }
    }

    private fun diagnose(directory: File, operation: String, error: Exception): String {
        val errno = errno(error)
        val result = JSONObject().put("scope", "agentRuntime").put("operation", operation)
            .put("path", directory.absolutePath).put("kind", if (error is SecurityException) "permission" else kind(errno))
            .put("errno", errno ?: JSONObject.NULL).put("error", error.toString().take(512))
            .put("uid", Os.getuid()).put("gid", Os.getgid())
        runCatching {
            val parent = generateSequence(directory) { it.parentFile }.firstOrNull { it.exists() }
            if (parent != null) {
                val stat = Os.stat(parent.path)
                result.put("parent", JSONObject().put("path", parent.path).put("uid", stat.st_uid)
                    .put("gid", stat.st_gid).put("mode", stat.st_mode))
            }
        }
        runCatching {
            File("/proc/self/mountinfo").useLines { lines -> mount(directory.absolutePath, lines) }?.let {
                result.put("mount", JSONObject().put("point", it.point).put("fs", it.fs).put("options", it.options))
            }
        }
        return result.toString()
    }
}

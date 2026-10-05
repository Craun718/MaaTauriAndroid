package top.natsuu.mta

import android.content.Context
import java.io.File
import java.util.concurrent.locks.ReentrantLock
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream
import kotlin.concurrent.withLock

object PiInstaller {
    private const val ASSET_NAME = "pi.zip"
    private const val ROOT_NAME = "pi"
    private const val MARKER_NAME = ".maa_tauri_android-pi-marker"
    private val installLock = ReentrantLock()

    data class Progress(
        val phase: Phase,
        val copiedBytes: Long = 0,
        val totalArchiveBytes: Long = 0,
        val extractedEntries: Int = 0,
        val totalEntries: Int = 0,
        val currentFile: String? = null,
    ) {
        enum class Phase {
            COPYING,
            EXTRACTING,
        }
    }

    fun interface ProgressListener {
        fun onProgress(progress: Progress)
    }

    fun install(context: Context, force: Boolean = false, onProgress: ProgressListener? = null): File? {
        return installLock.withLock {
            performInstall(context, force, onProgress)
        }
    }

    private fun performInstall(
        context: Context,
        force: Boolean,
        onProgress: ProgressListener?,
    ): File? {
        val root = File(context.filesDir, ROOT_NAME)
        val marker = root.resolve(MARKER_NAME)
        // The package update time changes whenever the APK is replaced. If the
        // published marker still matches, the archive cannot have changed and
        // copying it merely to run the symlink scan dominates ordinary cold starts.
        if (!force && marker.isFile && marker.readText() == currentMarker(context) &&
            root.resolve("interface.json").isFile
        ) {
            return root
        }

        val archive = File(context.cacheDir, "maa-tauri-android-pi.zip")
        val input = try {
            context.assets.open(ASSET_NAME).buffered()
        } catch (_: java.io.FileNotFoundException) {
            return null
        }

        try {
            copyArchive(input, archive, onProgress)
            ZipSafety.validateNoSymlinks(archive)

            val staging = File(context.filesDir, "$ROOT_NAME.staging")
            staging.deleteRecursively()
            staging.mkdirs()
            extract(archive, staging, onProgress)

            val interfaceFile = staging.resolve("interface.json")
            require(interfaceFile.isFile) { "The packaged Project Interface has no interface.json" }

            root.deleteRecursively()
            if (!staging.renameTo(root)) {
                throw java.io.IOException("Could not install the Project Interface resources")
            }
            marker.writeText(currentMarker(context))
            return root
        } finally {
            archive.delete()
        }
    }

    /** Re-extracts the packaged archive even when the install marker matches. */
    fun reinstall(context: Context): File? {
        return install(context, force = true)
    }

    private fun currentMarker(context: Context): String {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return packageInfo.lastUpdateTime.toString()
    }

    private fun copyArchive(
        input: java.io.InputStream,
        destination: File,
        onProgress: ProgressListener?,
    ) {
        var copied = 0L
        val buffer = ByteArray(COPY_BUFFER_BYTES)
        destination.outputStream().use { output ->
            input.use { stream ->
                while (true) {
                    val read = stream.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    copied += read
                    onProgress?.onProgress(
                        Progress(
                            phase = Progress.Phase.COPYING,
                            copiedBytes = copied,
                        ),
                    )
                }
            }
        }
    }

    private fun extract(
        archive: File,
        destination: File,
        onProgress: ProgressListener?,
    ) {
        val destinationPrefix = "${destination.canonicalPath}${File.separator}"
        var entries = 0
        val totalEntries = countEntries(archive)
        val totalArchiveBytes = archive.length()
        val input = archive.inputStream().buffered()
        var totalUncompressed = 0L
        var totalCompressed = 0L
        ZipInputStream(input).use { archive ->
            while (true) {
                val entry = archive.nextEntry ?: break
                require(++entries <= MAX_ENTRIES) { "The Project Interface archive has too many entries" }
                val output = destination.resolve(entry.name)
                require(!entry.name.contains('\u0000') && !File(entry.name).isAbsolute &&
                    entry.name.split('/', '\\').none { it == ".." } &&
                    output.canonicalPath.startsWith(destinationPrefix)) {
                    "Invalid Project Interface archive entry: ${entry.name}"
                }

                if (entry.isDirectory) {
                    output.mkdirs()
                } else {
                    val before = output.length()
                    output.parentFile?.mkdirs()
                    output.outputStream().use { archive.copyTo(it) }
                    val bytes = output.length() - before
                    totalUncompressed += bytes
                    totalCompressed += entry.compressedSize.takeIf { it >= 0 } ?: bytes
                    require(totalUncompressed <= MAX_TOTAL_BYTES) {
                        "The Project Interface archive exceeds the installed size limit"
                    }
                    require(totalUncompressed <= totalCompressed * MAX_RATIO + (1 shl 20)) {
                        "The Project Interface archive has an unsafe compression ratio"
                    }
                }
                onProgress?.onProgress(
                    Progress(
                        phase = Progress.Phase.EXTRACTING,
                        copiedBytes = totalArchiveBytes,
                        totalArchiveBytes = totalArchiveBytes,
                        extractedEntries = entries,
                        totalEntries = totalEntries,
                        currentFile = entry.name,
                    ),
                )
                archive.closeEntry()
            }
        }
    }

    private fun countEntries(archive: File): Int =
        ZipFile(archive).use { zip -> zip.entries().asSequence().count() }

    private const val MAX_ENTRIES = 100_000
    private const val MAX_TOTAL_BYTES = 1L shl 30
    private const val MAX_RATIO = 1_000L
    private const val COPY_BUFFER_BYTES = 64 * 1024
}

package top.natsuu.mta

import android.content.Context
import java.io.File
import java.util.zip.ZipInputStream

object PiInstaller {
    private const val ASSET_NAME = "pi.zip"
    private const val ROOT_NAME = "pi"
    private const val MARKER_NAME = ".maa_tauri_android-pi-marker"

    fun install(context: Context): File? {
        val archive = File(context.cacheDir, "maa-tauri-android-pi.zip")
        val input = try {
            context.assets.open(ASSET_NAME).buffered()
        } catch (_: java.io.FileNotFoundException) {
            return null
        }

        try {
            archive.outputStream().use { output ->
                input.use { stream -> stream.copyTo(output) }
            }
            ZipSafety.validateNoSymlinks(archive)

            val root = File(context.filesDir, ROOT_NAME)
            val marker = root.resolve(MARKER_NAME)
            val currentMarker = currentMarker(context)
            if (marker.isFile && marker.readText() == currentMarker && root.resolve("interface.json").isFile) {
                return root
            }

            val staging = File(context.filesDir, "$ROOT_NAME.staging")
            staging.deleteRecursively()
            staging.mkdirs()
            extract(archive.inputStream().buffered(), staging)

            val interfaceFile = staging.resolve("interface.json")
            require(interfaceFile.isFile) { "The packaged Project Interface has no interface.json" }

            root.deleteRecursively()
            if (!staging.renameTo(root)) {
                throw java.io.IOException("Could not install the Project Interface resources")
            }
            marker.writeText(currentMarker)
            return root
        } finally {
            archive.delete()
        }
    }

    private fun currentMarker(context: Context): String {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return packageInfo.lastUpdateTime.toString()
    }

    private fun extract(input: java.io.InputStream, destination: File) {
        val destinationPrefix = "${destination.canonicalPath}${File.separator}"
        var entries = 0
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
                    output.parentFile?.mkdirs()
                    output.outputStream().use { archive.copyTo(it) }
                    totalUncompressed += output.length()
                    totalCompressed += entry.compressedSize.takeIf { it >= 0 } ?: output.length()
                    require(totalUncompressed <= MAX_TOTAL_BYTES) {
                        "The Project Interface archive exceeds the installed size limit"
                    }
                    require(totalUncompressed <= totalCompressed * MAX_RATIO + (1 shl 20)) {
                        "The Project Interface archive has an unsafe compression ratio"
                    }
                }
                archive.closeEntry()
            }
        }
    }

    private const val MAX_ENTRIES = 100_000
    private const val MAX_TOTAL_BYTES = 1L shl 30
    private const val MAX_RATIO = 1_000L
}

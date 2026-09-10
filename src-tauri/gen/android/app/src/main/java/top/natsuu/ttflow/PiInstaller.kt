package top.natsuu.ttflow

import android.content.Context
import java.io.File
import java.util.zip.ZipInputStream

object PiInstaller {
    private const val ASSET_NAME = "pi.zip"
    private const val ROOT_NAME = "pi"
    private const val MARKER_NAME = ".ttflow-pi-marker"

    fun install(context: Context): File? {
        val input = try {
            context.assets.open(ASSET_NAME).buffered()
        } catch (_: java.io.FileNotFoundException) {
            return null
        }

        input.use {
            val root = File(context.filesDir, ROOT_NAME)
            val marker = root.resolve(MARKER_NAME)
            val currentMarker = currentMarker(context)
            if (marker.isFile && marker.readText() == currentMarker && root.resolve("interface.json").isFile) {
                return root
            }

            val staging = File(context.filesDir, "$ROOT_NAME.staging")
            staging.deleteRecursively()
            staging.mkdirs()
            extract(input, staging)

            val interfaceFile = staging.resolve("interface.json")
            require(interfaceFile.isFile) { "The packaged Project Interface has no interface.json" }

            root.deleteRecursively()
            if (!staging.renameTo(root)) {
                throw java.io.IOException("Could not install the Project Interface resources")
            }
            marker.writeText(currentMarker)
            return root
        }
    }

    private fun currentMarker(context: Context): String {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return packageInfo.lastUpdateTime.toString()
    }

    private fun extract(input: java.io.InputStream, destination: File) {
        val destinationPrefix = "${destination.canonicalPath}${File.separator}"
        ZipInputStream(input).use { archive ->
            while (true) {
                val entry = archive.nextEntry ?: break
                val output = destination.resolve(entry.name)
                require(output.canonicalPath.startsWith(destinationPrefix)) {
                    "Invalid Project Interface archive entry: ${entry.name}"
                }

                if (entry.isDirectory) {
                    output.mkdirs()
                } else {
                    output.parentFile?.mkdirs()
                    output.outputStream().use { archive.copyTo(it) }
                }
                archive.closeEntry()
            }
        }
    }
}

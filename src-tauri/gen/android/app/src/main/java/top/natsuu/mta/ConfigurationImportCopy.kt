package top.natsuu.mta

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

internal class ConfigurationImportTooLarge : IOException("configuration backup is too large")

internal object ConfigurationImportCopy {
    const val MAX_BYTES = 4L * 1024L * 1024L

    fun copy(input: InputStream, output: OutputStream, limit: Long = MAX_BYTES) {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) return
            total += count
            if (total > limit) throw ConfigurationImportTooLarge()
            output.write(buffer, 0, count)
        }
    }
}

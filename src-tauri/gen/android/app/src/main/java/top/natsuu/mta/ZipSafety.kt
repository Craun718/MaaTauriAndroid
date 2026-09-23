package top.natsuu.mta

import java.io.File
import org.apache.commons.compress.archivers.zip.ZipFile

internal object ZipSafety {
    private const val S_IFMT = 0xf000
    private const val S_IFLNK = 0xa000

    fun validateNoSymlinks(archive: File) {
        ZipFile.builder()
            .setFile(archive)
            .get()
            .use { zip ->
                val entries = zip.entries
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    require(entry.unixMode and S_IFMT != S_IFLNK) {
                        "ZIP archives may not contain symlinks"
                    }
                }
            }
    }
}

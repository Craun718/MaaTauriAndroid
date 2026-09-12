package top.natsuu.mta

import java.io.File
import java.io.RandomAccessFile

internal object ZipSafety {
    private const val END_SIGNATURE = 0x06054b50
    private const val CENTRAL_SIGNATURE = 0x02014b50
    private const val S_IFLNK = 0xa000

    fun validateNoSymlinks(archive: File) {
        RandomAccessFile(archive, "r").use { file ->
            val end = findEndRecord(file)
            val entryCount = readUnsignedShort(file, end + 10)
            val directoryOffset = readUnsignedInt(file, end + 16)
            require(entryCount != 0xffff && directoryOffset != 0xffffffffL) {
                "ZIP64 agent archives are not supported"
            }

            file.seek(directoryOffset)
            repeat(entryCount) {
                val headerOffset = file.filePointer
                require(file.readInt().let { Integer.reverseBytes(it) } == CENTRAL_SIGNATURE) {
                    "the ZIP central directory is invalid"
                }

                val attributes = readUnsignedShortAt(file, headerOffset + 38)
                require(attributes and S_IFLNK != S_IFLNK) {
                    "ZIP archives may not contain symlinks"
                }

                val nameLength = readUnsignedShortAt(file, headerOffset + 28)
                val extraLength = readUnsignedShortAt(file, headerOffset + 30)
                val commentLength = readUnsignedShortAt(file, headerOffset + 32)
                file.seek(headerOffset + 46 + nameLength + extraLength + commentLength)
            }
        }
    }

    private fun findEndRecord(file: RandomAccessFile): Long {
        val scanLength = minOf(file.length(), 65_557L)
        val start = file.length() - scanLength
        file.seek(start)
        val bytes = ByteArray(scanLength.toInt())
        file.readFully(bytes)

        for (offset in bytes.indices.reversed()) {
            if (offset + 4 > bytes.size) continue
            val signature = (bytes[offset].toInt() and 0xff) or
                ((bytes[offset + 1].toInt() and 0xff) shl 8) or
                ((bytes[offset + 2].toInt() and 0xff) shl 16) or
                ((bytes[offset + 3].toInt() and 0xff) shl 24)
            if (signature == END_SIGNATURE) return start + offset
        }
        throw IllegalArgumentException("the ZIP end record is missing")
    }

    private fun readUnsignedShortAt(file: RandomAccessFile, offset: Long): Int {
        file.seek(offset)
        return readUnsignedShortAtPosition(file)
    }

    private fun readUnsignedShort(file: RandomAccessFile, position: Long): Int {
        file.seek(position)
        return readUnsignedShortAtPosition(file)
    }

    private fun readUnsignedShortAtPosition(file: RandomAccessFile): Int =
        file.readUnsignedShort().let { ((it and 0xff) shl 8) or (it ushr 8) }

    private fun readUnsignedInt(file: RandomAccessFile, position: Long): Long {
        file.seek(position)
        val value = file.readInt()
        return (Integer.reverseBytes(value).toLong() and 0xffffffffL)
    }
}

package top.natsuu.mta

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.*
import org.junit.Test

class ConfigurationImportCopyTest {
    @Test
    fun exactLimitIsAccepted() {
        val output = ByteArrayOutputStream()
        ConfigurationImportCopy.copy(ByteArrayInputStream(byteArrayOf(1, 2, 3)), output, 3)
        assertArrayEquals(byteArrayOf(1, 2, 3), output.toByteArray())
    }

    @Test(expected = ConfigurationImportTooLarge::class)
    fun rejectsUnknownLengthStreamsAboveTheLimit() {
        ConfigurationImportCopy.copy(ByteArrayInputStream(ByteArray(4)), ByteArrayOutputStream(), 3)
    }

    @Test(expected = IOException::class)
    fun readFailuresAreNotCancellation() {
        ConfigurationImportCopy.copy(object : InputStream() {
            override fun read(): Int = throw IOException("unreadable URI")
        }, ByteArrayOutputStream())
    }
}

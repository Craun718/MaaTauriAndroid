package top.natsuu.mta.control

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.*
import org.junit.Test

class OwnerLifelineTest {
    @Test
    fun eofClosesTheReaderAndReportsOwnerDeathOnce() {
        var closed = false
        var gone = 0
        val input = object : ByteArrayInputStream(byteArrayOf(1, 2)) {
            override fun close() { closed = true; super.close() }
        }
        OwnerLifeline.watch(input, { throw AssertionError(it) }, { gone++ })
        assertTrue(closed)
        assertEquals(1, gone)
    }

    @Test
    fun failedPipeStillReleasesTheService() {
        var failure = 0
        var gone = 0
        OwnerLifeline.watch(object : InputStream() {
            override fun read(): Int = throw IOException("broken pipe")
        }, { failure++ }, { gone++ })
        assertEquals(1, failure)
        assertEquals(1, gone)
    }
}

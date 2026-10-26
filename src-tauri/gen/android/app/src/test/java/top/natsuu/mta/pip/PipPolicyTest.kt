package top.natsuu.mta.pip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PipPolicyTest {
    @Test
    fun `aspect ratios support portrait and landscape and clamp platform limits`() {
        assertEquals(PipRatio(1280, 720), pipRatio(1280, 720))
        assertEquals(PipRatio(720, 1280), pipRatio(720, 1280))
        assertEquals(PipRatio(239, 100), pipRatio(1000, 1))
        assertEquals(PipRatio(100, 239), pipRatio(1, 1000))
        assertEquals(PipRatio(16, 9), pipRatio(0, 720))
        assertEquals(PipRatio(16, 9), pipRatio(720, -1))
    }

    @Test
    fun `native run completion revokes stale frontend eligibility`() {
        assertTrue(pipCanEnter(true, true, 12, 1280, 720))
        assertFalse(pipCanEnter(true, false, 12, 1280, 720))
        assertFalse(pipCanEnter(false, true, 12, 1280, 720))
        assertFalse(pipCanEnter(true, true, -1, 1280, 720))
        assertFalse(pipCanEnter(true, true, 12, 0, 720))
    }

    @Test
    fun `pip survives run completion while the virtual display remains live`() {
        assertTrue(pipHasDisplay(12, 1280, 720))
        assertFalse(pipHasDisplay(-1, 1280, 720))
        assertFalse(pipHasDisplay(12, 0, 720))
        assertFalse(pipHasDisplay(12, 1280, 0))
    }

    @Test
    fun `late destruction of an old PiP surface cannot detach its replacement`() {
        val targets = PreviewTargets<Any>()
        val stream = Any()
        val old = Any()
        val replacement = Any()
        targets.stream = stream
        targets.active = true
        assertSame(stream, targets.current)
        targets.acquire(old)
        targets.acquire(replacement)
        assertFalse(targets.release(old))
        assertSame(replacement, targets.current)
        assertTrue(targets.release(replacement))
        assertSame(stream, targets.current)
    }

    @Test
    fun `display stop prevents stale surface callbacks from restoring a released encoder`() {
        val targets = PreviewTargets<Any>()
        val pip = Any()
        targets.active = true
        targets.stream = Any()
        targets.acquire(pip)
        targets.clear()
        assertNull(targets.current)
        assertFalse(targets.release(pip))
        targets.acquire(pip)
        assertNull(targets.current)
        val nextStream = Any()
        targets.stream = nextStream
        targets.active = true
        assertSame(nextStream, targets.current)
    }
}

package top.natsuu.mta.pip

import android.view.Surface
import top.natsuu.mta.VirtualDisplayStreamHost
import top.natsuu.mta.control.ControlHost

/** Serializes JNI target changes with display start/stop and Surface destruction. */
object PreviewRouter {
    private val targets = PreviewTargets<Surface>()
    private var attached: Surface? = null

    @Synchronized
    fun start(stream: Surface?) {
        targets.stream = stream
        targets.active = true
        attach()
    }

    @Synchronized
    fun acquire(surface: Surface) {
        targets.acquire(surface)
        attach()
    }

    @Synchronized
    fun release(surface: Surface) {
        if (!targets.release(surface)) return
        attach()
        if (targets.active) VirtualDisplayStreamHost.requestSyncFrame()
    }

    @Synchronized
    fun stop() {
        targets.clear()
        attach()
    }

    private fun attach() {
        val target = targets.current
        if (attached === target) return
        runCatching { ControlHost.attachPreviewSurface(target) }
            .onSuccess { attached = target }
            .onFailure { android.util.Log.w("MTAPip", "Could not attach preview output", it) }
    }
}

package top.natsuu.mta.pip

internal data class PipRatio(val width: Int, val height: Int)

internal fun pipRatio(width: Int, height: Int): PipRatio {
    if (width <= 0 || height <= 0) return PipRatio(16, 9)
    val ratio = width.toDouble() / height
    return when {
        ratio > 2.39 -> PipRatio(239, 100)
        ratio < 1.0 / 2.39 -> PipRatio(100, 239)
        else -> PipRatio(width, height)
    }
}

/** The preview has one output. Releasing an obsolete Surface must not detach its successor. */
internal class PreviewTargets<T> {
    var stream: T? = null
    var pip: T? = null
        private set
    var active: Boolean = false
    val current: T? get() = if (active) pip ?: stream else null

    fun acquire(surface: T) {
        if (active) pip = surface
    }
    fun release(surface: T): Boolean {
        if (pip !== surface) return false
        pip = null
        return true
    }
    fun clear() {
        active = false
        stream = null
        pip = null
    }
}

internal fun pipCanEnter(requested: Boolean, runActive: Boolean, displayId: Int, width: Int, height: Int): Boolean =
    requested && runActive && pipHasDisplay(displayId, width, height)

/** A retained virtual display may outlive the run; PiP only needs a live output. */
internal fun pipHasDisplay(displayId: Int, width: Int, height: Int): Boolean =
    displayId >= 0 && width > 0 && height > 0

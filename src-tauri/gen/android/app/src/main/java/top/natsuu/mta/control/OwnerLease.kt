package top.natsuu.mta.control

import android.os.IBinder

/**
 * Owns the process-lifetime binder that claims the privileged service. The
 * synchronous acknowledgement proves that death watching is armed before the
 * caller can create resources that need crash cleanup.
 */
internal class OwnerLease(
    private val onOwnerGone: () -> Unit,
) {
    private val lock = Any()
    private var pending: OwnerWatch? = null
    private var watch: OwnerWatch? = null
    private var exiting = false
    private var diedDuringAttach = false

    val isAttached: Boolean
        get() = synchronized(lock) { !exiting && watch != null }

    /**
     * The owner is "pending" from setting the recipient through its successful
     * link. An obituary in that interval must turn the synchronous attach into
     * a rejection instead of first exposing a successful lease.
     */
    fun attach(owner: IBinder?): Int {
        if (owner == null) return RESULT_OWNER_MISSING

        synchronized(lock) {
            if (exiting) return RESULT_SERVICE_EXITING
            if (watch != null || pending != null) return RESULT_ALREADY_OWNED

            val nextWatch = OwnerWatch(owner) { handleOwnerGone(owner) }
            pending = nextWatch
            try {
                owner.linkToDeath(nextWatch.recipient, 0)
            } catch (_: Throwable) {
                if (pending === nextWatch) pending = null
                return if (diedDuringAttach) RESULT_SERVICE_EXITING else RESULT_WATCH_FAILED
            }

            if (diedDuringAttach) return RESULT_SERVICE_EXITING

            pending = null
            watch = nextWatch
            return RESULT_ATTACHED
        }
    }

    private fun handleOwnerGone(token: IBinder) {
        val shouldNotify = synchronized(lock) {
            val isCurrent = watch?.token === token
            val isAttaching = pending?.token === token
            if (exiting || (!isCurrent && !isAttaching)) return@synchronized false
            if (isAttaching) diedDuringAttach = true
            watch = null
            pending = null
            exiting = true
            true
        }
        if (shouldNotify) onOwnerGone()
    }

    private class OwnerWatch(
        val token: IBinder,
        val recipient: IBinder.DeathRecipient,
    )

    companion object {
        const val RESULT_ATTACHED = 0
        const val RESULT_OWNER_MISSING = 1
        const val RESULT_ALREADY_OWNED = 2
        const val RESULT_WATCH_FAILED = 3
        const val RESULT_SERVICE_EXITING = 4
    }
}

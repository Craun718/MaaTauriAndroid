package top.natsuu.mta

/** In-memory only: a new process cannot inherit a valid run from an old start Intent. */
internal class RunServiceLease {
    private var generation = 0L
    private var requested = false

    @Synchronized
    fun begin(): Long {
        generation++
        requested = true
        return generation
    }

    @Synchronized
    fun current(): Long = if (requested) generation else 0L

    @Synchronized
    fun cancel() { requested = false }

    @Synchronized
    fun finish(token: Long): Boolean {
        if (token == 0L || token != generation) return false
        requested = false
        return true
    }
}

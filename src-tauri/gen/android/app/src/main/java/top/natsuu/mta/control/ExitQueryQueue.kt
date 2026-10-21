package top.natsuu.mta.control

import java.util.concurrent.ConcurrentHashMap

/** Bounds queued polls; observed deaths bypass throttling without overlapping reads. */
internal class ExitQueryQueue(
    private val now: () -> Long,
    private val enqueue: (() -> Unit) -> Unit,
    private val query: (String) -> Unit,
) {
    private val nextQuery = ConcurrentHashMap<String, Long>()
    private val urgentQueries = ConcurrentHashMap.newKeySet<String>()

    fun record(packageName: String, urgent: Boolean = false) {
        if (urgent) urgentQueries.add(packageName)
        val previous = nextQuery.putIfAbsent(packageName, Long.MAX_VALUE)
        if (previous != null && (previous == Long.MAX_VALUE ||
            (!urgent && previous > now()) || !nextQuery.replace(packageName, previous, Long.MAX_VALUE))) return
        enqueue {
            urgentQueries.remove(packageName)
            try {
                query(packageName)
            } finally {
                nextQuery[packageName] = now() + 10_000L
                if (urgentQueries.remove(packageName)) record(packageName, urgent = true)
            }
        }
    }
}

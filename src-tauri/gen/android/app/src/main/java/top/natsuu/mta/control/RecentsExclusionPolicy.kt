package top.natsuu.mta.control

/** Attempt once per recently observed task, including failures on unsupported ROMs. */
internal class RecentsExclusionPolicy {
    private val attempted = LinkedHashSet<Int>()

    @Synchronized
    fun claim(sdk: Int, display: Int, taskDisplay: Int?, taskId: Int): Boolean {
        if (sdk < 37 || display <= 0 || taskDisplay != display || !attempted.add(taskId)) return false
        if (attempted.size > 32) attempted.remove(attempted.first())
        return true
    }
}

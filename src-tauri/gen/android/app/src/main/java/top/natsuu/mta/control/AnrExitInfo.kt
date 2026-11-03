package top.natsuu.mta.control

/**
 * Classifies the system-recorded reason behind an ANR. Exit descriptions come
 * from AOSP timeout sites and can be prefixed by "user request after error:"
 * when the user dismisses the ANR dialog.
 */
internal object AnrExitInfo {
    fun kindOf(description: String?): String {
        if (description.isNullOrBlank()) return "unknown"
        val normalized = description.lowercase()
        return when {
            "input dispatching timed out" in normalized -> "input"
            "did not then call service.startforeground" in normalized -> "fgs_start"
            "executing service" in normalized -> "service"
            "broadcast of" in normalized -> "broadcast"
            "contentprovider not responding" in normalized -> "provider"
            else -> "other"
        }
    }
}

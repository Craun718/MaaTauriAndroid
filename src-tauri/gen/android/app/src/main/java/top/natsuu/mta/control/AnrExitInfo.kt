package top.natsuu.mta.control

/**
 * Classifies the system-recorded reason behind an ANR. Exit descriptions come
 * from AOSP timeout sites and can be prefixed by "user request after error:"
 * when the user dismisses the ANR dialog.
 */
internal object AnrExitInfo {
    fun kindOf(description: String?): String = when {
        description.isNullOrBlank() -> "unknown"
        "Input dispatching timed out" in description -> "input"
        "did not then call Service.startForeground" in description -> "fgs_start"
        "executing service" in description -> "service"
        "Broadcast of" in description -> "broadcast"
        "ContentProvider not responding" in description -> "provider"
        else -> "other"
    }
}

package top.natsuu.mta

/** A retained idle display does not, by itself, justify keeping the main screen awake. */
internal fun shouldKeepDisplayAwake(
    displayActive: Boolean,
    runActive: Boolean,
    activityResumed: Boolean,
    previewVisible: Boolean,
    pipVisible: Boolean,
): Boolean = displayActive && (runActive || (activityResumed && previewVisible) || pipVisible)

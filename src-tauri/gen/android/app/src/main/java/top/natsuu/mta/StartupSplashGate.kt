package top.natsuu.mta

/**
 * Keeps the native splash over the WebView only for the short bootstrap after
 * the Project Interface root is already available. Before that point the gate
 * stays open so the web preparation dialog can show extraction progress.
 */
object StartupSplashGate {
    @Volatile
    private var released = false

    fun beginActivity() {
        released = false
    }

    fun release() {
        released = true
    }

    fun shouldKeep(): Boolean = !released && AppPreparationManager.isProjectReady()
}

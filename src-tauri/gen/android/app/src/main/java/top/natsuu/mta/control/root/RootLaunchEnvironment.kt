package top.natsuu.mta.control.root

/** Commands run inside libsu's root shell; only the app's runtime tree is repaired. */
internal object RootLaunchEnvironment {
    fun wrap(invocation: String, dropToShell: Boolean): String {
        val root = "/data/local/tmp/maa-tauri-android"
        val preparation = if (dropToShell) {
            "[ ! -L $root ] && mkdir -p $root && " +
                "find $root ! -user 2000 -exec chown -h 2000:2000 {} + 2>/dev/null && "
        } else ""
        // --mount-master is already requested from libsu. This also covers su
        // implementations that silently fall back to their caller's namespace.
        val launch = "if nsenter -t 1 -m -- true 2>/dev/null; then " +
            "nsenter -t 1 -m -- $invocation >/dev/null 2>&1 & " +
            "else $invocation >/dev/null 2>&1 & fi"
        return preparation + launch
    }
}

package top.natsuu.mta

import com.topjohnwu.superuser.Shell

internal object AdbInputSettings {
    fun needsWarning(isXiaomi: Boolean, value: String?): Boolean =
        isXiaomi && value != null && value != "1"

    fun restricted(): Boolean = needsWarning(
        DeviceIdentity.isXiaomiRom,
        DeviceIdentity.property("persist.security.adbinput"),
    )

    /** The root read, write, and independent readback run only after a user action. */
    fun repair(read: () -> String?, write: () -> Boolean): Boolean {
        val before = read() ?: return false
        if (before == "1") return true
        if (!write()) return false
        return read() == "1"
    }

    fun enableWithRoot(): Boolean = runCatching {
        if (!DeviceIdentity.isXiaomiRom || !Shell.getShell().isRoot) return false
        repair(
            read = {
                Shell.cmd("getprop persist.security.adbinput").exec()
                    .takeIf { it.isSuccess }?.out?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
            },
            write = { Shell.cmd("setprop persist.security.adbinput 1").exec().isSuccess },
        )
    }.getOrDefault(false)
}

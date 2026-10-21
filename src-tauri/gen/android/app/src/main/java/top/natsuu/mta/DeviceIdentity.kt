package top.natsuu.mta

import android.os.Build

/** Device identity is stable for a process; capability probes remain separate. */
internal object DeviceIdentity {
    val vendor: RunNotificationVendor by lazy { detectRunNotificationVendor() }
    val isXiaomiRom: Boolean by lazy {
        vendor == RunNotificationVendor.XIAOMI ||
            !property("ro.mi.os.version.name").isNullOrBlank() ||
            !property("ro.miui.ui.version.name").isNullOrBlank()
    }
    val marketName: String by lazy {
        property("ro.product.marketname")?.takeIf { it.isNotBlank() }
            ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    // Restricted/missing properties are unknown, not evidence of a disabled setting.
    fun property(name: String): String? = runCatching {
        Class.forName("android.os.SystemProperties")
            .getMethod("get", String::class.java)
            .invoke(null, name) as? String
    }.getOrNull()?.takeIf { it.isNotBlank() }
}

package top.natsuu.mta

import android.os.Build

enum class RunNotificationVendor {
    OPPO,
    ONEPLUS,
    REALME,
    XIAOMI,
    VIVO,
    IQOO,
    MEIZU,
    HONOR,
    SAMSUNG,
    HUAWEI,
    OTHER,
}

fun detectRunNotificationVendor(
    manufacturer: String = Build.MANUFACTURER,
): RunNotificationVendor = when (manufacturer.trim().lowercase()) {
    "oppo" -> RunNotificationVendor.OPPO
    "oneplus" -> RunNotificationVendor.ONEPLUS
    "realme" -> RunNotificationVendor.REALME
    "xiaomi", "redmi", "poco" -> RunNotificationVendor.XIAOMI
    "vivo" -> RunNotificationVendor.VIVO
    "iqoo" -> RunNotificationVendor.IQOO
    "meizu" -> RunNotificationVendor.MEIZU
    "honor" -> RunNotificationVendor.HONOR
    "samsung" -> RunNotificationVendor.SAMSUNG
    "huawei" -> RunNotificationVendor.HUAWEI
    else -> RunNotificationVendor.OTHER
}

val RunNotificationVendor.isVivoFamily: Boolean
    get() = this == RunNotificationVendor.VIVO || this == RunNotificationVendor.IQOO

fun flymeMajorVersion(display: String?): Int {
    val match = Regex("(?i)flyme(?:os)?\\s*([0-9]+)").find(display ?: return -1) ?: return -1
    return match.groupValues.getOrNull(1)?.toIntOrNull() ?: -1
}

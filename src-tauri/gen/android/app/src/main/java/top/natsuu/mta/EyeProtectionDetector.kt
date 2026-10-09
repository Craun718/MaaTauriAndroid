package top.natsuu.mta

import android.content.Context
import android.provider.Settings

/**
 * Reads vendor-specific eye-comfort / night-light switches. There is no public
 * API covering every OEM, so the first matched setting is reported with its
 * source to make run diagnostics actionable.
 */
object EyeProtectionDetector {
    fun detect(context: Context): String? {
        val resolver = context.contentResolver
        return detect(
            secure = { key ->
                runCatching {
                    Settings.Secure.getInt(resolver, key, 0) == 1
                }.getOrDefault(false)
            },
            system = { key ->
                runCatching {
                    Settings.System.getInt(resolver, key, 0) == 1
                }.getOrDefault(false)
            },
            global = { key ->
                runCatching {
                    Settings.Global.getInt(resolver, key, 0) == 1
                }.getOrDefault(false)
            },
            nightDisplayService = { nightDisplayActivated(context) },
        )
    }

    internal fun detect(
        secure: (String) -> Boolean,
        system: (String) -> Boolean,
        global: (String) -> Boolean,
        nightDisplayService: () -> Boolean,
    ): String? = when {
        secure("night_display_activated") -> "aosp:night_display_activated"
        system("screen_paper_mode_enabled") -> "xiaomi:screen_paper_mode_enabled"
        system("eyes_protection_mode") -> "huawei:eyes_protection_mode"
        system("blue_light_filter") || global("blue_light_filter") ->
            "samsung:blue_light_filter"
        system("coloros_eyeprotect_enable") || system("eyeprotect_enable") ->
            "oppo:coloros_eyeprotect_enable"
        system("vivo_night_display") || secure("vivo_night_display") ->
            "vivo:vivo_night_display"
        nightDisplayService() -> "color_display:isNightDisplayActivated"
        else -> null
    }

    /** ColorDisplayManager is a system API and must be called reflectively. */
    private fun nightDisplayActivated(context: Context): Boolean = runCatching {
        val manager = context.getSystemService("color_display") ?: return false
        manager.javaClass
            .getMethod("isNightDisplayActivated")
            .invoke(manager) as? Boolean
    }.getOrNull() == true
}

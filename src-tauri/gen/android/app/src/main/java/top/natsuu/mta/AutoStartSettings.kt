package top.natsuu.mta

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Routing for OEM background-start settings. There is no public API for these
 * vendor pages, so each entry is resolved explicitly. Package visibility is
 * declared in the app manifest for Android 11+.
 */
object AutoStartSettings {
    data class OemEntry(val id: String, val intent: Intent)

    private val OEM_ENTRIES = listOf(
        OemEntry(
            "xiaomi",
            Intent().setComponent(
                ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity",
                ),
            ),
        ),
        OemEntry(
            "coloros",
            Intent().setComponent(
                ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity",
                ),
            ),
        ),
        OemEntry(
            "oppo",
            Intent().setComponent(
                ComponentName(
                    "com.oppo.safe",
                    "com.oppo.safe.permission.startup.StartupAppListActivity",
                ),
            ),
        ),
        OemEntry(
            "oneplus",
            Intent().setComponent(
                ComponentName(
                    "com.oneplus.security",
                    "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
                ),
            ),
        ),
        OemEntry(
            "vivo",
            Intent().setComponent(
                ComponentName(
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                ),
            ),
        ),
        OemEntry(
            "vivo_iqoo",
            Intent().setComponent(
                ComponentName(
                    "com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
                ),
            ),
        ),
        OemEntry(
            "huawei",
            Intent().setComponent(
                ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                ),
            ),
        ),
        OemEntry(
            "huawei_appcontrol",
            Intent().setComponent(
                ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
                ),
            ),
        ),
        OemEntry(
            "huawei_protect",
            Intent().setComponent(
                ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity",
                ),
            ),
        ),
        OemEntry(
            "honor",
            Intent().setComponent(
                ComponentName(
                    "com.hihonor.systemmanager",
                    "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                ),
            ),
        ),
        OemEntry(
            "samsung",
            Intent().setComponent(
                ComponentName(
                    "com.samsung.android.lool",
                    "com.samsung.android.lool.activity.applist.AppListActivity",
                ),
            ),
        ),
        OemEntry(
            "meizu",
            Intent().setComponent(
                ComponentName(
                    "com.meizu.safe",
                    "com.meizu.safe.permission.SmartBGActivity",
                ),
            ),
        ),
        OemEntry(
            "zte",
            Intent().setComponent(
                ComponentName(
                    "com.zte.heartyservice",
                    "com.zte.heartyservice.autostart.HeartifyAutoStartActivity",
                ),
            ),
        ),
        OemEntry(
            "zte_autorun",
            Intent().setComponent(
                ComponentName(
                    "com.zte.heartyservice",
                    "com.zte.heartyservice.autorun.AppAutoRunManager",
                ),
            ),
        ),
    )

    fun resolvableOemId(context: Context): String? {
        return OEM_ENTRIES.firstOrNull { entry -> canLaunch(context, entry.intent) }?.id
    }

    fun resolveTarget(context: Context): AutoStartTarget? {
        return AutoStartResolution.select(
            listOfNotNull(resolvableOemId(context)),
            isKnownRestrictiveManufacturer(),
        )
    }

    fun open(context: Context, target: AutoStartTarget): Boolean {
        val primary = when (target) {
            is AutoStartTarget.Oem ->
                OEM_ENTRIES.firstOrNull { entry -> entry.id == target.id }?.intent
            AutoStartTarget.AppDetails -> null
        }
        if (primary != null && start(context, primary)) return true
        if (target == AutoStartTarget.AppDetails) return false
        return start(context, appDetailsIntent(context))
    }

    fun appDetailsIntent(context: Context): Intent {
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
    }

    private fun start(context: Context, intent: Intent): Boolean {
        return runCatching {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
    }

    private fun canLaunch(context: Context, intent: Intent): Boolean {
        val info = context.packageManager.resolveActivity(intent, 0)?.activityInfo
            ?: return false
        if (!info.exported) return false
        val permission = info.permission ?: return true
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun isKnownRestrictiveManufacturer(): Boolean {
        return Build.MANUFACTURER.trim().lowercase() in RESTRICTIVE_MANUFACTURERS
    }

    private val RESTRICTIVE_MANUFACTURERS = setOf(
        "xiaomi", "redmi", "oppo", "realme", "oneplus",
        "vivo", "iqoo", "huawei", "honor", "samsung",
        "meizu", "smartisan", "letv", "zte", "nubia",
    )
}

/** Pure decision logic, separate from Android intent resolution for tests. */
sealed interface AutoStartTarget {
    data class Oem(val id: String) : AutoStartTarget
    data object AppDetails : AutoStartTarget
}

object AutoStartResolution {
    fun select(
        resolvableOemIds: List<String>,
        knownRestrictiveManufacturer: Boolean,
    ): AutoStartTarget? = when {
        resolvableOemIds.isNotEmpty() -> AutoStartTarget.Oem(resolvableOemIds.first())
        knownRestrictiveManufacturer -> AutoStartTarget.AppDetails
        else -> null
    }
}

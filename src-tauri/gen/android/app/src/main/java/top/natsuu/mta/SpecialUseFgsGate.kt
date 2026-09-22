package top.natsuu.mta

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

object SpecialUseFgsGate {
    fun canStart(
        sdkInt: Int,
        specialUsePermissionGranted: Boolean,
        foregroundServiceTypeAllowed: Boolean,
    ): Boolean {
        if (sdkInt < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        return specialUsePermissionGranted && foregroundServiceTypeAllowed
    }

    fun canStart(context: Context): Boolean {
        return canStart(context, RunForegroundService::class.java)
    }

    fun canStart(context: Context, serviceClass: Class<*>): Boolean {
        val granted = context.checkSelfPermission(
            "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
        ) == PackageManager.PERMISSION_GRANTED
        return canStart(
            Build.VERSION.SDK_INT,
            granted,
            foregroundServiceTypeAllowed(context, serviceClass),
        )
    }

    private fun foregroundServiceTypeAllowed(
        context: Context,
        serviceClass: Class<*>,
    ): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        return runCatching {
            context.packageManager
                .getPackageInfo(context.packageName, PackageManager.GET_SERVICES)
                .services
                ?.any { service ->
                    service.name == serviceClass.name &&
                        service.foregroundServiceType and
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE != 0
                } ?: false
        }.getOrDefault(false)
    }
}

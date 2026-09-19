package top.natsuu.mta.control

import android.content.AttributionSource
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.hardware.display.DisplayManager
import androidx.annotation.RequiresApi

/**
 * Shizuku services run as the shell UID while retaining the host package's
 * Context. Framework services validate that identity pair, so present the same
 * identity to system_server that MaaFw and shell tools use.
 */
internal class ShellIdentityContext(base: Context) : ContextWrapper(base) {
    override fun getPackageName(): String = PACKAGE_NAME

    override fun getOpPackageName(): String = PACKAGE_NAME

    @RequiresApi(Build.VERSION_CODES.S)
    override fun getAttributionSource(): AttributionSource =
        AttributionSource.Builder(android.os.Process.SHELL_UID)
            .setPackageName(PACKAGE_NAME)
            .build()

    companion object {
        private const val PACKAGE_NAME = "com.android.shell"
        private const val TAG = "MaaTauriAndroidControl"

        fun createDisplayManager(context: Context): DisplayManager? = runCatching {
            DisplayManager::class.java
                .getDeclaredConstructor(Context::class.java)
                .apply { isAccessible = true }
                .newInstance(context) as DisplayManager
        }.onFailure { error ->
            android.util.Log.w(TAG, "Could not construct shell DisplayManager", error)
        }.getOrNull()
    }
}

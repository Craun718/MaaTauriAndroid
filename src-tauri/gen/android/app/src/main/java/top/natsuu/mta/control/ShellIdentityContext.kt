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
internal class ShellIdentityContext(
    base: Context,
    private val identityPackageName: String,
    private val identityUid: Int,
) : ContextWrapper(base) {
    override fun getPackageName(): String = identityPackageName

    override fun getOpPackageName(): String = identityPackageName

    @RequiresApi(Build.VERSION_CODES.S)
    override fun getAttributionSource(): AttributionSource =
        AttributionSource.Builder(identityUid)
            .setPackageName(identityPackageName)
            .build()

    companion object {
        private const val PACKAGE_NAME = "com.android.shell"
        private const val TAG = "MaaTauriAndroidControl"

        /**
         * Shell services need the shell package and shell UID together. A root
         * service keeps UID 0 for input injection, but must identify as the
         * app when calling package-aware framework APIs.
         */
        fun forCurrentUid(base: Context): ShellIdentityContext {
            val currentUid = android.os.Process.myUid()
            val packageName =
                if (currentUid == android.os.Process.SHELL_UID) {
                    PACKAGE_NAME
                } else {
                    base.packageName
                }
            return ShellIdentityContext(base, packageName, currentUid)
        }

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

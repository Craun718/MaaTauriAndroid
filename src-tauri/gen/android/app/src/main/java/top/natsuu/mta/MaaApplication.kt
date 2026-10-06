package top.natsuu.mta

import android.app.Application
import android.content.Context
import java.io.File

class MaaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        RuntimeBridge.attachContext(this)
        invalidateWebViewCacheAfterUpdate()
        AppPreparationManager.start(this)
    }

    /**
     * Tauri serves embedded assets at stable `tauri.localhost` URLs, so the
     * WebView can reuse stale responses after an APK update. Mirror PiInstaller's
     * marker check: clear once when the installed package changes, not on every
     * cold start. App data and non-HTTP WebView storage are unaffected.
     */
    private fun invalidateWebViewCacheAfterUpdate() {
        val preferences = getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val marker = packageInfo.lastUpdateTime.toString()
        if (preferences.getString(MARKER_KEY, null) == marker) return

        File(cacheDir, "WebView/Default/HTTP Cache").deleteRecursively()
        preferences.edit().putString(MARKER_KEY, marker).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "webview_cache_invalidation"
        const val MARKER_KEY = "package_update_time"
    }
}

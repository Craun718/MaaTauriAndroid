package top.natsuu.mta

import android.app.Application
import java.io.File

class MaaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        RuntimeBridge.attachContext(this)
        // Tauri serves embedded assets at stable tauri.localhost URLs. Android can
        // reuse those responses after an APK update, so drop the WebView HTTP cache
        // before the first WebView exists. App data is unaffected.
        File(cacheDir, "WebView/Default/HTTP Cache").deleteRecursively()
        AppPreparationManager.start(this)
    }
}

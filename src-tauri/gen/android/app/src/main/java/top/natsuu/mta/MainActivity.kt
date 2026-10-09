package top.natsuu.mta

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

/**
 * Edge-to-edge only: [enableEdgeToEdge] plus the enforced edge-to-edge of targetSdk 36 lay the
 * webview out under the status and navigation bars, and window insets are deliberately left to
 * the web layer. Do not pad the webview or its container, and do not install an insets listener:
 * one registered through ViewCompat would replace the webview's own `onApplyWindowInsets`,
 * which Chromium relies on to track the soft keyboard and to compute `env(safe-area-inset-*)`.
 * Keeping clear of the bars is done in CSS with those env vars (see AGENTS.md, 系统栏适配).
 */
class MainActivity : TauriActivity() {
  private val configurationFilePicker = registerForActivityResult(
    ActivityResultContracts.OpenDocument(),
  ) { uri ->
    RuntimeBridge.completeConfigurationFilePick(uri)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    StartupSplashGate.beginActivity()
    splashScreen.setKeepOnScreenCondition { StartupSplashGate.shouldKeep() }
    enableEdgeToEdge()
    RuntimeBridge.attachActivity(this)
    RuntimeBridge.registerConfigurationFilePicker { mimeTypes ->
      configurationFilePicker.launch(mimeTypes)
    }
    RuntimeBridge.configureScreen(
        resources.displayMetrics.widthPixels,
        resources.displayMetrics.heightPixels,
    )
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    RuntimeBridge.setVirtualDisplayLandscape(false)
    RuntimeBridge.detachActivity(this)
    if (!RunForegroundService.isRunning) {
      RuntimeBridge.stopVirtualDisplay()
    }
    super.onDestroy()
  }

  override fun onResume() {
    super.onResume()
    AppPreparationManager.connectControl()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    RuntimeBridge.logDebug(
      "Host configuration changed: orientation=${newConfig.orientation}",
    )
  }
}

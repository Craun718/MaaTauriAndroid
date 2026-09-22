package top.natsuu.mta

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import top.natsuu.mta.MaaRuntime
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

/**
 * Edge-to-edge only: [enableEdgeToEdge] plus the enforced edge-to-edge of targetSdk 36 lay the
 * webview out under the status and navigation bars, and window insets are deliberately left to
 * the web layer. Do not pad the webview or its container, and do not install an insets listener:
 * one registered through ViewCompat would replace the webview's own `onApplyWindowInsets`,
 * which Chromium relies on to track the soft keyboard and to compute `env(safe-area-inset-*)`.
 * Keeping clear of the bars is done in CSS with those env vars (see AGENTS.md, 系统栏适配).
 */
class MainActivity : TauriActivity() {
  private lateinit var controlClient: ControlServiceClient

  override fun onCreate(savedInstanceState: Bundle?) {
    installSplashScreen()
    enableEdgeToEdge()
    MaaRuntime.load()
    RuntimeBridge.attachContext(applicationContext)
    RuntimeBridge.attachActivity(this)
    RuntimeBridge.initializeSecretBridge()
    PiInstaller.install(this)?.let { projectRoot ->
        RuntimeBridge.setBootstrapProjectRoot(projectRoot.absolutePath)
    }
    RuntimeBridge.configureScreen(
        resources.displayMetrics.widthPixels,
        resources.displayMetrics.heightPixels,
    )
    ControlHost.configure(
        0,
        resources.displayMetrics.widthPixels,
        resources.displayMetrics.heightPixels,
    )
    controlClient = ControlServiceClient(this)
    RuntimeBridge.attachControlClient(controlClient)
    RuntimeBridge.setPrivilegedBackend(controlClient.getSelectedPrivilegedBackend())
    controlClient.connect()
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    RuntimeBridge.setVirtualDisplayLandscape(false)
    RuntimeBridge.detachActivity(this)
    if (!RunForegroundService.isRunning) {
      RuntimeBridge.stopVirtualDisplay()
    }
    RuntimeBridge.detachControlClient(controlClient)
    controlClient.disconnect()
    super.onDestroy()
  }

  override fun onResume() {
    super.onResume()
    if (::controlClient.isInitialized) {
      controlClient.connect()
    }
  }
}

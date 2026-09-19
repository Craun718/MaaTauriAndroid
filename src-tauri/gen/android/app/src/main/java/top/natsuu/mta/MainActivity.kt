package top.natsuu.mta

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import top.natsuu.mta.MaaRuntime
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

class MainActivity : TauriActivity() {
  private lateinit var controlClient: ControlServiceClient
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    MaaRuntime.load()
    RuntimeBridge.attachContext(applicationContext)
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
    controlClient.connect()
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    RuntimeBridge.stopVirtualDisplay()
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

  /**
   * Edge-to-edge is not optional here: [enableEdgeToEdge] asks for it, and from targetSdk 36 the
   * platform enforces it anyway (`windowOptOutEdgeToEdgeEnforcement` is deprecated and disabled),
   * so the webview would be laid out underneath the status and navigation bars. Tauri does not
   * apply window insets, so the gap is closed here by padding the webview's container.
   *
   * The listener goes on the container rather than on the webview itself: a listener installed
   * with [ViewCompat.setOnApplyWindowInsetsListener] replaces that view's own
   * `onApplyWindowInsets`, and Chromium relies on its override to track the soft keyboard and to
   * compute `env(safe-area-inset-*)`. Leaving the webview alone keeps that intact, so the insets
   * are also returned unconsumed.
   */
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    if (webView.isAttachedToWindow) {
      insetContainerOf(webView)
    } else {
      webView.addOnAttachStateChangeListener(
          object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
              view.removeOnAttachStateChangeListener(this)
              insetContainerOf(view)
            }

            override fun onViewDetachedFromWindow(view: View) = Unit
          }
      )
    }
  }

  private fun insetContainerOf(webView: View) {
    val container = webView.parent as? View ?: return
    ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
      val bars =
          insets.getInsets(
              WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
          )
      // Guarded so an unchanged inset cannot bounce padding -> requestLayout -> insets forever.
      if (
          view.paddingTop != bars.top ||
              view.paddingBottom != bars.bottom ||
              view.paddingLeft != bars.left ||
              view.paddingRight != bars.right
      ) {
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      }
      insets
    }
    ViewCompat.requestApplyInsets(container)
  }
}

package top.natsuu.mta

import android.os.Bundle
import android.graphics.PixelFormat
import android.view.View
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import top.natsuu.mta.MaaRuntime
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient
import top.natsuu.mta.RuntimeBridge

class MainActivity : TauriActivity() {
  private lateinit var controlClient: ControlServiceClient
  private var webView: WebView? = null
  private var previewSurface: SurfaceView? = null
  private val virtualDisplayHost = RuntimeBridge.VirtualDisplayHost { left, top, width, height ->
    updateVirtualDisplayBounds(left, top, width, height)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    MaaRuntime.load()
    RuntimeBridge.attachContext(applicationContext)
    RuntimeBridge.attachVirtualDisplayHost(virtualDisplayHost)
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
    clearVirtualDisplayPreview()
    RuntimeBridge.detachVirtualDisplayHost(virtualDisplayHost)
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

  private fun updateVirtualDisplayBounds(left: Int, top: Int, width: Int, height: Int) {
    if (width <= 0 || height <= 0) {
      clearVirtualDisplayPreview()
      return
    }
    val view = webView ?: return
    val parent = view.parent as? ViewGroup ?: return
    val scale = if (view.scale > 0F) view.scale else 1F
    val physicalWidth = (width * scale).toInt().coerceAtLeast(1)
    val physicalHeight = (height * scale).toInt().coerceAtLeast(1)
    val physicalLeft = view.left + (left * scale).toInt().coerceAtLeast(0)
    val physicalTop = view.top + (top * scale).toInt().coerceAtLeast(0)

    val surface = previewSurface ?: SurfaceView(this).apply {
      setZOrderMediaOverlay(true)
      isClickable = false
      isFocusable = false
      holder.setFormat(PixelFormat.RGBA_8888)
      holder.addCallback(object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          ControlHost.attachPreviewSurface(holder.surface)
        }

        override fun surfaceChanged(
          holder: SurfaceHolder,
          format: Int,
          width: Int,
          height: Int,
        ) = Unit

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          ControlHost.attachPreviewSurface(null)
        }
      })
      previewSurface = this
      parent.addView(this)
    }

    surface.translationX = physicalLeft.toFloat()
    surface.translationY = physicalTop.toFloat()
    surface.layoutParams.width = physicalWidth
    surface.layoutParams.height = physicalHeight
    surface.requestLayout()
  }

  private fun clearVirtualDisplayPreview() {
    val surface = previewSurface ?: return
    previewSurface = null
    (surface.parent as? ViewGroup)?.removeView(surface)
    ControlHost.attachPreviewSurface(null)
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

package top.natsuu.mta.pip

import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import top.natsuu.mta.MainActivity
import top.natsuu.mta.RuntimeBridge
import top.natsuu.mta.control.ControlHost
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/** Activity-owned native PiP host; WebView and React stay mounted underneath it. */
class VirtualDisplayPipController(private val activity: MainActivity) {
    private val handler = Handler(Looper.getMainLooper())
    private var requested = false
    private var runActive = false
    private var width = 0
    private var height = 0
    @Volatile private var displayId = -1
    private var source: Rect? = null
    private var unavailableLabel = ""
    private var inPip = false
    private var destroyed = false
    private var host: FrameLayout? = null
    private var video: SurfaceView? = null
    private var empty: TextView? = null
    private var webView: WebView? = null
    private var normalWidth = 0
    private var normalHeight = 0
    private var savedWidth = ViewGroup.LayoutParams.MATCH_PARENT
    private var savedHeight = ViewGroup.LayoutParams.MATCH_PARENT
    private val monitor = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "mta-pip-display").apply { isDaemon = true }
    }
    @Volatile private var watching = false

    init {
        // Binder calls never block the UI thread. Captured display identity rejects stale results.
        monitor.scheduleWithFixedDelay({
            if (watching) {
                val observedId = displayId
                val status = runCatching {
                    if (ControlHost.current() == null) null else ControlHost.virtualDisplayStatus()
                }.getOrNull()
                handler.post {
                    if (destroyed || !inPip || displayId != observedId) return@post
                    if (status == null || status.getOrNull(0) != 1 ||
                        status.getOrNull(1) != displayId) RuntimeBridge.invalidatePipDisplay(observedId)
                }
            }
        }, 500, 500, TimeUnit.MILLISECONDS)
    }

    fun bindWebView(view: WebView) {
        webView = view
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (!inPip && !activity.isInPictureInPictureMode) {
                normalWidth = view.width
                normalHeight = view.height
            }
        }
    }

    fun update(json: String) {
        if (destroyed || inPip) return
        val request = JSONObject(json)
        requested = request.getBoolean("eligible") &&
            request.getInt("width") == width && request.getInt("height") == height
        unavailableLabel = request.getString("unavailableLabel")
        source = request.optJSONObject("sourceRect")?.let {
            val location = IntArray(2)
            webView?.getLocationInWindow(location)
            Rect(it.getInt("left"), it.getInt("top"), it.getInt("right"), it.getInt("bottom")).apply {
                offset(location[0], location[1])
            }
        }
        updateParams()
    }

    fun setRunActive(active: Boolean) {
        runActive = active
        updateParams()
    }

    fun displayStarted(id: Int, displayWidth: Int, displayHeight: Int) {
        displayId = id
        width = displayWidth
        height = displayHeight
        if (inPip) {
            watching = true
            removeHost()
            createHost()
        }
        updateParams()
    }

    fun displayStopped() {
        displayId = -1
        watching = false
        requested = false
        video?.visibility = View.GONE
        empty?.visibility = View.VISIBLE
        updateParams()
    }

    private fun supported(): Boolean = activity.packageManager
        .hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun params(autoEnter: Boolean): PictureInPictureParams {
        val ratio = pipRatio(width, height)
        return PictureInPictureParams.Builder().apply {
            setAspectRatio(Rational(ratio.width, ratio.height))
            source?.let { setSourceRectHint(it) }
            if (Build.VERSION.SDK_INT >= 31) {
                setAutoEnterEnabled(autoEnter)
                setSeamlessResizeEnabled(true)
            }
        }.build()
    }

    private fun eligible(): Boolean = pipCanEnter(requested, runActive, displayId, width, height)

    private fun updateParams() {
        if (destroyed || !supported()) return
        runCatching { activity.setPictureInPictureParams(params(eligible())) }
            .onFailure { Log.w("MTAPip", "Could not update PiP parameters", it) }
    }

    fun onUserLeaveHint() {
        if (Build.VERSION.SDK_INT >= 31 || !supported() || !eligible() || inPip) return
        runCatching { activity.enterPictureInPictureMode(params(false)) }
            .onFailure { Log.w("MTAPip", "Could not enter PiP", it) }
    }

    fun onModeChanged(active: Boolean) {
        if (destroyed || inPip == active) return
        inPip = active
        watching = active
        if (active) {
            webView?.let { view ->
                savedWidth = view.layoutParams.width
                savedHeight = view.layoutParams.height
                if (normalWidth > 0 && normalHeight > 0) {
                    view.layoutParams = view.layoutParams.apply {
                        width = normalWidth
                        height = normalHeight
                    }
                }
            }
            createHost()
            webView?.evaluateJavascript("window.dispatchEvent(new Event('virtual-display-pip-entered'))", null)
        } else {
            removeHost()
            webView?.let { view ->
                view.layoutParams = view.layoutParams.apply {
                    width = savedWidth
                    height = savedHeight
                }
                // Focus/visibility do not always change when expanding PiP.
                view.evaluateJavascript("window.dispatchEvent(new Event('virtual-display-pip-restored'))", null)
            }
            updateParams()
        }
    }

    private fun createHost() {
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        val overlay = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        host = overlay
        empty = TextView(activity).apply {
            text = unavailableLabel
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        overlay.addView(empty, FrameLayout.LayoutParams(-1, -1))
        // Fixed video buffers keep EGL's viewport stable during PiP window resizing.
        val surface = SurfaceView(activity)
        video = surface
        if (width > 0 && height > 0) surface.holder.setFixedSize(width, height)
        surface.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                if (inPip && video === surface && displayId >= 0) PreviewRouter.acquire(holder.surface)
            }
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
                if (inPip && video === surface && displayId >= 0) PreviewRouter.acquire(holder.surface)
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) { PreviewRouter.release(holder.surface) }
        })
        overlay.addView(surface, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        overlay.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> resizeVideo() }
        root.addView(overlay, ViewGroup.LayoutParams(-1, -1))
        if (displayId >= 0) showVideo() else displayStopped()
    }

    private fun resizeVideo() {
        val parent = host ?: return
        val surface = video ?: return
        if (width <= 0 || height <= 0 || parent.width <= 0 || parent.height <= 0) return
        val scale = minOf(parent.width.toDouble() / width, parent.height.toDouble() / height)
        val w = (width * scale).roundToInt().coerceAtLeast(1)
        val h = (height * scale).roundToInt().coerceAtLeast(1)
        if (surface.layoutParams.width != w || surface.layoutParams.height != h) {
            surface.layoutParams = FrameLayout.LayoutParams(w, h, Gravity.CENTER)
        }
    }

    private fun showVideo() {
        empty?.visibility = View.GONE
        video?.visibility = View.VISIBLE
        resizeVideo()
    }

    private fun removeHost() {
        video?.holder?.surface?.let { PreviewRouter.release(it) }
        video = null
        host?.let { (it.parent as? ViewGroup)?.removeView(it) }
        host = null
        empty = null
    }

    fun destroy() {
        destroyed = true
        watching = false
        monitor.shutdownNow()
        removeHost()
        handler.removeCallbacksAndMessages(null)
        webView = null
    }
}

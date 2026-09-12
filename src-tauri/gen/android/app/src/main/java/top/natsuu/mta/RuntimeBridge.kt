package top.natsuu.mta

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.ParcelFileDescriptor
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

object RuntimeBridge {
    init {
        System.loadLibrary("maa_tauri_android_lib")
    }

    @Volatile
    private var agentContext: Context? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var controlClient: ControlServiceClient? = null
    @Volatile
    private var virtualDisplayHost: VirtualDisplayHost? = null
    @Volatile
    private var physicalScreenWidth = 0
    @Volatile
    private var physicalScreenHeight = 0

    fun interface VirtualDisplayHost {
        fun updateVirtualDisplayBounds(left: Int, top: Int, width: Int, height: Int)
    }

    @JvmStatic
    fun attachContext(context: Context) {
        agentContext = context.applicationContext
        physicalScreenWidth = context.resources.displayMetrics.widthPixels
        physicalScreenHeight = context.resources.displayMetrics.heightPixels
    }

    @JvmStatic
    fun agentBridgeContext(): Any? = agentContext

    @JvmStatic
    fun attachControlClient(client: ControlServiceClient) {
        controlClient = client
    }

    @JvmStatic
    fun detachControlClient(client: ControlServiceClient) {
        if (controlClient === client) {
            controlClient = null
        }
    }

    @JvmStatic
    fun attachVirtualDisplayHost(host: VirtualDisplayHost) {
        virtualDisplayHost = host
    }

    @JvmStatic
    fun detachVirtualDisplayHost(host: VirtualDisplayHost) {
        if (virtualDisplayHost === host) {
            virtualDisplayHost = null
        }
    }

    @JvmStatic
    fun requestPrivilegedAccess(): Boolean {
        val client = controlClient ?: return false
        val latch = CountDownLatch(1)
        val granted = AtomicBoolean(false)
        mainHandler.post {
            client.requestPrivilegedAccess { result ->
                granted.set(result)
                latch.countDown()
            }
        }
        return latch.await(15, TimeUnit.SECONDS) && granted.get()
    }

    @JvmStatic
    fun openShizuku(): Boolean {
        val context = agentContext ?: return false
        val intent = context.packageManager.getLaunchIntentForPackage(SHIZUKU_PACKAGE)
            ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            context.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    @JvmStatic
    fun agentDescriptor(): String? {
        return runCatching {
            agentContext?.assets?.open("agent/runtime.json")?.bufferedReader()?.use { it.readText() }
        }.getOrNull()
    }

    @JvmStatic
    fun agentFingerprint(): String? {
        return runCatching {
            agentContext?.assets?.open("agent/runtime.fingerprint")?.bufferedReader()?.use {
                it.readText().trim()
            }
        }.getOrNull()
    }

    @JvmStatic
    fun openAgentAsset(name: String): ParcelFileDescriptor? {
        return requireNotNull(agentContext) { "the agent bridge context is missing" }
            .assets
            .openFd(name)
            .use { descriptor -> ParcelFileDescriptor.dup(descriptor.fileDescriptor) }
    }

    @JvmStatic
    fun agentNativeLibraryDir(): String {
        return requireNotNull(agentContext).applicationInfo.nativeLibraryDir
    }

    @JvmStatic
    fun startVirtualDisplay(width: Int, height: Int, dpi: Int): Boolean {
        val displayId = runCatching {
            ControlHost.startVirtualDisplay(width, height, dpi)
        }.getOrDefault(-1)
        if (displayId < 0) return false

        ControlHost.configure(displayId, width, height)
        configureScreen(width, height)
        setActiveDisplay(displayId)
        return true
    }

    @JvmStatic
    fun stopVirtualDisplay(): Boolean {
        runCatching {
            ControlHost.stopVirtualDisplay()
        }
        val width = physicalScreenWidth
        val height = physicalScreenHeight
        if (width > 0 && height > 0) {
            ControlHost.configure(0, width, height)
            configureScreen(width, height)
        }
        setActiveDisplay(0)
        val host = virtualDisplayHost
        if (host != null) {
            if (Looper.myLooper() == mainHandler.looper) {
                host.updateVirtualDisplayBounds(0, 0, 0, 0)
            } else {
                mainHandler.post { host.updateVirtualDisplayBounds(0, 0, 0, 0) }
            }
        }
        return true
    }

    @JvmStatic
    fun virtualDisplayStatus(): IntArray {
        return ControlHost.virtualDisplayStatus() ?: intArrayOf(0, -1, 0, 0, 0)
    }

    @JvmStatic
    fun updateVirtualDisplayBounds(left: Int, top: Int, width: Int, height: Int): Boolean {
        val host = virtualDisplayHost ?: return false
        mainHandler.post {
            host.updateVirtualDisplayBounds(left, top, width, height)
        }
        return true
    }

    @JvmStatic
    external fun configureScreen(width: Int, height: Int)

    @JvmStatic
    external fun setActiveDisplay(displayId: Int)

    @JvmStatic
    external fun setControlState(state: Int)

    @JvmStatic
    external fun initializeSecretBridge()

    @JvmStatic
    external fun setBootstrapProjectRoot(projectRoot: String)

    private const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"
}

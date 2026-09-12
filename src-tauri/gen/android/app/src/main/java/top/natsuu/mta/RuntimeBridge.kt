package top.natsuu.mta

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.ParcelFileDescriptor
import android.os.Looper
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

    @JvmStatic
    fun attachContext(context: Context) {
        agentContext = context.applicationContext
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
    fun requestPrivilegedAccess(): Boolean {
        val client = controlClient ?: return false
        mainHandler.post { client.connect() }
        return true
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
    external fun configureScreen(width: Int, height: Int)

    @JvmStatic
    external fun setControlState(state: Int)

    @JvmStatic
    external fun initializeSecretBridge()

    @JvmStatic
    external fun setBootstrapProjectRoot(projectRoot: String)

    private const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"
}

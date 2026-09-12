package top.natsuu.mta

import android.content.Context
import android.os.ParcelFileDescriptor

object RuntimeBridge {
    init {
        System.loadLibrary("maa_tauri_android_lib")
    }

    @Volatile
    private var agentContext: Context? = null

    @JvmStatic
    fun attachContext(context: Context) {
        agentContext = context.applicationContext
    }

    @JvmStatic
    fun agentBridgeContext(): Any? = agentContext

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
}

package top.natsuu.mta.control

import android.view.Surface
import top.natsuu.mta.IMaaTauriAndroidControlService

object ControlHost {
    @Volatile
    private var currentService: IMaaTauriAndroidControlService? = null

    init {
        System.loadLibrary("maa_tauri_android_control")
    }

    @JvmStatic
    external fun configure(displayId: Int, width: Int, height: Int)

    @JvmStatic
    fun attach(service: IMaaTauriAndroidControlService?) {
        currentService = service
        attachNative(service)
    }

    @JvmStatic
    fun current(): IMaaTauriAndroidControlService? = currentService

    @JvmStatic
    fun stopAllAgents() {
        currentService?.stopAllAgents()
    }

    @JvmStatic
    external fun startVirtualDisplay(width: Int, height: Int, dpi: Int): Int

    @JvmStatic
    external fun stopVirtualDisplay()

    @JvmStatic
    external fun virtualDisplayStatus(): IntArray?

    @JvmStatic
    external fun attachPreviewSurface(surface: Surface?)

    @JvmStatic
    private external fun attachNative(service: IMaaTauriAndroidControlService?)

    @JvmStatic
    fun detach() {
        currentService = null
        detachNative()
    }

    @JvmStatic
    private external fun detachNative()
}

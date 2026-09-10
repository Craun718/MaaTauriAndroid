package top.natsuu.maa.tauri.android.control

import top.natsuu.maa.tauri.android.IMaaTauriAndroidControlService

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
    private external fun attachNative(service: IMaaTauriAndroidControlService?)

    @JvmStatic
    fun detach() {
        currentService = null
        detachNative()
    }

    @JvmStatic
    private external fun detachNative()
}

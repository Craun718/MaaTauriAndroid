package top.natsuu.mta.control

import android.os.Binder
import android.os.IBinder
import android.view.Surface
import top.natsuu.mta.IMaaTauriAndroidControlService

object ControlHost {
    /**
     * Process-lifetime token: it lives as long as this process does, so its binder
     * death means the app process died in any way (hard kill, crash, force-stop).
     * The privileged service links a death recipient to it and runs its exit
     * cleanup without relying on the graceful onDestroy path.
     */
    private val ownerToken: IBinder = Binder()

    init {
        System.loadLibrary("maa_tauri_android_control")
    }

    @JvmStatic
    fun ownerBinder(): IBinder = ownerToken

    @Volatile
    private var currentService: IMaaTauriAndroidControlService? = null

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

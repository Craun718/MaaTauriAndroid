package top.natsuu.ttflow.control

import top.natsuu.ttflow.ITtflowControlService

object ControlHost {
    @Volatile
    private var currentService: ITtflowControlService? = null

    init {
        System.loadLibrary("ttflow_control")
    }

    @JvmStatic
    external fun configure(displayId: Int, width: Int, height: Int)

    @JvmStatic
    fun attach(service: ITtflowControlService?) {
        currentService = service
        attachNative(service)
    }

    @JvmStatic
    fun current(): ITtflowControlService? = currentService

    @JvmStatic
    private external fun attachNative(service: ITtflowControlService?)

    @JvmStatic
    fun detach() {
        currentService = null
        detachNative()
    }

    @JvmStatic
    private external fun detachNative()
}

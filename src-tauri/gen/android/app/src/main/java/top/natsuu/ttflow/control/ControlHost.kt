package top.natsuu.ttflow.control

import top.natsuu.ttflow.ITtflowControlService

object ControlHost {
    init {
        System.loadLibrary("ttflow_control")
    }

    @JvmStatic
    external fun configure(displayId: Int, width: Int, height: Int)

    @JvmStatic
    external fun attach(service: ITtflowControlService?)

    @JvmStatic
    external fun detach()
}

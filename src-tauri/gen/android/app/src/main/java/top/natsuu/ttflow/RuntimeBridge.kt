package top.natsuu.ttflow

object RuntimeBridge {
    init {
        System.loadLibrary("ttflow_lib")
    }

    @JvmStatic
    external fun configureScreen(width: Int, height: Int)

    @JvmStatic
    external fun setControlState(state: Int)

    @JvmStatic
    external fun initializeSecretBridge()
}

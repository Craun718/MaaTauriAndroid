package top.natsuu.maa.tauri.android

object RuntimeBridge {
    init {
        System.loadLibrary("maa_tauri_android_lib")
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

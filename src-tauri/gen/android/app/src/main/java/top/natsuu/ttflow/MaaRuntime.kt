package top.natsuu.ttflow

object MaaRuntime {
    @Volatile
    private var loaded = false

    @Synchronized
    fun load() {
        if (loaded) return
        System.loadLibrary("c++_shared")
        System.loadLibrary("MaaUtils")
        System.loadLibrary("opencv_world4")
        System.loadLibrary("onnxruntime")
        System.loadLibrary("MaaFramework")
        System.loadLibrary("MaaAndroidNativeControlUnit")
        System.loadLibrary("ttflow_control")
        loaded = true
    }
}

package top.natsuu.maa.tauri.android

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
        System.loadLibrary("maa_tauri_android_control")
        loaded = true
    }
}

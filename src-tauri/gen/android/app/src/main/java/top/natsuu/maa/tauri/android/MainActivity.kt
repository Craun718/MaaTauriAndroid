package top.natsuu.maa.tauri.android

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import top.natsuu.maa.tauri.android.MaaRuntime
import top.natsuu.maa.tauri.android.control.ControlHost
import top.natsuu.maa.tauri.android.control.ControlServiceClient
import top.natsuu.maa.tauri.android.RuntimeBridge

class MainActivity : TauriActivity() {
  private lateinit var controlClient: ControlServiceClient

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    MaaRuntime.load()
    RuntimeBridge.attachContext(applicationContext)
    RuntimeBridge.initializeSecretBridge()
    PiInstaller.install(this)?.let { projectRoot ->
        RuntimeBridge.setBootstrapProjectRoot(projectRoot.absolutePath)
    }
    RuntimeBridge.configureScreen(
        resources.displayMetrics.widthPixels,
        resources.displayMetrics.heightPixels,
    )
    ControlHost.configure(
        0,
        resources.displayMetrics.widthPixels,
        resources.displayMetrics.heightPixels,
    )
    controlClient = ControlServiceClient(this)
    controlClient.connect()
    super.onCreate(savedInstanceState)
  }

  override fun onDestroy() {
    controlClient.disconnect()
    super.onDestroy()
  }
}

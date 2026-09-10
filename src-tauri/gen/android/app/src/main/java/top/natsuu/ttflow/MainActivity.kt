package top.natsuu.ttflow

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import top.natsuu.ttflow.MaaRuntime
import top.natsuu.ttflow.control.ControlHost
import top.natsuu.ttflow.control.ControlServiceClient
import top.natsuu.ttflow.RuntimeBridge

class MainActivity : TauriActivity() {
  private lateinit var controlClient: ControlServiceClient

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    MaaRuntime.load()
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

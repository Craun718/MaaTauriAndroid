package top.natsuu.maa.tauri.android.control

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import java.util.UUID
import rikka.shizuku.Shizuku
import top.natsuu.maa.tauri.android.IMaaTauriAndroidControlService
import top.natsuu.maa.tauri.android.RuntimeBridge

class ControlServiceClient(private val context: Context) : ServiceConnection {
    private var bound = false
    private var started = false
    private val serviceArgs = Shizuku.UserServiceArgs(
        ComponentName(context, PrivilegedControlServiceImpl::class.java),
    )
        .daemon(false)
        .processNameSuffix("maa_tauri_android_control")
        .tag(UUID.randomUUID().toString())
        .version(SERVICE_VERSION)

    private val binderReceivedListener = Shizuku.OnBinderReceivedListener {
        connect()
    }

    private val permissionListener = Shizuku.OnRequestPermissionResultListener { requestCode, _ ->
        if (requestCode == REQUEST_CODE) {
            started = false
            connect()
        }
    }

    init {
        Shizuku.addBinderReceivedListenerSticky(
            binderReceivedListener,
            android.os.Handler(context.mainLooper),
        )
        Shizuku.addRequestPermissionResultListener(
            permissionListener,
            android.os.Handler(context.mainLooper),
        )
    }

    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        if (binder == null) {
            RuntimeBridge.setControlState(STATE_ERROR)
            return
        }
        ControlHost.attach(IMaaTauriAndroidControlService.Stub.asInterface(binder))
        RuntimeBridge.setControlState(STATE_CONNECTED)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
        bound = false
        ControlHost.detach()
        RuntimeBridge.setControlState(STATE_DISCONNECTED)
    }

    fun connect() {
        RuntimeBridge.setControlState(STATE_STARTING)
        if (!Shizuku.pingBinder()) {
            RuntimeBridge.setControlState(STATE_SHIZUKU_UNAVAILABLE)
            return
        }
        if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
            RuntimeBridge.setControlState(STATE_PERMISSION_REQUIRED)
            requestPermission()
            return
        }
        bindService()
    }

    fun disconnect() {
        if (bound) {
            Shizuku.unbindUserService(serviceArgs, this, true)
            bound = false
        }
        started = false
        ControlHost.detach()
        Shizuku.removeBinderReceivedListener(binderReceivedListener)
        Shizuku.removeRequestPermissionResultListener(permissionListener)
    }

    private fun requestPermission() {
        if (started) return
        started = true
        try {
            Shizuku.requestPermission(REQUEST_CODE)
        } catch (error: IllegalStateException) {
            started = false
            RuntimeBridge.setControlState(STATE_ERROR)
            android.util.Log.w("MaaTauriAndroidControl", "Could not request Shizuku permission", error)
        }
    }

    private fun bindService() {
        if (bound) return
        RuntimeBridge.setControlState(STATE_STARTING)
        try {
            Shizuku.bindUserService(serviceArgs, this)
            bound = true
        } catch (error: Throwable) {
            bound = false
            RuntimeBridge.setControlState(STATE_ERROR)
            android.util.Log.w("MaaTauriAndroidControl", "Could not bind Shizuku user service", error)
        }
    }

    companion object {
        private const val REQUEST_CODE = 9753
        private const val SERVICE_VERSION = 3

        const val STATE_SHIZUKU_UNAVAILABLE = 1
        const val STATE_PERMISSION_REQUIRED = 2
        const val STATE_CONNECTED = 3
        const val STATE_DISCONNECTED = 4
        const val STATE_ERROR = 5
        const val STATE_STARTING = 0
    }
}

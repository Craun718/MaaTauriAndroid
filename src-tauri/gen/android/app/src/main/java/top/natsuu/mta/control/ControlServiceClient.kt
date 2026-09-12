package top.natsuu.mta.control

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import android.os.Handler
import android.util.Log
import java.util.UUID
import rikka.shizuku.Shizuku
import top.natsuu.mta.IMaaTauriAndroidControlService
import top.natsuu.mta.RuntimeBridge

class ControlServiceClient(private val context: Context) : ServiceConnection {
    private var bound = false
    private val mainHandler = Handler(context.mainLooper)
    private var permissionListener: Shizuku.OnRequestPermissionResultListener? = null
    private var permissionResultCallback: ((Boolean) -> Unit)? = null
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

    init {
        Shizuku.addBinderReceivedListenerSticky(
            binderReceivedListener,
            mainHandler,
        )
    }

    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        if (binder == null) {
            RuntimeBridge.setControlState(STATE_ERROR)
            completePermissionRequest(false)
            return
        }
        ControlHost.attach(IMaaTauriAndroidControlService.Stub.asInterface(binder))
        RuntimeBridge.setControlState(STATE_CONNECTED)
        completePermissionRequest(true)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
        bound = false
        stopVirtualDisplaySafely()
        ControlHost.detach()
        RuntimeBridge.setControlState(STATE_DISCONNECTED)
        completePermissionRequest(false)
    }

    fun connect() {
        RuntimeBridge.setControlState(STATE_STARTING)
        if (!Shizuku.pingBinder()) {
            RuntimeBridge.setControlState(STATE_SHIZUKU_UNAVAILABLE)
            return
        }
        if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
            RuntimeBridge.setControlState(STATE_PERMISSION_REQUIRED)
            return
        }
        bindService()
    }

    fun disconnect() {
        stopVirtualDisplaySafely()
        if (bound) {
            Shizuku.unbindUserService(serviceArgs, this, true)
            bound = false
        }
        removePermissionListener()
        completePermissionRequest(false)
        ControlHost.detach()
        Shizuku.removeBinderReceivedListener(binderReceivedListener)
    }

    private fun stopVirtualDisplaySafely() {
        runCatching {
            RuntimeBridge.stopVirtualDisplay()
        }.onFailure { error ->
            android.util.Log.w(
                "MaaTauriAndroidControl",
                "Could not stop the virtual display before detaching",
                error,
            )
        }
    }

    fun requestPrivilegedAccess(onResult: (Boolean) -> Unit) {
        if (!Shizuku.pingBinder()) {
            RuntimeBridge.setControlState(STATE_SHIZUKU_UNAVAILABLE)
            onResult(false)
            return
        }
        val permissionGranted =
            Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
        if (permissionGranted || Shizuku.isPreV11()) {
            permissionResultCallback = onResult
            bindService()
            return
        }

        removePermissionListener()
        val listener = Shizuku.OnRequestPermissionResultListener { requestCode, result ->
            if (requestCode == REQUEST_CODE) {
                removePermissionListener()
                if (result == PackageManager.PERMISSION_GRANTED) {
                    permissionResultCallback = onResult
                    bindService()
                } else {
                    RuntimeBridge.setControlState(STATE_PERMISSION_REQUIRED)
                    onResult(false)
                }
            }
        }
        permissionListener = listener
        Shizuku.addRequestPermissionResultListener(listener, mainHandler)

        try {
            Shizuku.requestPermission(REQUEST_CODE)
        } catch (error: Throwable) {
            Log.w(
                "MaaTauriAndroidControl",
                "Could not request Shizuku permission",
                error,
            )
            removePermissionListener()
            RuntimeBridge.setControlState(STATE_ERROR)
            onResult(false)
        }
    }

    private fun bindService() {
        if (bound) {
            completePermissionRequest(true)
            return
        }
        RuntimeBridge.setControlState(STATE_STARTING)
        try {
            Shizuku.bindUserService(serviceArgs, this)
            bound = true
        } catch (error: Throwable) {
            bound = false
            RuntimeBridge.setControlState(STATE_ERROR)
            Log.w("MaaTauriAndroidControl", "Could not bind Shizuku user service", error)
            completePermissionRequest(false)
        }
    }

    private fun removePermissionListener() {
        permissionListener?.let(Shizuku::removeRequestPermissionResultListener)
        permissionListener = null
    }

    private fun completePermissionRequest(result: Boolean) {
        permissionResultCallback?.invoke(result)
        permissionResultCallback = null
    }

    companion object {
        private const val REQUEST_CODE = 9753
        private const val SERVICE_VERSION = 4

        const val STATE_SHIZUKU_UNAVAILABLE = 1
        const val STATE_PERMISSION_REQUIRED = 2
        const val STATE_CONNECTED = 3
        const val STATE_DISCONNECTED = 4
        const val STATE_ERROR = 5
        const val STATE_STARTING = 0
    }
}

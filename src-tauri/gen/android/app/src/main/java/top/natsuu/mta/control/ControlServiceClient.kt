package top.natsuu.mta.control

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Process
import android.util.Log
import com.topjohnwu.superuser.Shell
import java.io.File
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import rikka.shizuku.Shizuku
import top.natsuu.mta.IMaaTauriAndroidControlService
import top.natsuu.mta.RuntimeBridge
import top.natsuu.mta.control.root.RootServiceBootstrapRegistry
import top.natsuu.mta.control.root.RootServiceStarter

class ControlServiceClient(private val context: Context) : ServiceConnection {
    private var bound = false
    private val mainHandler = Handler(context.mainLooper)
    private val rootExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "mta-root-control").apply { isDaemon = true }
    }
    private var permissionListener: Shizuku.OnRequestPermissionResultListener? = null
    private var permissionResultCallback: ((Boolean) -> Unit)? = null
    private val connectionResultCallbacks = CopyOnWriteArrayList<(Boolean) -> Unit>()
    private val rootConnectionCallbacks = CopyOnWriteArrayList<(Boolean) -> Unit>()
    private val rootConnecting = AtomicBoolean(false)
    private val connectionGeneration = AtomicLong()
    private var boundConnectionGeneration = -1L
    private var selectedBackend = readSelectedBackend()

    @Volatile
    private var activeRootToken: String? = null

    @Volatile
    private var rootBinder: IBinder? = null

    private var rootDeathRecipient: IBinder.DeathRecipient? = null
    private val serviceArgs = Shizuku.UserServiceArgs(
        ComponentName(context, PrivilegedControlServiceImpl::class.java),
    )
        .daemon(false)
        .processNameSuffix("maa_tauri_android_control")
        .tag("control")
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
            completeConnectionRequest(false)
            completePermissionRequest(false)
            return
        }
        if (connectionGeneration.get() != boundConnectionGeneration) {
            runCatching {
                IMaaTauriAndroidControlService.Stub.asInterface(binder)?.destroy()
            }
            return
        }
        connectToService(binder)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
        bound = false
        handleServiceDisconnected()
    }

    fun getSelectedPrivilegedBackend(): String = selectedBackend

    fun connect(onResult: ((Boolean) -> Unit)? = null) {
        onResult?.let(connectionResultCallbacks::add)
        if (ControlHost.current() != null) {
            completeConnectionRequest(true)
            return
        }
        if (selectedBackend == BACKEND_ROOT) {
            // Root is user-authorized only. Startup and foreground reconnects
            // must not silently present a su prompt.
            RuntimeBridge.setControlState(STATE_DISCONNECTED)
            completeConnectionRequest(false)
            return
        }
        connectShizuku()
    }

    fun requestPrivilegedAccess(onResult: (Boolean) -> Unit) {
        if (ControlHost.current() != null) {
            onResult(true)
            return
        }
        if (selectedBackend == BACKEND_ROOT) {
            requestRootConnection(onResult)
            return
        }
        requestShizukuAccess(onResult)
    }

    fun switchPrivilegedBackend(backend: String): Boolean {
        val target = if (backend == BACKEND_ROOT) BACKEND_ROOT else BACKEND_SHIZUKU
        if (target == selectedBackend && ControlHost.current() != null) {
            return true
        }

        val previousBackend = selectedBackend
        val latch = CountDownLatch(1)
        var result = false
        disconnectForBackendSwitch(previousBackend, target)
        selectedBackend = target
        when (target) {
            BACKEND_ROOT -> requestRootConnection { connected ->
                result = connected
                latch.countDown()
            }

            else -> connect { connected ->
                result = connected
                latch.countDown()
            }
        }
        latch.await(SWITCH_TIMEOUT_MS, TimeUnit.MILLISECONDS)

        if (!result) {
            selectedBackend = previousBackend
            return false
        }
        persistSelectedBackend(target)
        return true
    }

    fun disconnect() {
        stopVirtualDisplaySafely()
        stopAgentsSafely()
        destroyCurrentServiceSafely()
        if (bound) {
            Shizuku.unbindUserService(serviceArgs, this, true)
            bound = false
        }
        removeRootBinder()
        removePermissionListener()
        completeConnectionRequest(false)
        completePermissionRequest(false)
        completeRootConnectionRequest(false)
        ControlHost.detach()
        Shizuku.removeBinderReceivedListener(binderReceivedListener)
        rootExecutor.shutdown()
    }

    private fun connectShizuku() {
        RuntimeBridge.setControlState(STATE_STARTING)
        if (!Shizuku.pingBinder()) {
            RuntimeBridge.setControlState(STATE_SHIZUKU_UNAVAILABLE)
            completeConnectionRequest(false)
            return
        }
        if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
            RuntimeBridge.setControlState(STATE_PERMISSION_REQUIRED)
            completeConnectionRequest(false)
            return
        }
        bindShizukuService()
    }

    private fun requestShizukuAccess(onResult: (Boolean) -> Unit) {
        if (!Shizuku.pingBinder()) {
            RuntimeBridge.setControlState(STATE_SHIZUKU_UNAVAILABLE)
            onResult(false)
            return
        }
        val permissionGranted =
            Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
        if (permissionGranted || Shizuku.isPreV11()) {
            permissionResultCallback = onResult
            bindShizukuService()
            return
        }

        removePermissionListener()
        val listener = Shizuku.OnRequestPermissionResultListener { requestCode, result ->
            if (requestCode == REQUEST_CODE) {
                removePermissionListener()
                if (result == PackageManager.PERMISSION_GRANTED) {
                    permissionResultCallback = onResult
                    bindShizukuService()
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
            Log.w(TAG, "Could not request Shizuku permission", error)
            removePermissionListener()
            RuntimeBridge.setControlState(STATE_ERROR)
            onResult(false)
        }
    }

    private fun bindShizukuService() {
        if (bound) {
            completePermissionRequest(true)
            completeConnectionRequest(ControlHost.current() != null)
            return
        }
        RuntimeBridge.setControlState(STATE_STARTING)
        try {
            boundConnectionGeneration = connectionGeneration.get()
            Shizuku.bindUserService(serviceArgs, this)
            bound = true
        } catch (error: Throwable) {
            bound = false
            boundConnectionGeneration = -1L
            RuntimeBridge.setControlState(STATE_ERROR)
            Log.w(TAG, "Could not bind Shizuku user service", error)
            completeConnectionRequest(false)
            completePermissionRequest(false)
        }
    }

    private fun requestRootConnection(onResult: (Boolean) -> Unit) {
        if (ControlHost.current() != null) {
            onResult(true)
            return
        }
        rootConnectionCallbacks.add(onResult)
        if (!rootConnecting.compareAndSet(false, true)) {
            return
        }

        RuntimeBridge.setControlState(STATE_STARTING)
        val token = UUID.randomUUID().toString()
        val binderFuture = RootServiceBootstrapRegistry.register(token)
        activeRootToken = token
        rootExecutor.execute {
            val rootStatus = runCatching { Shell.isAppGrantedRoot() }
            if (rootStatus.getOrNull() != true) {
                finishRootLaunch(
                    token,
                    null,
                    IllegalStateException("root access was not granted"),
                    STATE_SHIZUKU_UNAVAILABLE,
                )
                return@execute
            }

            val commandResult = runCatching { buildRootStartCommand(token) }
            if (commandResult.isFailure) {
                finishRootLaunch(token, null, commandResult.exceptionOrNull())
                return@execute
            }

            val shellResult = runCatching {
                Shell.cmd(commandResult.getOrThrow()).exec()
            }
            if (shellResult.isFailure) {
                finishRootLaunch(token, null, shellResult.exceptionOrNull())
                return@execute
            }
            if (shellResult.getOrThrow().code != 0) {
                finishRootLaunch(token, null, IllegalStateException("su rejected the launch"))
                return@execute
            }

            val binderResult = runCatching {
                binderFuture.get(ROOT_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            }
            finishRootLaunch(token, binderResult.getOrNull(), binderResult.exceptionOrNull())
        }
    }

    private fun finishRootLaunch(
        token: String,
        binder: IBinder?,
        error: Throwable?,
        failureState: Int = STATE_ERROR,
    ) {
        if (activeRootToken != token) {
            RootServiceBootstrapRegistry.unregister(token)
            return
        }
        if (binder == null) {
            activeRootToken = null
            rootConnecting.set(false)
            RootServiceBootstrapRegistry.unregister(token)
            killResidualRootService()
            RuntimeBridge.setControlState(failureState)
            Log.w(
                TAG,
                "Could not start the root control service",
                error ?: IllegalStateException("the root service binder did not arrive"),
            )
            mainHandler.post {
                completeRootConnectionRequest(false)
                completeConnectionRequest(false)
            }
            return
        }

        activeRootToken = token
        rootBinder = binder
        val recipient = IBinder.DeathRecipient {
            if (rootBinder === binder) {
                rootBinder = null
                activeRootToken = null
                rootConnecting.set(false)
                handleServiceDisconnected()
            }
        }
        rootDeathRecipient = recipient
        try {
            binder.linkToDeath(recipient, 0)
        } catch (linkError: Throwable) {
            rootBinder = null
            rootDeathRecipient = null
            activeRootToken = null
            rootConnecting.set(false)
            RuntimeBridge.setControlState(STATE_ERROR)
            Log.w(TAG, "Could not watch the root control service binder", linkError)
            mainHandler.post {
                completeRootConnectionRequest(false)
                completeConnectionRequest(false)
            }
            return
        }
        mainHandler.post {
            connectToService(binder)
            rootConnecting.set(false)
            completeRootConnectionRequest(true)
        }
    }

    private fun connectToService(binder: IBinder) {
        val service = IMaaTauriAndroidControlService.Stub.asInterface(binder)
        ControlHost.attach(service)
        registerOwnerSafely(service)
        heartbeatSafely(service)
        RuntimeBridge.setControlState(STATE_CONNECTED)
        completeConnectionRequest(true)
        completePermissionRequest(true)
    }

    private fun handleServiceDisconnected() {
        stopVirtualDisplaySafely()
        ControlHost.detach()
        RuntimeBridge.setControlState(STATE_DISCONNECTED)
        completeConnectionRequest(false)
        completePermissionRequest(false)
        completeRootConnectionRequest(false)
    }

    private fun disconnectForBackendSwitch(
        previousBackend: String,
        target: String,
    ) {
        connectionGeneration.incrementAndGet()
        stopVirtualDisplaySafely()
        stopAgentsSafely()
        destroyCurrentServiceSafely()
        removeRootBinder()
        if (previousBackend == BACKEND_ROOT || target == BACKEND_ROOT) {
            killResidualRootService()
        }
        if (bound) {
            Shizuku.unbindUserService(serviceArgs, this, true)
            bound = false
        }
        removePermissionListener()
        completeConnectionRequest(false)
        completePermissionRequest(false)
        completeRootConnectionRequest(false)
        ControlHost.detach()
    }

    private fun registerOwnerSafely(service: IMaaTauriAndroidControlService?) {
        if (service == null) return
        runCatching {
            service.registerOwner(ControlHost.ownerBinder())
        }.onFailure { error ->
            Log.w(TAG, "Could not register the owner token with the privileged service", error)
        }
    }

    private fun heartbeatSafely(service: IMaaTauriAndroidControlService?) {
        if (service == null) return
        runCatching {
            service.heartbeat(Process.myPid())
        }.onFailure { error ->
            Log.w(TAG, "Could not report the app pid to the privileged service", error)
        }
    }

    private fun destroyCurrentServiceSafely() {
        ControlHost.current()?.let { service ->
            runCatching { service.destroy() }.onFailure { error ->
                Log.w(TAG, "Could not destroy the privileged service process", error)
            }
        }
    }

    private fun removeRootBinder() {
        rootBinder?.let { binder ->
            rootDeathRecipient?.let { recipient ->
                runCatching { binder.unlinkToDeath(recipient, 0) }
            }
        }
        rootBinder = null
        rootDeathRecipient = null
        activeRootToken?.let(RootServiceBootstrapRegistry::unregister)
        activeRootToken = null
        rootConnecting.set(false)
    }

    private fun stopVirtualDisplaySafely() {
        runCatching {
            RuntimeBridge.stopVirtualDisplay()
        }.onFailure { error ->
            Log.w(TAG, "Could not stop the virtual display before detaching", error)
        }
    }

    private fun stopAgentsSafely() {
        runCatching {
            ControlHost.stopAllAgents()
        }.onFailure { error ->
            Log.w(TAG, "Could not stop agents before detaching", error)
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

    private fun completeConnectionRequest(result: Boolean) {
        connectionResultCallbacks.toList().forEach { callback ->
            runCatching { callback(result) }
        }
        connectionResultCallbacks.clear()
    }

    private fun completeRootConnectionRequest(result: Boolean) {
        rootConnectionCallbacks.toList().forEach { callback ->
            runCatching { callback(result) }
        }
        rootConnectionCallbacks.clear()
    }

    private fun buildRootStartCommand(token: String): String {
        val launcher = File(context.applicationInfo.nativeLibraryDir, "liblauncher.so")
        check(launcher.isFile) { "launcher not found: $launcher" }
        val apk = requireNotNull(context.applicationInfo.sourceDir) { "the APK path is missing" }
        val processName = "${context.packageName}:root_service"
        val debugDirectory =
            context.getExternalFilesDir("debug") ?: File(context.cacheDir, "debug")
        debugDirectory.mkdirs()
        val logFile = File(debugDirectory, "root_launch_debug.log")
        logFile.delete()
        val invocation = buildString {
            append(shellQuote(launcher.absolutePath))
            append(" --apk=").append(shellQuote(apk))
            append(" --process-name=").append(shellQuote(processName))
            append(" --starter-class=").append(shellQuote(RootServiceStarter::class.java.name))
            append(" --token=").append(shellQuote(token))
            append(" --package=").append(shellQuote(context.packageName))
            append(" --class=").append(shellQuote(PrivilegedControlServiceImpl::class.java.name))
            append(" --uid=").append(Process.myUid())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                append(" --keep-root")
            }
            append(" --log-file=").append(shellQuote(logFile.absolutePath))
            if (isDebuggable()) {
                append(" --debug-name=").append(shellQuote(processName))
            }
        }
        return "$invocation >/dev/null 2>&1 &"
    }

    private fun killResidualRootService() {
        val processName = "${context.packageName}:root_service"
        runCatching {
            Shell.cmd("kill $(pidof ${shellQuote(processName)}) 2>/dev/null").exec()
        }.onFailure { error ->
            Log.w(TAG, "Could not stop a residual root control service", error)
        }
    }

    private fun isDebuggable(): Boolean =
        (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun readSelectedBackend(): String {
        val preferences =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        return if (
            preferences.getString(PREFERENCES_KEY, BACKEND_SHIZUKU) == BACKEND_ROOT
        ) {
            BACKEND_ROOT
        } else {
            BACKEND_SHIZUKU
        }
    }

    private fun persistSelectedBackend(backend: String) {
        selectedBackend = backend
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFERENCES_KEY, backend)
            .apply()
    }

    private fun shellQuote(value: String): String =
        "'${value.replace("'", "'\"'\"'")}'"

    companion object {
        private const val TAG = "MaaTauriAndroidControl"
        private const val REQUEST_CODE = 9753
        private const val SERVICE_VERSION = 13
        private const val ROOT_CONNECT_TIMEOUT_MS = 15_000L
        private const val SWITCH_TIMEOUT_MS = 18_000L
        private const val PREFERENCES_NAME = "privileged_backend"
        private const val PREFERENCES_KEY = "backend"

        const val BACKEND_SHIZUKU = "shizuku"
        const val BACKEND_ROOT = "root"
        const val STATE_SHIZUKU_UNAVAILABLE = 1
        const val STATE_PERMISSION_REQUIRED = 2
        const val STATE_CONNECTED = 3
        const val STATE_DISCONNECTED = 4
        const val STATE_ERROR = 5
        const val STATE_STARTING = 0

        init {
            Shell.setDefaultBuilder(
                Shell.Builder.create()
                    .setFlags(Shell.FLAG_MOUNT_MASTER)
                    .setTimeout(15),
            )
        }
    }
}

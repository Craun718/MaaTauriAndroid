package top.natsuu.mta

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.app.ActivityManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.PowerManager
import android.os.ParcelFileDescriptor
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import java.io.File
import java.io.IOException
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

object RuntimeBridge {
    init {
        System.loadLibrary("maa_tauri_android_lib")
    }

    @Volatile
    private var agentContext: Context? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var controlClient: ControlServiceClient? = null
    @Volatile
    private var physicalScreenWidth = 0
    @Volatile
    private var physicalScreenHeight = 0

    @JvmStatic
    fun attachContext(context: Context) {
        agentContext = context.applicationContext
        physicalScreenWidth = context.resources.displayMetrics.widthPixels
        physicalScreenHeight = context.resources.displayMetrics.heightPixels
    }

    @JvmStatic
    fun agentBridgeContext(): Any? = agentContext

    @JvmStatic
    fun attachControlClient(client: ControlServiceClient) {
        controlClient = client
    }

    @JvmStatic
    fun detachControlClient(client: ControlServiceClient) {
        if (controlClient === client) {
            controlClient = null
        }
    }

    @JvmStatic
    fun connectPrivilegedService(timeoutMs: Long): Boolean {
        val client = controlClient ?: return false
        val latch = CountDownLatch(1)
        val connected = AtomicBoolean(false)
        mainHandler.post {
            client.connect { result ->
                connected.set(result)
                latch.countDown()
            }
        }
        return latch.await(timeoutMs, TimeUnit.MILLISECONDS) && connected.get()
    }

    @JvmStatic
    fun requestPrivilegedAccess(): Boolean {
        val client = controlClient ?: return false
        val latch = CountDownLatch(1)
        val granted = AtomicBoolean(false)
        mainHandler.post {
            client.requestPrivilegedAccess { result ->
                granted.set(result)
                latch.countDown()
            }
        }
        return latch.await(60, TimeUnit.SECONDS) && granted.get()
    }

    @JvmStatic
    fun openShizuku(): Boolean {
        val context = agentContext ?: return false
        val intent = context.packageManager.getLaunchIntentForPackage(SHIZUKU_PACKAGE)
            ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching {
            context.startActivity(intent)
            true
        }.getOrDefault(false)
    }

    /**
     * Reads this app's logs without the privileged service so log export still
     * works after Shizuku or the control process goes away.
     */
    @JvmStatic
    fun localLogcat(): ParcelFileDescriptor? = runCatching {
        val process = ProcessBuilder(
            "logcat",
            "-d",
            "-v",
            "threadtime",
            "--pid=${android.os.Process.myPid()}",
        ).redirectErrorStream(true).start()
        val (reader, writer) = ParcelFileDescriptor.createPipe()
        thread {
            try {
                process.inputStream.use { input ->
                    ParcelFileDescriptor.AutoCloseOutputStream(writer).use { output ->
                        input.copyTo(output)
                    }
                }
                process.waitFor()
            } catch (error: Throwable) {
                runCatching { writer.close() }
                runCatching { process.destroyForcibly() }
            }
        }
        reader
    }.getOrNull()

    /**
     * Builds a plain-text device snapshot without the privileged service so
     * the log export can include it even when Shizuku is unavailable.
     */
    @JvmStatic
    fun deviceInfo(): String? {
        val context = agentContext ?: return null
        return runCatching { renderDeviceInfo(context) }.getOrNull()
    }

    private fun renderDeviceInfo(context: Context): String {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        val divider = "=".repeat(60)
        return buildString {
            append(divider).append('\n')
            append("=== MaaTauriAndroid Device & App Info ===\n")
            append("Export Time : ").append(DEVICE_TIME_FORMAT.format(java.time.ZonedDateTime.now())).append('\n')
            append("App         : ").append(context.packageName).append('\n')
            append("Version     : ").append(packageInfo.versionName)
                .append(" (").append(packageInfo.longVersionCode).append(")\n")
            append("Device      : ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
            append("Android     : ").append(Build.VERSION.RELEASE)
                .append(" (API ").append(Build.VERSION.SDK_INT).append(")\n")
            append("Security    : ").append(Build.VERSION.SECURITY_PATCH).append('\n')
            append("ABI         : ").append(Build.SUPPORTED_ABIS.joinToString()).append('\n')
            append("--- Device ---\n")
            append("Screen      : ").append(screenInfo(context)).append('\n')
            append("RAM         : ").append(memoryInfo(context)).append('\n')
            append("Storage     : ").append(storageInfo(context)).append('\n')
            append("Battery Opt : ").append(batteryOptimization(context)).append('\n')
            append("SELinux     : ").append(selinuxMode()).append('\n')
            append(divider).append('\n')
        }
    }

    @Suppress("DEPRECATION")
    private fun screenInfo(context: Context): String = runCatching {
        val metrics = context.resources.displayMetrics
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val refresh = wm.defaultDisplay.refreshRate
        "${metrics.widthPixels} x ${metrics.heightPixels} @ " +
            "%.0f".format(Locale.US, refresh) +
            "Hz (density ${metrics.densityDpi}dpi)"
    }.getOrDefault(UNKNOWN)

    private fun memoryInfo(context: Context): String = runCatching {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        "${formatGb(info.totalMem)} total, ${formatGb(info.availMem)} free"
    }.getOrDefault(UNKNOWN)

    private fun storageInfo(context: Context): String = runCatching {
        val dir = context.filesDir
        "${formatGb(dir.usableSpace)} usable / ${formatGb(dir.totalSpace)} total"
    }.getOrDefault(UNKNOWN)

    private fun batteryOptimization(context: Context): String = runCatching {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(context.packageName)) {
            "ignored (app exempt)"
        } else {
            "NOT ignored"
        }
    }.getOrDefault(UNKNOWN)

    private fun selinuxMode(): String = runCatching {
        when (File("/sys/fs/selinux/enforce").readText().trim()) {
            "1" -> "enforcing"
            "0" -> "permissive"
            else -> UNKNOWN
        }
    }.getOrDefault(UNKNOWN)

    private fun formatGb(bytes: Long): String =
        "%.1f GB".format(Locale.US, bytes / 1024f / 1024f / 1024f)

    /**
     * Copies the log archive into the system Downloads collection and opens the
     * share sheet for it. Returns the display name of the saved copy, or null
     * when the export could not be completed. On API < 29 MediaStore.Downloads
     * does not exist, so the archive is copied into the app external files dir
     * instead; no share sheet is opened there.
     */
    @JvmStatic
    fun exportLogs(archivePath: String): String? {
        val context = agentContext ?: return null
        val source = File(archivePath)
        if (!source.isFile) return null
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val uri = copyToDownloads(context, source)
                startShare(context, uri, source.name)
                source.name
            } else {
                val fallback = File(
                    requireNotNull(context.getExternalFilesDir(null)) {
                        "external files directory is unavailable"
                    },
                    source.name,
                )
                source.copyTo(fallback, overwrite = true)
                source.name
            }
        }.getOrNull()
    }

    private fun copyToDownloads(context: Context, source: File): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, source.name)
            put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = requireNotNull(
            resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values),
        ) { "MediaStore rejected the download entry" }
        resolver.openOutputStream(uri)?.use { output ->
            source.inputStream().use { input -> input.copyTo(output) }
        } ?: throw IOException("could not open output stream for $uri")
        values.clear()
        values.put(MediaStore.MediaColumns.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        return uri
    }

    private fun startShare(context: Context, uri: Uri, title: String) {
        val share = Intent(Intent.ACTION_SEND).apply {
            type = "application/zip"
            putExtra(Intent.EXTRA_STREAM, uri)
            // Chooser targets read the stream through ClipData on some versions,
            // so grant read access on both surfaces.
            clipData = ClipData.newRawUri(title, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(
            Intent.createChooser(share, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    @JvmStatic
    fun agentDescriptor(): String? {
        return runCatching {
            agentContext?.assets?.open("agent/runtime.json")?.bufferedReader()?.use { it.readText() }
        }.getOrNull()
    }

    @JvmStatic
    fun openAgentAsset(name: String): ParcelFileDescriptor? {
        val context = requireNotNull(agentContext) { "the agent bridge context is missing" }
        val asset = context.assets.open(name)
        val file = File.createTempFile("agent-asset-", ".zip", context.cacheDir)
        file.outputStream().use { destination -> asset.use { it.copyTo(destination) } }
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        file.delete()
        return descriptor
    }

    @JvmStatic
    fun agentNativeLibraryDir(): String {
        return requireNotNull(agentContext).applicationInfo.nativeLibraryDir
    }

    @JvmStatic
    fun nativeLibraryPath(name: String): String {
        val context = requireNotNull(agentContext) { "the runtime bridge context is missing" }
        val libraryDir = context.applicationInfo.nativeLibraryDir
        if (libraryDir.isNotEmpty()) {
            val library = File(libraryDir, System.mapLibraryName(name))
            if (library.isFile) return library.absolutePath
        }

        val abi = requireNotNull(Build.SUPPORTED_ABIS.firstOrNull()) {
            "the device does not report a supported ABI"
        }
        val sourceDir = requireNotNull(context.applicationInfo.sourceDir) {
            "the application APK path is missing"
        }
        // Rust dlopen cannot open APK-internal paths. This remains as a clear
        // diagnostic for a build that did not use legacy native-library packaging.
        return "$sourceDir!/lib/$abi/lib$name.so"
    }

    @JvmStatic
    fun startVirtualDisplay(width: Int, height: Int, dpi: Int): Boolean {
        val displayId = runCatching {
            ControlHost.startVirtualDisplay(width, height, dpi)
        }.getOrDefault(-1)
        if (displayId < 0) return false

        ControlHost.configure(displayId, width, height)
        configureScreen(width, height)
        setActiveDisplay(displayId)
        VirtualDisplayStreamHost.start(width, height)?.let { previewSurface ->
            runCatching {
                ControlHost.attachPreviewSurface(previewSurface)
            }.onFailure {
                VirtualDisplayStreamHost.stop()
            }
        }
        return true
    }

    @JvmStatic
    fun stopVirtualDisplay(): Boolean {
        runCatching {
            ControlHost.attachPreviewSurface(null)
        }
        VirtualDisplayStreamHost.stop()
        runCatching {
            ControlHost.stopVirtualDisplay()
        }
        val width = physicalScreenWidth
        val height = physicalScreenHeight
        if (width > 0 && height > 0) {
            ControlHost.configure(0, width, height)
            configureScreen(width, height)
        }
        setActiveDisplay(0)
        return true
    }

    @JvmStatic
    fun virtualDisplayStatus(): IntArray {
        return ControlHost.virtualDisplayStatus() ?: intArrayOf(0, -1, 0, 0, 0)
    }

    @JvmStatic
    fun virtualDisplayStreamUrl(): String? = VirtualDisplayStreamHost.streamUrl()

    @JvmStatic
    external fun configureScreen(width: Int, height: Int)

    @JvmStatic
    external fun setActiveDisplay(displayId: Int)

    @JvmStatic
    external fun setControlState(state: Int)

    @JvmStatic
    external fun initializeSecretBridge()

    @JvmStatic
    external fun setBootstrapProjectRoot(projectRoot: String)

    private const val SHIZUKU_PACKAGE = "moe.shizuku.privileged.api"
    private const val UNKNOWN = "unknown"
    private val DEVICE_TIME_FORMAT =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS (Z)", Locale.US)
}

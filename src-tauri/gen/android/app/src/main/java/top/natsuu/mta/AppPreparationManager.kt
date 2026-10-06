package top.natsuu.mta

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import top.natsuu.mta.control.ControlHost
import top.natsuu.mta.control.ControlServiceClient

/**
 * Owns process-lifetime initialization. The activity stays launchable while the
 * Project Interface, Keystore bridge, native runtime, and privileged service are
 * prepared; a destroyed activity must not cancel any of that work.
 */
object AppPreparationManager {
    private const val TAG = "MaaPreparation"
    private const val CONNECT_TIMEOUT_MS = 5_000L
    private const val COPY_PROGRESS_INTERVAL_BYTES = 16L * 1024 * 1024
    private const val EXTRACT_PROGRESS_INTERVAL_ENTRIES = 64

    private val executor =
        Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "mta-app-preparation").apply { isDaemon = true }
        }
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var applicationContext: Context? = null

    @Volatile
    private var controlClient: ControlServiceClient? = null

    @Volatile
    private var started = false

    @Volatile
    private var running = false

    fun start(context: Context) {
        val appContext = context.applicationContext
        synchronized(this) {
            if (started) return
            started = true
            applicationContext = appContext
            running = true
        }
        executor.execute { prepare(appContext) }
    }

    /** Called from Rust after a preparation failure; a healthy run is left alone. */
    fun retry(): String {
        val context = applicationContext ?: return "unavailable"
        synchronized(this) {
            if (running) return "running"
            started = true
            running = true
        }
        report(
            stage = "retrying",
            projectReady = false,
            engineReady = false,
        )
        executor.execute { prepare(context) }
        return "started"
    }

    fun connectControl() {
        controlClient?.let { client ->
            mainHandler.post { client.connect() }
        }
    }

    private fun prepare(context: Context) {
        var currentStage = "checkingInstallation"
        var projectReady = false
        try {
            StartupTrace.mark("app_preparation_start")
            report(stage = currentStage)
            var lastReportedCopiedBytes = 0L
            var lastReportedExtractedEntries = -1
            val projectRoot = PiInstaller.install(context) { progress ->
                val shouldReport = when (progress.phase) {
                    PiInstaller.Progress.Phase.COPYING -> lastReportedCopiedBytes == 0L ||
                        progress.copiedBytes - lastReportedCopiedBytes >=
                        COPY_PROGRESS_INTERVAL_BYTES
                    PiInstaller.Progress.Phase.EXTRACTING -> lastReportedExtractedEntries < 0 ||
                        progress.extractedEntries - lastReportedExtractedEntries >=
                        EXTRACT_PROGRESS_INTERVAL_ENTRIES
                }
                if (shouldReport) {
                    currentStage = "installingProject"
                    report(
                        stage = currentStage,
                        progress = JSONObject().apply {
                            put("phase", progress.phase.name.lowercase())
                            put("copiedBytes", progress.copiedBytes)
                            put("totalArchiveBytes", progress.totalArchiveBytes)
                            put("extractedEntries", progress.extractedEntries)
                            put("totalEntries", progress.totalEntries)
                            progress.currentFile?.let { put("currentFile", it) }
                        },
                    )
                    when (progress.phase) {
                        PiInstaller.Progress.Phase.COPYING -> {
                            lastReportedCopiedBytes = progress.copiedBytes
                        }
                        PiInstaller.Progress.Phase.EXTRACTING -> {
                            lastReportedExtractedEntries = progress.extractedEntries
                        }
                    }
                }
            } ?: throw IllegalStateException("The packaged Project Interface is unavailable")

            StartupTrace.mark("pi_install_ready")
            currentStage = "initializingSecrets"
            report(stage = currentStage)
            if (!RuntimeBridge.initializeSecretBridge()) {
                throw IllegalStateException("Could not initialize the Android secret bridge")
            }
            StartupTrace.mark("secrets_ready")
            currentStage = "loadingProject"
            projectReady = true
            report(
                stage = currentStage,
                projectReady = projectReady,
                projectRoot = projectRoot.absolutePath,
            )

            currentStage = "loadingRuntimeLibraries"
            report(stage = currentStage)
            MaaRuntime.load()
            val width = context.resources.displayMetrics.widthPixels
            val height = context.resources.displayMetrics.heightPixels
            RuntimeBridge.configureScreen(width, height)
            ControlHost.configure(0, width, height)
            StartupTrace.mark("runtime_libraries_ready")

            currentStage = "connectingControl"
            report(stage = currentStage)
            val client = ControlServiceClient(context)
            controlClient = client
            RuntimeBridge.attachControlClient(client)
            RuntimeBridge.setPrivilegedBackend(client.getSelectedPrivilegedBackend())
            val connected = CountDownLatch(1)
            var controlReady = false
            mainHandler.post {
                client.connect {
                    controlReady = it
                    connected.countDown()
                }
            }
            // Shizuku being absent is an authorization state, not a preparation
            // failure. Its status card and run retry flow own the follow-up.
            connected.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            StartupTrace.mark(if (controlReady) "control_ready" else "control_unavailable")
            report(
                stage = "engineReady",
                projectReady = projectReady,
                engineReady = true,
                projectRoot = projectRoot.absolutePath,
            )
        } catch (error: Throwable) {
            Log.e(TAG, "App preparation failed", error)
            runCatching {
                controlClient?.let { client ->
                    RuntimeBridge.detachControlClient(client)
                    client.disconnect()
                }
            }.onFailure { cleanupError ->
                Log.w(TAG, "Could not clean up the control client", cleanupError)
            }
            controlClient = null
            report(
                stage = currentStage,
                projectReady = projectReady,
                engineReady = false,
                error = error.message ?: error.javaClass.simpleName,
            )
        } finally {
            synchronized(this) { running = false }
        }
    }

    private fun report(
        stage: String,
        projectReady: Boolean = false,
        engineReady: Boolean = false,
        projectRoot: String? = null,
        progress: JSONObject? = null,
        error: String? = null,
    ) {
        val payload = JSONObject().apply {
            put("status", if (error == null) "running" else "failed")
            put("stage", stage)
            put("projectReady", projectReady)
            put("engineReady", engineReady)
            projectRoot?.let { put("projectRoot", it) }
            progress?.let { put("progress", it) }
            error?.let { put("error", it) }
        }
        RuntimeBridge.reportPreparationState(payload.toString())
    }
}

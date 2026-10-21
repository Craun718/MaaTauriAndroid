package top.natsuu.mta.control

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.util.AtomicFile
import android.util.Log
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

internal data class ExitStamp(val timestamp: Long, val pid: Int) : Comparable<ExitStamp> {
    override fun compareTo(other: ExitStamp): Int =
        compareValuesBy(this, other, ExitStamp::timestamp, ExitStamp::pid)
}

/** All optional diagnostic I/O, including the watermark, stays behind this boundary. */
internal class ExitHistoryTransaction<T>(
    private val query: () -> List<T>,
    private val stamp: (T) -> ExitStamp,
    private val load: () -> ExitStamp?,
    private val save: (ExitStamp) -> Unit,
    private val emit: (T) -> Unit,
    private val failed: (Exception) -> Unit,
) {
    fun record() {
        try {
            val previous = load()
            val records = query().sortedBy(stamp)
            val pending = if (previous == null) records.takeLast(3) else records.filter { stamp(it) > previous }
            pending.forEach(emit)
            pending.lastOrNull()?.let { save(stamp(it)) }
        } catch (error: Exception) {
            failed(error)
        }
    }
}

/** Local-only diagnostics: never forwarded through the telemetry bridge. */
internal class ProcessExitHistory(private val context: Context, private val directory: File) {
    private val worker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "mta-process-exits").apply { isDaemon = true }
    }
    private val nextQuery = ConcurrentHashMap<String, Long>()

    fun record(packageName: String) {
        if (Build.VERSION.SDK_INT < 30 || !PACKAGE.matches(packageName)) return
        val now = android.os.SystemClock.elapsedRealtime()
        // Bound queued work even while a vendor ActivityManager call is blocked.
        val previous = nextQuery.putIfAbsent(packageName, Long.MAX_VALUE)
        if (previous != null && (previous > now || !nextQuery.replace(packageName, previous, Long.MAX_VALUE))) return
        worker.execute {
            try {
                recordNow(packageName)
            } finally {
                nextQuery[packageName] = android.os.SystemClock.elapsedRealtime() + 10_000L
            }
        }
    }

    @androidx.annotation.RequiresApi(30)
    private fun recordNow(packageName: String) {
        val watermark = AtomicFile(File(directory, "$packageName.watermark"))
        ExitHistoryTransaction(
            query = {
                val manager = requireNotNull(context.getSystemService(ActivityManager::class.java))
                manager.getHistoricalProcessExitReasons(packageName, 0, 16)
            },
            stamp = { info: ApplicationExitInfo -> ExitStamp(info.timestamp, info.pid) },
            load = {
                if (!watermark.baseFile.exists() && !File(watermark.baseFile.path + ".bak").exists()) null
                else watermark.openRead().bufferedReader().use { input ->
                    val parts = input.readText().split(':')
                    ExitStamp(parts[0].toLong(), parts[1].toInt())
                }
            },
            save = { stamp ->
                check(directory.isDirectory || directory.mkdirs()) { "exit history directory unavailable" }
                val output = watermark.startWrite()
                try {
                    output.write("${stamp.timestamp}:${stamp.pid}".toByteArray())
                    watermark.finishWrite(output)
                } catch (error: Exception) {
                    watermark.failWrite(output)
                    throw error
                }
            },
            emit = { info ->
                val message = "Process exit: package=$packageName process=${info.processName} " +
                    "pid=${info.pid} at=${info.timestamp} reason=${info.reason} status=${info.status} " +
                    "importance=${info.importance} pss=${info.pss} rss=${info.rss} " +
                    "description=${info.description?.take(512)}"
                if (info.reason == ApplicationExitInfo.REASON_USER_REQUESTED ||
                    info.reason == ApplicationExitInfo.REASON_EXIT_SELF ||
                    info.reason == ApplicationExitInfo.REASON_PACKAGE_UPDATED
                ) Log.i(TAG, message) else Log.w(TAG, message)
            },
            failed = { error -> Log.w(TAG, "Could not record process exits for $packageName", error) },
        ).record()
    }

    companion object {
        private const val TAG = "MTAProcessExit"
        private val PACKAGE = Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")

        fun recordSelf(context: Context) {
            runCatching {
                ProcessExitHistory(context.applicationContext, File(context.filesDir, "process-exits"))
                    .record(context.packageName)
            }.onFailure { Log.w(TAG, "Could not schedule app exit diagnostics", it) }
        }
    }
}

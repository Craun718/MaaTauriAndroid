package top.natsuu.mta

import android.content.ContentValues
import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.Build
import android.os.storage.StorageManager
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.json.JSONObject

/** Resolve shared-storage paths for Maa/Agent; only non-local files are imported. */
object OptionPathPicker {
    private const val TIMEOUT_MS = 120_000L
    private val mainHandler = Handler(Looper.getMainLooper())
    private class Request(val directory: Boolean) {
        val latch = CountDownLatch(1)
        val claimed = AtomicBoolean(false)
        var expired = false
        var finished = false
        var result: String? = null
    }
    private val pending = AtomicReference<Request?>(null)
    @Volatile private var fileLauncher: (() -> Unit)? = null
    @Volatile private var directoryLauncher: (() -> Unit)? = null

    fun register(file: () -> Unit, directory: () -> Unit) {
        fileLauncher = file
        directoryLauncher = directory
    }

    fun pick(directory: Boolean): String? {
        val request = Request(directory)
        if (!pending.compareAndSet(null, request)) return error("busy")
        mainHandler.post {
            val launcher = if (directory) directoryLauncher else fileLauncher
            try {
                checkNotNull(launcher) { "picker is unavailable" }.invoke()
            } catch (_: Exception) {
                finish(request, error("unavailable"))
            }
        }
        if (!request.latch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            synchronized(request) {
                if (!request.finished) {
                    request.expired = true
                    // Once the result callback was consumed, a blocked provider
                    // must not keep every future picker busy. The old worker's
                    // finish() only CAS-clears its own request.
                    if (request.claimed.get()) pending.compareAndSet(request, null)
                    // While still waiting for the system callback, retain the slot
                    // so a late picker result cannot be assigned to a new request.
                    return error("timeout")
                }
            }
        }
        return synchronized(request) { request.result }
    }

    fun complete(context: Context, uri: Uri?, directory: Boolean) {
        val request = pending.get() ?: return
        if (request.directory != directory || !request.claimed.compareAndSet(false, true)) return
        if (uri == null || synchronized(request) { request.expired }) {
            finish(request, null)
            return
        }
        thread(name = "mta-import-option-path") {
            var imported: Uri? = null
            try {
                checkActive(request)
                val document = if (directory) {
                    DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
                } else uri
                val local = resolveLocalPath(context, document)
                if (local != null) {
                    finish(request, JSONObject().put("path", local.absolutePath).toString())
                    return@thread
                }
                // A directory may be an output destination: copying it would silently
                // redirect writes. Reject virtual/cloud trees rather than snapshotting.
                if (directory) throw IOException("unsupportedDirectory")
                check(Build.VERSION.SDK_INT >= 29) { "MediaStore Downloads requires Android 10" }
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, displayName(context, document))
                    put(MediaStore.Downloads.MIME_TYPE, context.contentResolver.getType(document) ?: "application/octet-stream")
                    put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/MaaTauriAndroid/${context.packageName}/option-inputs/${UUID.randomUUID()}")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                checkActive(request)
                val destination = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IOException("could not create shared download")
                imported = destination
                copyFile(context, document, destination, OptionPathCopyBudget(), request)
                val target = validateLocal(queryData(context, destination))
                    ?: throw IOException("download provider did not expose a shared native path")
                checkActive(request)
                check(context.contentResolver.update(destination, ContentValues().apply {
                    put(MediaStore.Downloads.IS_PENDING, 0)
                }, null, null) == 1) { "could not publish shared download" }
                finish(request, JSONObject().put("path", target.absolutePath).toString()) {
                    context.contentResolver.delete(destination, null, null)
                }
            } catch (failure: Exception) {
                imported?.let { runCatching { context.contentResolver.delete(it, null, null) } }
                finish(request, error(when {
                    failure is OptionPathLimitExceeded -> "tooLarge"
                    failure.message == "unsupportedDirectory" -> "unsupportedDirectory"
                    else -> "readFailed"
                }))
            }
        }
    }

    private fun finish(request: Request, result: String?, onExpired: (() -> Unit)? = null) {
        synchronized(request) {
            if (request.expired) runCatching { onExpired?.invoke() }
            request.result = result
            request.finished = true
        }
        pending.compareAndSet(request, null)
        request.latch.countDown()
    }

    private fun checkActive(request: Request) {
        synchronized(request) { check(!request.expired) { "import timed out" } }
    }

    private fun resolveLocalPath(context: Context, uri: Uri): File? {
        val candidate = runCatching {
            val id = DocumentsContract.getDocumentId(uri)
            when (uri.authority) {
                "com.android.externalstorage.documents" -> OptionLocalPath.externalDocumentPath(
                    id, Environment.getExternalStorageDirectory().absolutePath,
                ) { volume ->
                    if (Build.VERSION.SDK_INT >= 30) {
                        context.getSystemService(StorageManager::class.java).storageVolumes
                            .firstOrNull { it.uuid.equals(volume, ignoreCase = true) }?.directory?.absolutePath
                    } else null
                }
                "com.android.providers.downloads.documents" -> id.takeIf { it.startsWith("raw:") }?.removePrefix("raw:")
                else -> null
            }
        }.getOrNull()
        validateLocal(candidate)?.let { return it }
        // Some Downloads/Media providers expose a genuine local _data path.
        // Never guess a path from a display name or return a content:// URI.
        validateLocal(queryData(context, uri))?.let { return it }
        val providerPath = runCatching {
            val id = DocumentsContract.getDocumentId(uri)
            when (uri.authority) {
                "com.android.providers.media.documents" -> {
                    val parts = id.split(':', limit = 2)
                    val collection = when (parts.firstOrNull()) {
                        "image" -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                        "video" -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        "audio" -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                        else -> null
                    }
                    val itemId = parts.getOrNull(1)?.toLongOrNull()
                    if (collection != null && itemId != null) queryData(context, ContentUris.withAppendedId(collection, itemId)) else null
                }
                "com.android.providers.downloads.documents" -> id.toLongOrNull()?.let {
                    queryData(context, ContentUris.withAppendedId(Uri.parse("content://downloads/public_downloads"), it))
                }
                else -> null
            }
        }.getOrNull()
        return validateLocal(providerPath)
    }

    private fun queryData(context: Context, uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf("_data"), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull()

    private fun validateLocal(path: String?): File? {
        if (path == null || !OptionLocalPath.isSharedPath(path)) return null
        // SAF grants provider access, not app-UID POSIX access. Do not stat,
        // canonicalize, or canRead() a path that only the privileged Agent uses.
        return File(path)
    }

    private fun copyFile(context: Context, source: Uri, target: Uri, budget: OptionPathCopyBudget, request: Request) {
        context.contentResolver.openInputStream(source)?.use { input ->
            context.contentResolver.openOutputStream(target, "w")?.use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    checkActive(request)
                    val count = input.read(buffer)
                    if (count < 0) break
                    budget.bytes(count)
                    output.write(buffer, 0, count)
                }
            } ?: throw IOException("could not write shared download")
        } ?: throw IOException("could not read selected document")
    }

    private fun displayName(context: Context, uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return OptionPathCopyBudget.safeName(cursor.getString(0))
        }
        throw IOException("document has no display name")
    }

    private fun error(code: String): String = JSONObject().put("error", code).toString()
}

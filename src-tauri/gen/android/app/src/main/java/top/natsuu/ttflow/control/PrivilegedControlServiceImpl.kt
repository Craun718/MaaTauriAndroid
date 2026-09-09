package top.natsuu.ttflow.control

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.ParcelFileDescriptor
import java.util.concurrent.Executors
import kotlin.concurrent.thread
import top.natsuu.ttflow.ITtflowControlService

class PrivilegedControlServiceImpl(private val context: Context?) : ITtflowControlService.Stub() {
    private val executor = Executors.newSingleThreadExecutor()

    private val binder = this

    override fun captureFrame(displayId: Int): ParcelFileDescriptor {
        val frame = capture(displayId)
        val (readEnd, writeEnd) = ParcelFileDescriptor.createPipe()
        thread(name = "ttflow-frame-writer") {
            ParcelFileDescriptor.AutoCloseOutputStream(writeEnd).use { stream ->
                stream.write(frame)
            }
        }
        return readEnd
    }

    override fun dispatchInput(
        displayId: Int,
        method: Int,
        x: Int,
        y: Int,
        contact: Int,
        keyCode: Int,
        text: String?,
        packageName: String?,
        forceStop: Boolean,
    ): Int {
        return dispatch(method, x, y, keyCode, text, packageName, forceStop)
    }

    override fun protocolVersion(): Int = PROTOCOL_VERSION

    private fun capture(displayId: Int): ByteArray {
        val process = if (displayId == 0) {
            ProcessBuilder("/system/bin/screencap", "-p")
        } else {
            ProcessBuilder("/system/bin/screencap", "-d", displayId.toString(), "-p")
        }.start()
        val decoded = process.inputStream.use(BitmapFactory::decodeStream)
        val error = process.errorStream?.buffered()?.readBytes()?.toString(Charsets.UTF_8).orEmpty()
        val status = process.waitFor()
        require(status == 0 && decoded != null) { "screencap failed: $status $error" }

        val pixels = decoded.copy(Bitmap.Config.ARGB_8888, false)
        val bytes = ByteArray(pixels.rowBytes * pixels.height)
        pixels.copyPixelsToBuffer(java.nio.ByteBuffer.wrap(bytes))
        pixels.recycle()
        return bytes
    }

    private fun dispatch(
        method: Int,
        x: Int,
        y: Int,
        keyCode: Int,
        text: String?,
        packageName: String?,
        forceStop: Boolean,
    ): Int {
        when (method) {
            METHOD_START_GAME -> {
                val target = packageName.orEmpty()
                if (target.isNotEmpty()) {
                    if (forceStop) shell("am", "force-stop", target)
                    shell("monkey", "-p", target, "-c", "android.intent.category.LAUNCHER", "1")
                }
            }
            METHOD_STOP_GAME -> shell("am", "force-stop", packageName.orEmpty())
            METHOD_INPUT_TEXT -> {
                if (!text.isNullOrEmpty()) {
                    shell("input", "text", text)
                }
            }
            METHOD_TOUCH_DOWN -> shell("input", "tap", x.toString(), y.toString())
            METHOD_TOUCH_MOVE -> {
                shell(
                    "input", "swipe", x.toString(), y.toString(),
                    x.toString(), y.toString(), "0",
                )
            }
            METHOD_KEY_UP -> shell("input", "keyevent", keyCode.toString())
            METHOD_TOUCH_UP, METHOD_KEY_DOWN -> Unit
        }
        return 0
    }

    private fun shell(vararg args: String): Int {
        return ProcessBuilder(*args).start().waitFor()
    }

    companion object {
        const val PROTOCOL_VERSION = 1
        const val METHOD_START_GAME = 1
        const val METHOD_STOP_GAME = 2
        const val METHOD_INPUT_TEXT = 4
        const val METHOD_TOUCH_DOWN = 6
        const val METHOD_TOUCH_MOVE = 7
        const val METHOD_TOUCH_UP = 8
        const val METHOD_KEY_DOWN = 9
        const val METHOD_KEY_UP = 10
    }
}

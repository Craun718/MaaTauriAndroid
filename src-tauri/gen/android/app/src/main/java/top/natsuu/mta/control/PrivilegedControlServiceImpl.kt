package top.natsuu.mta.control

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Surface
import top.natsuu.mta.AgentLaunch
import top.natsuu.mta.InputResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStream
import kotlin.concurrent.thread
import top.natsuu.mta.IMaaTauriAndroidControlService

class PrivilegedControlServiceImpl(private val context: Context?) : IMaaTauriAndroidControlService.Stub() {
    private val executor = Executors.newSingleThreadExecutor()
    private val contacts = LinkedHashMap<Int, TouchPointer>()
    private val bugreportProcess = AtomicReference<Process?>(null)
    private val bugreportProgress = AtomicReference("idle|0")
    private val virtualDisplay = AtomicReference<VirtualDisplay?>(null)
    private val agentRuntimeManager = AgentRuntimeManager(
        File("/data/local/tmp/maa-tauri-android"),
    )

    private val binder = this

    override fun startVirtualDisplay(width: Int, height: Int, dpi: Int, surface: Surface): Int {
        require(width > 0 && height > 0 && dpi > 0) { "invalid virtual display geometry" }
        val displayContext = context ?: return DISPLAY_NONE
        stopVirtualDisplay()

        // Several DisplayManager flags are hidden from the public SDK. Their numeric
        // values are stable, but post-API-33 bits must not be passed on older devices.
        var flags = (1 shl 0) or (1 shl 1) or (1 shl 3) or (1 shl 6) or (1 shl 8)
        if (Build.VERSION.SDK_INT >= 33) {
            flags = flags or (1 shl 10) or (1 shl 11) or (1 shl 12) or (1 shl 13)
            if (Build.VERSION.SDK_INT >= 34) {
                flags = flags or (1 shl 14) or (1 shl 15) or (1 shl 16)
            }
        }
        val display = displayContext
            .getSystemService(DisplayManager::class.java)
            ?.createVirtualDisplay(
                "TTFlowVirtualDisplay",
                width,
                height,
                dpi,
                surface,
                flags,
            ) ?: return DISPLAY_NONE
        virtualDisplay.set(display)
        return display.display.displayId
    }

    override fun stopVirtualDisplay() {
        virtualDisplay.getAndSet(null)?.release()
    }

    override fun captureFrame(displayId: Int): ParcelFileDescriptor {
        val frame = capture(displayId)
        val (readEnd, writeEnd) = ParcelFileDescriptor.createPipe()
        thread(name = "maa_tauri_android-frame-writer") {
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
        return performDispatch(
            displayId, method, x, y, contact, keyCode, text, packageName, forceStop,
        )
    }

    override fun dispatchInputDetailed(
        displayId: Int,
        method: Int,
        x: Int,
        y: Int,
        contact: Int,
        keyCode: Int,
        text: String?,
        packageName: String?,
        forceStop: Boolean,
    ): InputResult {
        val code = performDispatch(
            displayId, method, x, y, contact, keyCode, text, packageName, forceStop,
        )
        val message = InputResult.messageFor(code)
        if (code != RESULT_OK) {
            android.util.Log.w(
                "MaaTauriAndroidControl",
                "Input failed displayId=$displayId method=$method x=$x y=$y " +
                    "contact=$contact keyCode=$keyCode textLength=${text?.length ?: 0} " +
                    "result=$code message=$message",
            )
        }
        return InputResult(code, message)
    }

    override fun capturePng(displayId: Int): ParcelFileDescriptor = stream { output ->
        val command = mutableListOf("/system/bin/screencap", "-p")
        if (displayId != 0) command.addAll(listOf("-d", displayId.toString()))
        val process = ProcessBuilder(command).start()
        process.errorStream?.let { error -> thread(name = "maa_tauri_android-capture-error") { error.readBytes() } }
        process.inputStream.use { input -> input.copyTo(output) }
        val status = process.waitFor()
        if (status != 0) throw IllegalStateException("screencap failed: $status")
    }

    override fun deviceInfo(): ParcelFileDescriptor = stream { output ->
        runCommand(output, "getprop")
        output.write("\n--- identity ---\n".toByteArray())
        runCommand(output, "id")
    }

    override fun displayState(): ParcelFileDescriptor = stream { output ->
        runCommand(output, "dumpsys", "display")
    }

    override fun logcat(full: Boolean): ParcelFileDescriptor {
        require(full) { "only the complete logcat is supported" }
        return stream { output ->
            runCommand(output, "logcat", "-d", "-v", "threadtime")
        }
    }

    override fun bugreport(displayId: Int, destination: ParcelFileDescriptor) {
        cancelBugreport()
        bugreportProgress.set("running|0")
        executor.execute {
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(destination).use { output ->
                    val process = ProcessBuilder("/system/bin/bugreportz", "-p").start()
                    bugreportProcess.set(process)
                    var reportPath: String? = null
                    var failed = false
                    process.inputStream.bufferedReader().forEachLine { line ->
                        when {
                            line.startsWith("PROGRESS:") -> bugreportProgress.set(
                                "running|${line.removePrefix("PROGRESS:").trim()}",
                            )
                            line.startsWith("OK:") -> reportPath = line.removePrefix("OK:").trim()
                            line.startsWith("FAIL:") -> failed = true
                        }
                    }
                    val status = process.waitFor()
                    bugreportProcess.compareAndSet(process, null)
                    val resolvedReportPath = reportPath
                    if (!failed && status == 0 && !resolvedReportPath.isNullOrBlank() &&
                        File(resolvedReportPath).isFile
                    ) {
                        File(resolvedReportPath).inputStream().use { input -> input.copyTo(output) }
                        bugreportProgress.set("done|100")
                    } else {
                        val fallback = ProcessBuilder("/system/bin/dumpstate").start()
                        bugreportProcess.set(fallback)
                        bugreportProgress.set("fallback|0")
                        fallback.inputStream.use { input -> input.copyTo(output) }
                        val fallbackStatus = fallback.waitFor()
                        bugreportProcess.compareAndSet(fallback, null)
                        if (fallbackStatus != 0) {
                            throw IllegalStateException("bugreport failed: $fallbackStatus")
                        }
                        bugreportProgress.set("done|100")
                    }
                }
            } catch (error: Throwable) {
                bugreportProgress.set("failed|${error.message.orEmpty().take(200)}")
                throw error
            }
        }
    }

    override fun bugreportProgress(): String = bugreportProgress.get()

    override fun dumpsys(): ParcelFileDescriptor = stream { output ->
        runCommand(output, "dumpsys")
    }

    override fun cancelBugreport() {
        bugreportProgress.set("cancelled|0")
        bugreportProcess.getAndSet(null)?.destroy()
    }

    override fun prepareAgentRuntime(
        descriptorJson: String,
        runtimeIndex: Int,
        piArchive: ParcelFileDescriptor?,
        runtimeBundle: ParcelFileDescriptor?,
    ) {
        requireNotNull(piArchive) { "the Project Interface archive is missing" }
        requireNotNull(runtimeBundle) { "the agent runtime bundle is missing" }
        agentRuntimeManager.prepare(
            descriptorJson,
            runtimeIndex,
            piArchive,
            runtimeBundle,
        )
    }

    override fun startAgent(
        runtimeIndex: Int,
        port: Int,
        nativeLibraryDir: String?,
        executionId: String?,
        piEnvironment: String?,
    ): AgentLaunch {
        return agentRuntimeManager.start(
            runtimeIndex,
            port,
            requireNotNull(nativeLibraryDir) { "the native library directory is missing" },
            requireNotNull(executionId) { "the execution id is missing" },
            requireNotNull(piEnvironment) { "the Project Interface environment is missing" },
        )
    }

    override fun stopAgent(executionId: String?) {
        agentRuntimeManager.stop(requireNotNull(executionId) { "the execution id is missing" })
    }

    override fun stopAllAgents() {
        agentRuntimeManager.stopAll()
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

    private fun performDispatch(
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
        when (method) {
            METHOD_START_GAME -> {
                val target = packageName.orEmpty()
                if (target.isNotEmpty()) {
                    // Android reuses an existing task on the default display, so a
                    // launch-display option alone cannot move an already-running app.
                    val shouldForceStop = forceStop || displayId != 0
                    if (shouldForceStop) {
                        val stopped = shell("am", "force-stop", packageNameOf(target))
                        if (stopped != RESULT_OK) return RESULT_COMMAND_FAILED
                    }
                    return startGameOnDisplay(target, displayId)
                }
            }
            METHOD_STOP_GAME -> {
                val stopped = shell("am", "force-stop", packageName.orEmpty())
                if (stopped != RESULT_OK) return RESULT_COMMAND_FAILED
            }
            METHOD_INPUT_TEXT -> {
                if (!text.isNullOrEmpty()) {
                    return shell("input", "--display", displayId.toString(), "text", text)
                }
            }
            METHOD_TOUCH_DOWN -> return injectTouch(displayId, contact, x, y, MotionEvent.ACTION_DOWN)
            METHOD_TOUCH_MOVE -> return injectTouch(displayId, contact, x, y, MotionEvent.ACTION_MOVE)
            METHOD_TOUCH_UP -> return injectTouch(displayId, contact, x, y, MotionEvent.ACTION_UP)
            METHOD_KEY_DOWN -> return injectKey(displayId, keyCode, KeyEvent.ACTION_DOWN)
            METHOD_KEY_UP -> return injectKey(displayId, keyCode, KeyEvent.ACTION_UP)
            else -> return RESULT_UNSUPPORTED_METHOD
        }
        return RESULT_OK
    }

    private fun injectTouch(displayId: Int, contact: Int, x: Int, y: Int, action: Int): Int {
        if (contact < 0) return RESULT_INVALID_CONTACT
        synchronized(contacts) {
            val now = SystemClock.uptimeMillis()
            if (action == MotionEvent.ACTION_DOWN) {
                contacts.clear()
                contacts[contact] = TouchPointer(now, x, y)
            } else if (action == MotionEvent.ACTION_MOVE) {
                val pointer = contacts[contact] ?: return RESULT_UNKNOWN_CONTACT
                pointer.x = x
                pointer.y = y
            } else if (action == MotionEvent.ACTION_UP) {
                val pointer = contacts[contact] ?: return RESULT_UNKNOWN_CONTACT
                pointer.x = x
                pointer.y = y
            }
            if (contacts.isEmpty()) return RESULT_NO_ACTIVE_CONTACT

            val properties = contacts.keys.map { key ->
                MotionEvent.PointerProperties().apply {
                    id = key
                    toolType = MotionEvent.TOOL_TYPE_FINGER
                }
            }.toTypedArray()
            val coordinates = contacts.values.map { pointer ->
                MotionEvent.PointerCoords().apply {
                    clear()
                    this.x = pointer.x.toFloat()
                    this.y = pointer.y.toFloat()
                    pressure = 1.0f
                    size = 1.0f
                }
            }.toTypedArray()
            val first = contacts.values.first()
            val eventAction = when {
                action == MotionEvent.ACTION_DOWN -> MotionEvent.ACTION_DOWN
                action == MotionEvent.ACTION_MOVE -> MotionEvent.ACTION_MOVE
                action == MotionEvent.ACTION_UP && contacts.size == 1 -> MotionEvent.ACTION_UP
                action == MotionEvent.ACTION_UP -> MotionEvent.ACTION_POINTER_UP or
                    (contacts.keys.indexOf(contact) shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
                contacts.size == 1 -> MotionEvent.ACTION_DOWN
                else -> MotionEvent.ACTION_POINTER_DOWN or
                    (contacts.keys.indexOf(contact) shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            }
            val event = MotionEvent.obtain(
                first.downTime,
                now,
                eventAction,
                properties.size,
                properties,
                coordinates,
                0,
                0,
                1.0f,
                1.0f,
                0,
                0,
                InputDevice.SOURCE_TOUCHSCREEN,
                0,
            )
            val displayAssigned = setDisplayId(event, displayId)
            val injected = displayAssigned && injectEvent(event)
            event.recycle()
            if (!displayAssigned) return RESULT_INJECTION_FAILED
            if (action == MotionEvent.ACTION_UP) contacts.remove(contact)
            return if (injected) RESULT_OK else RESULT_INJECTION_FAILED
        }
    }

    private fun injectKey(displayId: Int, keyCode: Int, action: Int): Int {
        val now = SystemClock.uptimeMillis()
        val event = KeyEvent(now, now, action, keyCode, 0)
        if (!setDisplayId(event, displayId)) return RESULT_INJECTION_FAILED
        return if (injectEvent(event)) RESULT_OK else RESULT_INJECTION_FAILED
    }

    private fun injectEvent(event: android.view.InputEvent): Boolean {
        val manager = android.hardware.input.InputManager::class.java
            .getMethod("getInstance")
            .invoke(null)
        val method = manager.javaClass.methods.firstOrNull { method ->
            method.name == "injectInputEvent" &&
                method.parameterTypes.contentEquals(arrayOf(android.view.InputEvent::class.java, Int::class.javaPrimitiveType))
        }
        if (method == null) {
            android.util.Log.w("MaaTauriAndroidControl", "InputManager.injectInputEvent is unavailable")
            return false
        }
        return try {
            method.invoke(manager, event, 0) as? Boolean == true
        } catch (error: Throwable) {
            android.util.Log.w(
                "MaaTauriAndroidControl",
                "InputManager.injectInputEvent rejected ${event.javaClass.simpleName}",
                error,
            )
            false
        }
    }

    private fun setDisplayId(event: android.view.InputEvent, displayId: Int): Boolean {
        return try {
            event.javaClass
                .getMethod("setDisplayId", Int::class.javaPrimitiveType)
                .invoke(event, displayId)
            true
        } catch (error: Throwable) {
            android.util.Log.w(
                "MaaTauriAndroidControl",
                "Could not associate ${event.javaClass.simpleName} with displayId=$displayId",
                error,
            )
            false
        }
    }

    private fun shell(vararg args: String): Int {
        return ProcessBuilder(*args).start().waitFor()
    }

    private fun startGameOnDisplay(spec: String, displayId: Int): Int {
        return startGameWithAm(spec, displayId)
    }

    private fun startGameWithAm(spec: String, displayId: Int): Int {
        val component = componentOf(spec)
        val intent = component?.let {
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setComponent(it)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        } ?: context?.packageManager?.getLaunchIntentForPackage(spec)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: context?.packageManager?.getLeanbackLaunchIntentForPackage(spec)
                ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        val command = if (intent != null) {
            arrayOf(
                "am",
                "start",
                "--display",
                displayId.toString(),
                intent.toUri(Intent.URI_INTENT_SCHEME),
            )
        } else {
            return if (displayId == 0) {
                shell(
                    "monkey",
                    "-p",
                    spec,
                    "-c",
                    "android.intent.category.LAUNCHER",
                    "1",
                )
            } else {
                RESULT_COMMAND_FAILED
            }
        }
        val status = shell(*command)
        android.util.Log.i(
            "MaaTauriAndroidControl",
            "am start ${packageNameOf(spec)} displayId=$displayId status=$status",
        )
        return if (status == RESULT_OK) RESULT_OK else RESULT_COMMAND_FAILED
    }

    private fun componentOf(spec: String): ComponentName? {
        if (!spec.contains('/')) return null
        return ComponentName.unflattenFromString(spec)
    }

    private fun packageNameOf(spec: String): String {
        return componentOf(spec)?.packageName ?: spec
    }

    private fun runCommand(output: OutputStream, vararg args: String) {
        val process = ProcessBuilder(*args).start()
        process.inputStream.use { input -> input.copyTo(output) }
        val status = process.waitFor()
        if (status != 0) throw IllegalStateException("${args.first()} failed: $status")
    }

    private fun stream(writer: (OutputStream) -> Unit): ParcelFileDescriptor {
        val (readEnd, writeEnd) = ParcelFileDescriptor.createPipe()
        thread(name = "maa_tauri_android-diagnostic-writer") {
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(writeEnd).use(writer)
            } catch (error: Throwable) {
                android.util.Log.w("MaaTauriAndroidControl", "Diagnostic stream failed", error)
            }
        }
        return readEnd
    }

    companion object {
        const val PROTOCOL_VERSION = 5
        const val METHOD_START_GAME = 1
        const val METHOD_STOP_GAME = 2
        const val METHOD_INPUT_TEXT = 4
        const val METHOD_TOUCH_DOWN = 6
        const val METHOD_TOUCH_MOVE = 7
        const val METHOD_TOUCH_UP = 8
        const val METHOD_KEY_DOWN = 9
        const val METHOD_KEY_UP = 10

        const val RESULT_OK = 0
        const val RESULT_INVALID_CONTACT = -1
        const val RESULT_UNKNOWN_CONTACT = -2
        const val RESULT_NO_ACTIVE_CONTACT = -3
        const val RESULT_INJECTION_FAILED = -4
        const val RESULT_UNSUPPORTED_METHOD = -5
        const val RESULT_COMMAND_FAILED = -6
        private const val DISPLAY_NONE = -1
    }

    private class TouchPointer(
        val downTime: Long,
        var x: Int,
        var y: Int,
    )
}

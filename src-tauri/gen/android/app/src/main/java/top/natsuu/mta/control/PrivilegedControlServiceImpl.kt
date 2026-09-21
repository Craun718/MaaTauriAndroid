package top.natsuu.mta.control

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Surface
import top.natsuu.mta.AgentLaunch
import top.natsuu.mta.InputResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStream
import kotlin.concurrent.thread
import kotlin.system.exitProcess
import top.natsuu.mta.IMaaTauriAndroidControlService

class PrivilegedControlServiceImpl(private val context: Context?) : IMaaTauriAndroidControlService.Stub() {
    private val executor = Executors.newSingleThreadExecutor()
    private val contacts = LinkedHashMap<Int, TouchPointerSequence.Pointer>()
    private var gestureDownTime = 0L
    private val bugreportProcess = AtomicReference<Process?>(null)
    private val bugreportProgress = AtomicReference("idle|0")
    private val virtualDisplay = AtomicReference<VirtualDisplay?>(null)
    private val touchMarkersEnabled = AtomicBoolean(false)
    private val touchMarkerId = AtomicLong(0)
    private val touchMarkers = ArrayDeque<IntArray>()
    private val agentRuntimeManager = AgentRuntimeManager(
        File("/data/local/tmp/maa-tauri-android"),
    )
    private val targetPackageStore = TargetPackageStore(
        File("/data/local/tmp/maa-tauri-android/target_packages"),
    ) { message ->
        android.util.Log.w("MaaTauriAndroidControl", message)
    }
    private val targetPackages = TargetPackages(targetPackageStore)

    /**
     * Death watchdog state. The app hands us a process-lifetime binder token via
     * [registerOwner]; when that token dies the app process is gone for good
     * (hard kill, crash, force-stop) and nobody will run the graceful cleanup,
     * so we force-stop the target packages and release the virtual display here.
     */
    private val ownerWatch = AtomicReference<OwnerWatch?>(null)
    private val deathCleanupStarted = AtomicBoolean(false)
    private val deathCleanupLock = Any()

    private val binder = this

    override fun startVirtualDisplay(width: Int, height: Int, dpi: Int, surface: Surface): Int {
        require(width > 0 && height > 0 && dpi > 0) { "invalid virtual display geometry" }
        val baseContext = context ?: return DISPLAY_NONE
        val displayContext = ShellIdentityContext(baseContext)
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
            .let(ShellIdentityContext::createDisplayManager)
            ?.createVirtualDisplay(
                "TTFlowVirtualDisplay",
                width,
                height,
                dpi,
                surface,
                flags,
            ) ?: return DISPLAY_NONE
        virtualDisplay.set(display)
        stabilizeDisplay(display.display.displayId, width, height)
        return display.display.displayId
    }

    private val appLauncher = AppLauncher(context?.let(::ShellIdentityContext)) { arguments ->
        shell(*arguments)
    }

    init {
        // Runs once per service process, before the first client call: the
        // previous process may have died while games were still recorded as
        // running. A throwing constructor would break the Shizuku handshake,
        // so the reap is best-effort and never propagates.
        runCatching { reapOrphanTargetPackages() }.onFailure { error ->
            android.util.Log.w(
                "MaaTauriAndroidControl",
                "Could not reap orphaned target packages",
                error,
            )
        }
    }

    /**
     * Force-stops whatever the previous service process still had recorded as
     * running, so no game survives an app exit unattended. Failed stops stay
     * recorded for the owner-death watchdog or the next reap to retry.
     */
    private fun reapOrphanTargetPackages() {
        val orphans = targetPackageStore.read()
        if (orphans.isEmpty()) return
        android.util.Log.w(
            "MaaTauriAndroidControl",
            "Force-stopping packages left running by the previous service process: $orphans",
        )
        orphans.forEach(targetPackages::add)
        stopTargetPackages()
    }

    override fun stopVirtualDisplay() {
        stopTargetPackages()
        virtualDisplay.getAndSet(null)?.release()
        synchronized(touchMarkers) {
            touchMarkers.clear()
        }
        synchronized(contacts) {
            contacts.clear()
            gestureDownTime = 0L
        }
    }

    private fun stopTargetPackages() {
        // Peek instead of drain: a failed stop keeps its record so the
        // owner-death watchdog or the next service process can retry it.
        targetPackages.peek().forEach { packageName ->
            val stopped = runCatching { appLauncher.stopPackage(packageName) }
                .getOrDefault(RESULT_COMMAND_FAILED)
            if (stopped == RESULT_OK) {
                targetPackages.remove(packageName)
            } else {
                android.util.Log.w(
                    "MaaTauriAndroidControl",
                    "Could not force-stop the target app; it stays recorded for a retry: $packageName",
                )
            }
        }
    }

    override fun registerOwner(owner: IBinder?) {
        if (owner == null) return
        synchronized(deathCleanupLock) {
            ownerWatch.getAndSet(null)?.let { watch ->
                // The previous token is usually already dead (its process died);
                // unlinkToDeath throws in that case and it is safe to ignore.
                runCatching { watch.token.unlinkToDeath(watch.recipient, 0) }
            }
            val recipient = IBinder.DeathRecipient {
                // Skip stale notifications: a reconnect registers a fresh token,
                // so only the currently registered owner may trigger the cleanup.
                if (ownerWatch.get()?.token !== owner) return@DeathRecipient
                handleOwnerDeath()
            }
            runCatching { owner.linkToDeath(recipient, 0) }.onFailure { error ->
                android.util.Log.w(
                    "MaaTauriAndroidControl",
                    "Could not watch the owner binder for death",
                    error,
                )
            }
            ownerWatch.set(OwnerWatch(owner, recipient))
        }
    }

    private fun handleOwnerDeath() {
        android.util.Log.w(
            "MaaTauriAndroidControl",
            "Owner process died; force-stopping target packages and releasing the virtual display",
        )
        runDeathCleanup()
        stopServiceProcess()
    }

    /**
     * Shizuku invokes this reserved transaction (see the AIDL comment) when it
     * unbinds the user service, including after the app process died. The
     * service has nothing left to do once its owner is gone, so it cleans up
     * and exits instead of leaking a shell-uid process.
     */
    override fun destroy() {
        android.util.Log.w(
            "MaaTauriAndroidControl",
            "Shizuku released the service; running the exit cleanup and stopping the process",
        )
        runDeathCleanup()
        stopServiceProcess()
    }

    private fun stopServiceProcess() {
        android.os.Process.killProcess(android.os.Process.myPid())
        exitProcess(0)
    }

    /**
     * Single exit-cleanup entry shared by every teardown path (owner death,
     * Shizuku destroy()). Latched so the binder thread racing destroy() or
     * unbind cannot run the cleanup twice.
     */
    private fun runDeathCleanup() {
        if (!deathCleanupStarted.compareAndSet(false, true)) return
        synchronized(deathCleanupLock) {
            try {
                stopVirtualDisplay()
                stopAllAgents()
            } catch (error: Throwable) {
                android.util.Log.w("MaaTauriAndroidControl", "Exit cleanup failed", error)
            }
        }
    }

    override fun setTouchMarkersEnabled(enabled: Boolean): IntArray {
        val changed = touchMarkersEnabled.getAndSet(enabled) != enabled
        synchronized(touchMarkers) {
            if (!enabled || changed) touchMarkers.clear()
            return drainTouchMarkersLocked()
        }
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
                        val stopped = appLauncher.stopPackage(target)
                        if (stopped != RESULT_OK) return RESULT_COMMAND_FAILED
                    }
                    val result = startGameOnDisplay(target, displayId)
                    val activeDisplayId = virtualDisplay.get()?.display?.displayId
                    if (result == RESULT_OK && displayId != 0 && displayId == activeDisplayId) {
                        targetPackages.add(appLauncher.packageNameOf(target))
                    }
                    return result
                }
            }
            METHOD_STOP_GAME -> {
                val target = packageName.orEmpty()
                val stopped = appLauncher.stopPackage(target)
                if (stopped != RESULT_OK) return RESULT_COMMAND_FAILED
                targetPackages.remove(appLauncher.packageNameOf(target))
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
            val current = contacts.values.toList()
            val kind = when (action) {
                MotionEvent.ACTION_DOWN -> TouchPointerSequence.Kind.Down
                MotionEvent.ACTION_MOVE -> TouchPointerSequence.Kind.Move
                MotionEvent.ACTION_UP -> TouchPointerSequence.Kind.Up
                else -> return RESULT_UNSUPPORTED_METHOD
            }
            val step = TouchPointerSequence.plan(kind, current, contact, x, y)
            if (!step.ok) {
                return if (contacts.isEmpty()) RESULT_NO_ACTIVE_CONTACT else RESULT_UNKNOWN_CONTACT
            }

            if (step.cancelFirst) {
                if (current.isNotEmpty()) {
                    val cancelEvent = obtainEvent(
                        displayId,
                        now,
                        MotionEvent.ACTION_CANCEL,
                        current,
                        changingContact = -1,
                    )
                    val cancelled = cancelEvent != null && injectEvent(cancelEvent, false)
                    cancelEvent?.recycle()
                    if (!cancelled) return RESULT_INJECTION_FAILED
                    contacts.clear()
                }
                gestureDownTime = 0L
            }

            val event = obtainEvent(
                displayId,
                now,
                step.action,
                step.pointers,
                step.changingContact,
            ) ?: return RESULT_INJECTION_FAILED
            val waitForFinish = step.action == MotionEvent.ACTION_DOWN ||
                step.action == MotionEvent.ACTION_POINTER_DOWN
            val injected = injectEvent(event, waitForFinish)
            event.recycle()
            if (!injected) return RESULT_INJECTION_FAILED

            contacts.clear()
            step.pointers.forEach { contacts[it.contact] = it }
            if (step.removeContact) {
                contacts.remove(contact)
                if (contacts.isEmpty()) gestureDownTime = 0L
            }
            recordTouchMarker(x, y, step.action, contact)
            return RESULT_OK
        }
    }

    private fun recordTouchMarker(x: Int, y: Int, action: Int, contact: Int) {
        if (!touchMarkersEnabled.get()) return
        synchronized(touchMarkers) {
            if (touchMarkers.size == TOUCH_MARKER_LIMIT) touchMarkers.removeFirst()
            touchMarkers.addLast(
                intArrayOf(
                    touchMarkerId.incrementAndGet().toInt(),
                    x,
                    y,
                    action,
                    contact,
                ),
            )
        }
    }

    private fun drainTouchMarkersLocked(): IntArray {
        val result = IntArray(touchMarkers.size * TOUCH_MARKER_FIELDS)
        var index = 0
        while (touchMarkers.isNotEmpty()) {
            val marker = touchMarkers.removeFirst()
            marker.copyInto(result, index)
            index += TOUCH_MARKER_FIELDS
        }
        return result
    }

    private fun obtainEvent(
        displayId: Int,
        eventTime: Long,
        action: Int,
        pointers: List<TouchPointerSequence.Pointer>,
        changingContact: Int,
    ): MotionEvent? {
        if (pointers.isEmpty()) return null
        if (gestureDownTime == 0L) gestureDownTime = eventTime
        val actionMasked = action and MotionEvent.ACTION_MASK
        val index = pointers.indexOfFirst { it.contact == changingContact }
        val encodedAction = when {
            actionMasked == MotionEvent.ACTION_POINTER_DOWN || actionMasked == MotionEvent.ACTION_POINTER_UP -> {
                if (index < 0) return null
                actionMasked or (index shl MotionEvent.ACTION_POINTER_INDEX_SHIFT)
            }

            else -> action
        }
        val properties = pointers.map { pointer ->
            MotionEvent.PointerProperties().apply {
                id = pointer.contact
                toolType = MotionEvent.TOOL_TYPE_FINGER
            }
        }.toTypedArray()
        val coordinates = pointers.map { pointer ->
            MotionEvent.PointerCoords().apply {
                clear()
                this.x = pointer.x.toFloat()
                this.y = pointer.y.toFloat()
                pressure = if (actionMasked == MotionEvent.ACTION_CANCEL ||
                    (
                        pointer.contact == changingContact &&
                            (actionMasked == MotionEvent.ACTION_POINTER_UP || actionMasked == MotionEvent.ACTION_UP)
                        )
                ) {
                    0.0f
                } else {
                    1.0f
                }
                size = 1.0f
            }
        }.toTypedArray()
        val event = MotionEvent.obtain(
            gestureDownTime,
            eventTime,
            encodedAction,
            pointers.size,
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
        return if (setDisplayId(event, displayId)) event else {
            event.recycle()
            null
        }
    }

    private fun injectKey(displayId: Int, keyCode: Int, action: Int): Int {
        val now = SystemClock.uptimeMillis()
        val event = KeyEvent(now, now, action, keyCode, 0)
        if (!setDisplayId(event, displayId)) return RESULT_INJECTION_FAILED
        return if (injectEvent(event, action == KeyEvent.ACTION_DOWN)) {
            RESULT_OK
        } else {
            RESULT_INJECTION_FAILED
        }
    }

    private fun injectEvent(event: android.view.InputEvent, waitForFinish: Boolean): Boolean {
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
            method.invoke(manager, event, if (waitForFinish) 2 else 0) as? Boolean == true
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

    private fun stabilizeDisplay(displayId: Int, width: Int, height: Int) {
        val windowManager = windowManager() ?: return
        val physicalRotation = physicalRotation(windowManager)
        val displayRotation = displayRotation(windowManager, displayId)
        if (displayRotation == 0) return

        val methods = windowManager.javaClass.methods
        methods.firstOrNull { method ->
            val parameters: Array<Class<*>>? = when (method.name) {
                "freezeDisplayRotation" -> when (method.parameterTypes.size) {
                    2 -> arrayOf(java.lang.Integer.TYPE, java.lang.Integer.TYPE)
                    3 -> arrayOf(
                        java.lang.Integer.TYPE,
                        java.lang.Integer.TYPE,
                        String::class.java,
                    )

                    else -> null
                }

                "freezeRotation" -> arrayOf(java.lang.Integer.TYPE)
                else -> null
            }
            parameters?.contentEquals(method.parameterTypes) == true
        }?.let { method ->
            runCatching {
                if (method.parameterTypes.size == 2) {
                    method.invoke(windowManager, displayId, 0)
                } else if (method.parameterTypes.size == 3) {
                    method.invoke(windowManager, displayId, 0, "TTFlow")
                } else {
                    method.invoke(windowManager, displayId)
                }
            }
        }

        if (physicalRotation == 0 &&
            displayRotation(windowManager, displayId) != 0
        ) {
            methods.firstOrNull { method ->
                method.name == "setForcedDisplaySize" &&
                    method.parameterTypes.contentEquals(
                        arrayOf(
                            java.lang.Integer.TYPE,
                            java.lang.Integer.TYPE,
                            java.lang.Integer.TYPE,
                        ),
                    )
            }?.let { method ->
                runCatching { method.invoke(windowManager, displayId, width, height) }
            }
        }
    }

    private fun windowManager(): Any? {
        val binder = runCatching {
            Class.forName("android.os.ServiceManager")
                .getDeclaredMethod("getService", String::class.java)
                .invoke(null, "window")
        }.getOrNull() ?: return null
        return runCatching {
            val stub = Class.forName("android.view.IWindowManager\$Stub")
            stub.getMethod("asInterface", android.os.IBinder::class.java).invoke(null, binder)
        }.getOrNull()
    }

    private fun physicalRotation(windowManager: Any): Int {
        return runCatching {
            val method = windowManager.javaClass.methods.firstOrNull { method ->
                method.name == "getDefaultDisplayRotation" ||
                    method.name == "getRotation"
            } ?: return 0
            method.invoke(windowManager) as? Int ?: 0
        }.getOrDefault(0)
    }

    private fun displayRotation(windowManager: Any, displayId: Int): Int {
        val display = runCatching {
            context?.let(ShellIdentityContext::createDisplayManager)
                ?.getDisplay(displayId)
        }.getOrNull() ?: return 0
        return display.rotation
    }

    private fun startGameOnDisplay(spec: String, displayId: Int): Int {
        return appLauncher.startGameOnDisplay(spec, displayId)
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

    private class OwnerWatch(
        val token: IBinder,
        val recipient: IBinder.DeathRecipient,
    )

    companion object {
        const val PROTOCOL_VERSION = 6
        private const val TOUCH_MARKER_FIELDS = 5
        private const val TOUCH_MARKER_LIMIT = 256
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
}

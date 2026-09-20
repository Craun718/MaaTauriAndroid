package top.natsuu.mta.control

import android.app.ActivityManager
import android.app.ActivityOptions
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.os.SystemClock

/**
 * Launches apps the way MaaFwApp does: use framework APIs to pin the task to a
 * display, verify the result, and retain the shell command as a compatibility
 * fallback for OEMs that restrict hidden framework APIs.
 */
internal class AppLauncher(
    private val context: Context?,
    private val shell: (Array<out String>) -> Int,
) {
    fun stopPackage(spec: String): Int {
        val packageName = packageNameOf(spec)
        return if (hiddenForceStop(packageName) || shell(arrayOf("am", "force-stop", packageName)) == 0) {
            PrivilegedControlServiceImpl.RESULT_OK
        } else {
            PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        }
    }

    fun startGameOnDisplay(spec: String, displayId: Int): Int {
        val intent = launchIntent(spec) ?: return startWithoutIntent(spec, displayId)
        val packageName = packageNameOf(spec)

        val directResult = startActivityAsUser(intent, displayOptions(displayId))
        var usedShellFallback = false
        if (directResult == null || directResult < START_SUCCESS) {
            usedShellFallback = true
            if (startWithAm(intent, displayId) != PrivilegedControlServiceImpl.RESULT_OK) {
                return PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
            }
        }

        return when (awaitAppOnDisplay(packageName, displayId, intent)) {
            LaunchLocation.TARGET_DISPLAY -> PrivilegedControlServiceImpl.RESULT_OK
            LaunchLocation.MISSING -> if (usedShellFallback) {
                PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
            } else {
                fallbackStart(packageName, intent, displayId)
            }
            LaunchLocation.WRONG_DISPLAY -> if (usedShellFallback) {
                PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
            } else {
                fallbackStart(packageName, intent, displayId)
            }
        }
    }

    private fun startWithoutIntent(spec: String, displayId: Int): Int {
        if (displayId != 0) return PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        val status = shell(
            arrayOf(
                "monkey",
                "-p",
                spec,
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ),
        )
        return if (status == PrivilegedControlServiceImpl.RESULT_OK) {
            PrivilegedControlServiceImpl.RESULT_OK
        } else {
            PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        }
    }

    private fun fallbackStart(
        packageName: String,
        intent: Intent,
        displayId: Int,
    ): Int {
        android.util.Log.i(
            TAG,
            "Framework launch did not pin $packageName to displayId=$displayId; using am start",
        )
        if (startWithAm(intent, displayId) != PrivilegedControlServiceImpl.RESULT_OK) {
            return PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        }
        return if (waitForAppOnDisplay(packageName, displayId, FALLBACK_WAIT_MS) ==
            LaunchLocation.TARGET_DISPLAY
        ) {
            PrivilegedControlServiceImpl.RESULT_OK
        } else {
            PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        }
    }

    private fun launchIntent(spec: String): Intent? {
        val component = componentOf(spec)
        val baseIntent = component?.let {
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(it)
        } ?: context?.packageManager?.getLaunchIntentForPackage(spec)
            ?: context?.packageManager?.getLeanbackLaunchIntentForPackage(spec)
        return baseIntent?.addFlags(NEW_TASK_FLAGS)
    }

    private fun startWithAm(intent: Intent, displayId: Int): Int {
        val command = arrayOf(
            "am",
            "start",
            "--display",
            displayId.toString(),
            intent.toUri(Intent.URI_INTENT_SCHEME),
        )
        val status = shell(command)
        android.util.Log.i(TAG, "am start --display=$displayId status=$status")
        return if (status == PrivilegedControlServiceImpl.RESULT_OK) {
            PrivilegedControlServiceImpl.RESULT_OK
        } else {
            PrivilegedControlServiceImpl.RESULT_COMMAND_FAILED
        }
    }

    private fun awaitAppOnDisplay(
        packageName: String,
        displayId: Int,
        intent: Intent?,
    ): LaunchLocation {
        var wrongDisplay: Int? = null
        var attemptedMove = false
        var attemptedFullscreenRelaunch = false
        val deadline = SystemClock.uptimeMillis() + DISPLAY_WAIT_MS
        while (SystemClock.uptimeMillis() < deadline) {
            val task = findTask(packageName)
            if (task == null) {
                SystemClock.sleep(POLL_INTERVAL_MS)
                continue
            }
            if (task.displayId == displayId) {
                if (task.windowingMode != WINDOWING_MODE_FULLSCREEN && !attemptedFullscreenRelaunch) {
                    attemptedFullscreenRelaunch = true
                    android.util.Log.i(
                        TAG,
                        "$packageName is windowingMode=${task.windowingMode}; relaunching fullscreen on $displayId",
                    )
                    relaunchFullscreen(intent, displayId)
                    SystemClock.sleep(POLL_INTERVAL_MS)
                    continue
                }
                return LaunchLocation.TARGET_DISPLAY
            }

            if (wrongDisplay != task.displayId) {
                wrongDisplay = task.displayId
                android.util.Log.i(
                    TAG,
                    "$packageName landed on displayId=${task.displayId}; moving to $displayId",
                )
                attemptedMove = true
                if (!moveTaskToDisplay(task.taskId, displayId) && !attemptedFullscreenRelaunch) {
                    attemptedFullscreenRelaunch = true
                    relaunchFullscreen(intent, displayId)
                }
            }
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        val finalTask = findTask(packageName)
        return if (finalTask != null && finalTask.displayId == displayId) {
            if (finalTask.windowingMode == null || finalTask.windowingMode == WINDOWING_MODE_FULLSCREEN) {
                LaunchLocation.TARGET_DISPLAY
            } else {
                LaunchLocation.WRONG_DISPLAY
            }
        } else {
            val location = LaunchLocation.WRONG_DISPLAY
            if (!attemptedFullscreenRelaunch) {
                attemptedFullscreenRelaunch = true
                relaunchFullscreen(intent, displayId)
                if (waitForAppOnDisplay(packageName, displayId, FALLBACK_WAIT_MS) ==
                    LaunchLocation.TARGET_DISPLAY
                ) {
                    return LaunchLocation.TARGET_DISPLAY
                }
            }
            location
        }
    }

    private fun waitForAppOnDisplay(
        packageName: String,
        displayId: Int,
        timeoutMs: Long,
    ): LaunchLocation {
        val deadline = SystemClock.uptimeMillis() + timeoutMs
        while (SystemClock.uptimeMillis() < deadline) {
            if (findTask(packageName)?.displayId == displayId) return LaunchLocation.TARGET_DISPLAY
            SystemClock.sleep(POLL_INTERVAL_MS)
        }
        return if (findTask(packageName)?.displayId == displayId) {
            LaunchLocation.TARGET_DISPLAY
        } else {
            LaunchLocation.MISSING
        }
    }

    private fun findTask(packageName: String): TaskLocation? {
        val tasks = runCatching {
            activityManager()?.getRunningTasks(TASK_SCAN_LIMIT).orEmpty()
        }.onFailure { error ->
            android.util.Log.w(TAG, "Could not inspect running tasks", error)
        }.getOrDefault(emptyList())

        return tasks.asSequence()
            .filter { task -> taskMatches(task, packageName) }
            .mapNotNull { task ->
                val displayId = displayIdOf(task) ?: return@mapNotNull null
                TaskLocation(task.taskId, displayId, windowingModeOf(task))
            }
            .firstOrNull()
    }

    private fun taskMatches(task: ActivityManager.RunningTaskInfo, packageName: String): Boolean {
        val basePackage = task.baseIntent?.component?.packageName
        if (basePackage == packageName) return true
        val topActivity = componentField(task, "topActivity") ?: return false
        return topActivity.packageName == packageName
    }

    private fun componentField(task: ActivityManager.RunningTaskInfo, name: String): ComponentName? {
        return runCatching {
            ActivityManager.RunningTaskInfo::class.java.getField(name).get(task) as? ComponentName
        }.getOrNull()
    }

    private fun displayIdOf(task: ActivityManager.RunningTaskInfo): Int? {
        return runCatching {
            ActivityManager.RunningTaskInfo::class.java.getField("displayId").getInt(task)
        }.onFailure { error ->
            android.util.Log.w(TAG, "RunningTaskInfo.displayId is unavailable", error)
        }.getOrNull()
    }

    private fun windowingModeOf(task: ActivityManager.RunningTaskInfo): Int? {
        val fromMethod = runCatching {
            task.javaClass.getMethod("getWindowingMode").invoke(task) as? Int
        }.getOrNull()
        if (fromMethod != null) return fromMethod
        return runCatching {
            ActivityManager.RunningTaskInfo::class.java
                .getField("windowingMode")
                .getInt(task)
        }.onFailure { error ->
            android.util.Log.v(TAG, "RunningTaskInfo.windowingMode is unavailable", error)
        }.getOrNull()
    }

    private fun moveTaskToDisplay(taskId: Int, displayId: Int): Boolean {
        if (binderMoveTask(taskId, displayId)) return true
        if (staticMoveTask(taskId, displayId)) return true
        val status = shell(
            arrayOf(
                "am",
                "display",
                "move-stack",
                taskId.toString(),
                displayId.toString(),
            ),
        )
        return status == 0
    }

    private fun binderMoveTask(taskId: Int, displayId: Int): Boolean {
        return listOf("android.app.IActivityTaskManager", "android.app.IActivityManager").any { name ->
            val service = activityService(name, if (name == ACTIVITY_TASK_SERVICE_INTERFACE) {
                ACTIVITY_TASK_SERVICE_NAME
            } else {
                ACTIVITY_SERVICE_NAME
            }) ?: return@any false
            service.javaClass.methods.any { method ->
                when (method.name) {
                    "moveRootTaskToDisplay", "moveStackToDisplay" -> {
                        method.parameterTypes.contentEquals(
                            arrayOf(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType),
                        ) && runCatching {
                            method.invoke(service, taskId, displayId)
                        }.onFailure { error ->
                            android.util.Log.w(TAG, "Could not invoke ${method.name}", error)
                        }.isSuccess
                    }
                    else -> false
                }
            }
        }
    }

    private fun staticMoveTask(taskId: Int, displayId: Int): Boolean {
        return listOf("android.app.ActivityTaskManager", "android.app.ActivityManager").any { name ->
            runCatching {
                Class.forName(name).methods.any { method ->
                    method.name == "moveRootTaskToDisplay" &&
                        method.parameterTypes.contentEquals(
                            arrayOf(Int::class.javaPrimitiveType, Int::class.javaPrimitiveType),
                        ) &&
                        runCatching { method.invoke(null, taskId, displayId) }.isSuccess
                }
            }.getOrDefault(false)
        }
    }

    private fun relaunchFullscreen(intent: Intent?, displayId: Int) {
        if (intent == null) return
        val result = startActivityAsUser(intent, displayOptions(displayId))
        if (result == null || result < START_SUCCESS) {
            startWithAm(intent, displayId)
        }
    }

    private fun startActivityAsUser(intent: Intent, options: Bundle): Int? {
        val service = activityService(
            ACTIVITY_TASK_SERVICE_INTERFACE,
            ACTIVITY_TASK_SERVICE_NAME,
        ) ?: activityService(
            ACTIVITY_SERVICE_INTERFACE,
            ACTIVITY_SERVICE_NAME,
        )
            ?: return null
        val applicationThread = applicationThread() ?: return null

        val method = service.javaClass.methods.firstOrNull { candidate ->
            candidate.name == "startActivityAsUser" &&
                acceptsApplicationThread(candidate.parameterTypes.firstOrNull(), applicationThread)
        } ?: return null

        val arguments = startActivityArguments(method.parameterTypes, applicationThread, intent, options)
            ?: return null
        return runCatching {
            method.invoke(service, *arguments) as? Int
        }.onFailure { error ->
            android.util.Log.w(TAG, "IActivityTaskManager.startActivityAsUser failed", error)
        }.getOrNull()
    }

    private fun startActivityArguments(
        parameterTypes: Array<Class<*>>,
        applicationThread: Any,
        intent: Intent,
        options: Bundle,
    ): Array<Any?>? {
        if (parameterTypes.indexOf(Intent::class.java) < 0 ||
            parameterTypes.last() != Int::class.javaPrimitiveType
        ) {
            return null
        }
        val integers = parameterTypes.withIndex().filter { it.value == Int::class.javaPrimitiveType }
        if (integers.size < 3) return null

        var seenIntent = false
        var stringIndex = 0
        return parameterTypes.mapIndexed { index, type ->
            when {
                acceptsApplicationThread(type, applicationThread) -> applicationThread
                type == Intent::class.java -> {
                    seenIntent = true
                    intent
                }
                type == Bundle::class.java -> options
                type == IBinder::class.java -> null
                type == String::class.java -> {
                    val value = if (!seenIntent && stringIndex++ == 0) SHELL_PACKAGE else null
                    value
                }
                type == Int::class.javaPrimitiveType -> {
                    val value = when (index) {
                        integers[integers.size - 3].index -> -1
                        integers[integers.size - 2].index -> intent.flags
                        else -> USER_CURRENT
                    }
                    value
                }
                else -> null
            }
        }.toTypedArray()
    }

    private fun acceptsApplicationThread(type: Class<*>?, applicationThread: Any): Boolean {
        return type?.isAssignableFrom(applicationThread.javaClass) == true
    }

    private fun applicationThread(): Any? {
        return runCatching {
            val activityThread = Class.forName("android.app.ActivityThread")
                .getMethod("currentActivityThread")
                .invoke(null) ?: return null
            activityThread.javaClass.getMethod("getApplicationThread").invoke(activityThread)
        }.onFailure { error ->
            android.util.Log.w(TAG, "ActivityThread application thread is unavailable", error)
        }.getOrNull()
    }

    private fun activityService(interfaceName: String, serviceName: String): Any? {
        val binder = runCatching {
            Class.forName("android.os.ServiceManager")
                .getMethod("getService", String::class.java)
                .invoke(null, serviceName) as? IBinder
        }.getOrNull() ?: return null

        return runCatching {
            val stubClass = Class.forName("$interfaceName\$Stub")
            stubClass.getMethod("asInterface", IBinder::class.java)
                .invoke(null, binder)
        }.onFailure { error ->
            android.util.Log.w(TAG, "Could not acquire $interfaceName", error)
        }.getOrNull()
    }

    private fun hiddenForceStop(packageName: String): Boolean {
        val manager = activityManager() ?: return false
        ActivityManager::class.java.methods.any { method ->
            val parameters = method.parameterTypes
            val invoked = when (method.name) {
                "forceStopPackage" -> when {
                    parameters.contentEquals(
                        arrayOf(String::class.java, Int::class.javaPrimitiveType),
                    ) -> runCatching {
                        method.invoke(manager, packageName, USER_CURRENT)
                    }.isSuccess
                    parameters.contentEquals(arrayOf(String::class.java)) -> runCatching {
                        method.invoke(manager, packageName)
                    }.isSuccess
                    else -> false
                }
                "forceStopPackageAsUser" -> parameters.contentEquals(
                    arrayOf(String::class.java, Int::class.javaPrimitiveType),
                ) && runCatching {
                    method.invoke(manager, packageName, USER_CURRENT)
                }.isSuccess
                else -> false
            }
            if (invoked) return true
            false
        }
        return false
    }

    private fun displayOptions(displayId: Int): Bundle {
        val options = ActivityOptions.makeBasic()
        runCatching {
            ActivityOptions::class.java
                .getMethod("setLaunchDisplayId", Int::class.javaPrimitiveType)
                .invoke(options, displayId)
        }.onFailure { error ->
            android.util.Log.w(TAG, "ActivityOptions.setLaunchDisplayId is unavailable", error)
        }
        if (displayId != 0) {
            runCatching {
                ActivityOptions::class.java
                    .getMethod("setLaunchWindowingMode", Int::class.javaPrimitiveType)
                    .invoke(options, WINDOWING_MODE_FULLSCREEN)
            }.onFailure { error ->
                android.util.Log.w(
                    TAG,
                    "ActivityOptions.setLaunchWindowingMode is unavailable",
                    error,
                )
            }
        }
        return options.toBundle()
    }

    private fun activityManager(): ActivityManager? {
        val context = context ?: return null
        return runCatching {
            context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        }.getOrNull()
    }

    internal fun packageNameOf(spec: String): String {
        return componentOf(spec)?.packageName ?: spec
    }

    private fun componentOf(spec: String): ComponentName? {
        if (!spec.contains('/')) return null
        return ComponentName.unflattenFromString(spec)
    }

    private data class TaskLocation(
        val taskId: Int,
        val displayId: Int,
        val windowingMode: Int?,
    )

    private enum class LaunchLocation {
        TARGET_DISPLAY,
        WRONG_DISPLAY,
        MISSING,
    }

    companion object {
        private const val TAG = "MaaTauriAndroidControl"
        private const val SHELL_PACKAGE = "com.android.shell"
        private const val ACTIVITY_TASK_SERVICE_INTERFACE = "android.app.IActivityTaskManager"
        private const val ACTIVITY_SERVICE_INTERFACE = "android.app.IActivityManager"
        private const val ACTIVITY_TASK_SERVICE_NAME = "activity_task"
        private const val ACTIVITY_SERVICE_NAME = "activity"
        private const val START_SUCCESS = 0
        private const val USER_CURRENT = -2
        private const val TASK_SCAN_LIMIT = 100
        private const val DISPLAY_WAIT_MS = 10_000L
        private const val FALLBACK_WAIT_MS = 3_000L
        private const val POLL_INTERVAL_MS = 250L
        private const val WINDOWING_MODE_FULLSCREEN = 1
        private const val NEW_TASK_FLAGS =
            Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
    }
}

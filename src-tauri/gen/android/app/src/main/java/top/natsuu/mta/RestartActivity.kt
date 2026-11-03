package top.natsuu.mta

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Process

/**
 * Kills the main process from a short-lived separate process, then starts the
 * launcher task. If the main process starts its own launcher intent, that
 * process death can remove the activity before a new task is created; doing the
 * kill and relaunch from `:restart` avoids that race and does not need an
 * alarm grant.
 */
class RestartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mainPid = intent.getIntExtra(EXTRA_MAIN_PID, 0)
        if (mainPid > 0) Process.killProcess(mainPid)
        packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
            startActivity(
                intent.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK,
                ),
            )
        }
        finish()
        Runtime.getRuntime().exit(0)
    }

    companion object {
        const val EXTRA_MAIN_PID = "main_pid"
    }
}

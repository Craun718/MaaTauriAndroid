package top.natsuu.mta.control

import java.io.File

/**
 * Best-effort persistence of the force-stop targets. The privileged service
 * process keeps its [TargetPackages] in memory only, so when that process dies
 * unexpectedly (fdsan abort, OOM kill) the recorded games would be forgotten
 * and nobody would force-stop them after the app exits. The store keeps the
 * live set in a file under /data/local/tmp/maa-tauri-android (the service runs
 * as the shell uid, which owns that directory), and a freshly started service
 * process reaps whatever is still recorded there.
 *
 * Persistence failures are swallowed: a lost record only means an orphaned
 * game can survive a crash, never a crash of the service itself. The service
 * surfaces failures through [onError].
 */
internal class TargetPackageStore(
    private val file: File,
    private val onError: ((String) -> Unit)? = null,
) {
    fun read(): List<String> {
        return runCatching {
            if (!file.isFile) {
                emptyList()
            } else {
                file.readLines().map { it.trim() }.filter { it.isNotEmpty() }
            }
        }.onFailure { error ->
            onError?.invoke("Could not read ${file.path}: ${error.message}")
        }.getOrDefault(emptyList())
    }

    fun write(packages: List<String>) {
        runCatching {
            file.parentFile?.mkdirs()
            if (packages.isEmpty()) {
                file.delete()
            } else {
                file.writeText(packages.joinToString(separator = "\n"))
            }
        }.onFailure { error ->
            onError?.invoke("Could not write ${file.path}: ${error.message}")
        }
    }
}

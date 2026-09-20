package top.natsuu.mta.kotlin

import java.io.File
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Builds the Project Interface tree that gets packed into `assets/pi.zip`.
 *
 * The copy set comes from [PiPackage], so a profile no longer lists paths by hand, and a
 * path the protocol declares but the source project lacks fails the build instead of
 * producing an APK that cannot load its own interface.
 */
abstract class PiSyncTask : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val projectRoot: DirectoryProperty

    @get:OutputDirectory
    abstract val destination: DirectoryProperty

    @TaskAction
    fun sync() {
        val source = projectRoot.get().asFile
        val plan = PiPackage.plan(source)
        if (plan.missing.isNotEmpty()) {
            throw GradleException(
                buildString {
                    append("the Project Interface declares paths that do not exist:\n")
                    plan.missing.sorted().forEach { append("  - ").append(it).append('\n') }
                    append("source: ").append(source.invariantSeparatorsPath)
                },
            )
        }

        val target = destination.get().asFile
        target.deleteRecursively()
        target.mkdirs()
        for (entry in plan.entries) {
            copy(source.resolve(entry), target.resolve(entry))
        }
    }

    private fun copy(from: File, to: File) {
        if (from.isDirectory) {
            to.mkdirs()
            from.listFiles()?.forEach { child ->
                if (isDevelopmentArtifact(child.name)) return@forEach
                copy(child, to.resolve(child.name))
            }
        } else {
            to.parentFile?.mkdirs()
            from.copyTo(to, overwrite = true)
        }
    }

    /**
     * Development leftovers that must never reach the device. Upstream's release builder
     * filters the same set out of the Agent payload (`shouldCopyAgentPath`).
     */
    private fun isDevelopmentArtifact(name: String): Boolean {
        val lower = name.lowercase()
        return lower == "__pycache__" ||
            lower == ".git" ||
            lower == "node_modules" ||
            lower == ".venv" ||
            lower.endsWith(".pyc") ||
            lower.endsWith(".pyo")
    }
}

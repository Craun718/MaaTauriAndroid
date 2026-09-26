import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.plugins.ExtraPropertiesExtension
import org.gradle.api.DefaultTask
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.get

const val TASK_GROUP = "rust"

open class Config {
    lateinit var rootDirRel: String
}

open class RustPlugin : Plugin<Project> {
    private lateinit var config: Config

    override fun apply(project: Project) = with(project) {
        config = extensions.create("rust", Config::class.java)

        val abiTargets = mapOf(
            "arm64-v8a" to ("arm64" to "aarch64"),
            "x86_64" to ("x86_64" to "x86_64"),
        )
        val propertyValues: (String) -> List<String>? = { name ->
            (findProperty(name) as? String)?.split(',')
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
        }
        val singlePropertyValue: (String) -> String? = { name ->
            propertyValues(name)?.also { values ->
                require(values.size == 1) { "$name must contain exactly one Android ABI" }
            }?.single()
        }
        val targetToAbi = mapOf(
            "aarch64" to "arm64-v8a",
            "aarch64-linux-android" to "arm64-v8a",
            "x86_64" to "x86_64",
            "x86_64-linux-android" to "x86_64",
        )
        val archToAbi = mapOf("arm64" to "arm64-v8a", "x86_64" to "x86_64")
        val explicitAbi = singlePropertyValue("abiList")
        val explicitTarget = singlePropertyValue("targetList")
        val explicitArch = singlePropertyValue("archList")
        val selectedAbi = explicitAbi
            ?: explicitTarget?.let {
                targetToAbi[it] ?: error("unsupported Android target in targetList: $it")
            }
            ?: explicitArch?.let {
                archToAbi[it] ?: error("unsupported Android architecture in archList: $it")
            }
            ?: "arm64-v8a"
        require(selectedAbi in abiTargets) {
            "unsupported Android ABI: $selectedAbi"
        }
        val abiList = listOf(selectedAbi)
        rootProject.extensions
            .getByType(ExtraPropertiesExtension::class.java)
            .set("maaTauriAndroidAbi", selectedAbi)
        val archList = abiList.map { abiTargets[it]!!.first }
        val targetsList = abiList.map { abiTargets[it]!!.second }

        extensions.configure<ApplicationExtension> {
            @Suppress("UnstableApiUsage")
            flavorDimensions.add("abi")
            productFlavors {
                create("universal") {
                    dimension = "abi"
                    ndk {
                        abiFilters += abiList
                    }
                }
                abiList.forEach { abi ->
                    create(abiTargets[abi]!!.first) {
                        dimension = "abi"
                        ndk {
                            abiFilters.add(abi)
                        }
                    }
                }
            }
        }

        afterEvaluate {
            for (profile in listOf("debug", "release")) {
                val profileCapitalized = profile.replaceFirstChar { it.uppercase() }
                val buildTask = tasks.maybeCreate(
                    "rustBuildUniversal$profileCapitalized",
                    DefaultTask::class.java
                ).apply {
                    group = TASK_GROUP
                    description = "Build dynamic library in $profile mode for all targets"
                }

                tasks.findByName("mergeUniversal${profileCapitalized}JniLibFolders")?.dependsOn(buildTask)

                for (targetPair in targetsList.withIndex()) {
                    val targetName = targetPair.value
                    val targetArch = archList[targetPair.index]
                    val targetArchCapitalized = targetArch.replaceFirstChar { it.uppercase() }
                    val targetBuildTask = project.tasks.maybeCreate(
                        "rustBuild$targetArchCapitalized$profileCapitalized",
                        BuildTask::class.java
                    ).apply {
                        group = TASK_GROUP
                        description = "Build dynamic library in $profile mode for $targetArch"
                        rootDirRel = config.rootDirRel
                        target = targetName
                        release = profile == "release"
                    }

                    buildTask.dependsOn(targetBuildTask)
                    tasks["merge$targetArchCapitalized${profileCapitalized}JniLibFolders"].dependsOn(buildTask)
                }
            }
        }
    }
}

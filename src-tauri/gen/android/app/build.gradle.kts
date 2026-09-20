import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File
import java.util.zip.ZipFile
import java.util.Properties
import java.util.TreeMap
import org.gradle.api.tasks.PathSensitivity
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import com.android.build.api.dsl.ApplicationExtension

import top.natsuu.mta.kotlin.PiProfileReader
import top.natsuu.mta.kotlin.PiLauncherIcon
import top.natsuu.mta.kotlin.PiSyncTask

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val localProperties = Properties().apply {
    val propFile = rootProject.file("local.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val piProfilePath = providers.gradleProperty("pi.profile").orNull
    ?: localProperties.getProperty("pi.profile")?.trim()?.takeIf { it.isNotEmpty() }
    ?: System.getenv("PI_PROFILE")?.trim()?.takeIf { it.isNotEmpty() }
val piProfileFile = piProfilePath?.let { path ->
    val profile = rootProject.file(path)
    require(profile.isFile) { "pi.profile points at a missing file: ${profile.absolutePath}" }
    require(profile.extension.equals("toml", ignoreCase = true)) {
        "pi.profile must be a TOML file: ${profile.absolutePath}"
    }
    profile
}
val piProfile = piProfileFile?.let(PiProfileReader::read)

val piAssets = piProfile?.assets
val maaTauriAndroidResourceId = piProfile?.resourceId ?: "fixture"
val maaTauriAndroidAppName = piProfile?.appName ?: "MaaTauriAndroid"
val maaTauriAndroidMaaDir = piProfile?.maaDir ?: "vendor/maa/android"
val maaTauriAndroidMaaDirPath = if (File(maaTauriAndroidMaaDir).isAbsolute) {
    File(maaTauriAndroidMaaDir).normalize()
} else {
    rootProject.file("../../..")
        .resolve(maaTauriAndroidMaaDir)
        .normalize()
}

val piGeneratedDir = layout.buildDirectory.dir("generated/piAssets")
val piRootDir = piGeneratedDir.map { it.dir("pi") }
val piPackedDir = piGeneratedDir.map { it.dir("packed") }
val agentPackedDir = piPackedDir.map { it.dir("agent") }

fun interfaceAgentCount(file: File): Int {
    val parsed = JsonSlurper().parse(file)
    require(parsed is Map<*, *>) { "interface.json must contain an object" }
    return when (val agents = parsed["agent"]) {
        null -> 0
        is List<*> -> agents.size
        else -> 1
    }
}

fun canonicalValue(value: Any?): Any? = when (value) {
    is Map<*, *> -> linkedMapOf<String, Any?>().apply {
        value.entries
            .map { entry -> entry.key.toString() to canonicalValue(entry.value) }
            .sortedBy { entry -> entry.first }
            .forEach { entry -> put(entry.first, entry.second) }
    }
    is List<*> -> value.map(::canonicalValue)
    else -> value
}

fun canonicalJson(value: Any?): String = JsonOutput.toJson(canonicalValue(value))

fun validateAgentBundle(file: File, index: Int) {
    val requiredLibraries = setOf(
        "lib/arm64-v8a/libMaaAgentClient.so",
        "lib/arm64-v8a/libMaaAgentServer.so",
    )
    ZipFile(file).use { archive ->
        val entries = archive.entries().asSequence()
            .map { entry -> entry.name.removePrefix("./") }
            .toSet()
        requiredLibraries.forEach { path ->
            require(path in entries) {
                "agent runtime $index is missing $path: $file"
            }
        }
    }
}

val preparePiArchive = if (piProfile != null) {
    // The pack set is resolved from interface.json by PiSyncTask, so a directory rename
    // upstream cannot silently produce an APK whose interface points at missing files.
    // pi_include can only add to it; there is nothing that prunes it.
    val syncPiAssets = tasks.register<PiSyncTask>("syncPiAssets") {
        group = "build"
        description = "Resolve the Project Interface pack set from interface.json and sync it"
        projectRoot.set(
            file(
                requireNotNull(piAssets) {
                    "No Project Interface configured; set pi.profile in local.properties or pass -Ppi.profile"
                },
            ),
        )
        extraEntries.set(piProfile.extraEntries)
        destination.set(piRootDir)
        doLast {
            val interfaceFile = piRootDir.get().file("interface.json").asFile
            require(interfaceFile.isFile) {
                "The Project Interface profile did not produce interface.json"
            }
            val declaredAgents = interfaceAgentCount(interfaceFile)
            val configuredAgents = piProfile.agent?.runtimes?.size ?: 0
            require(declaredAgents == configuredAgents) {
                "interface.json declares $declaredAgents agents, but the TOML profile configures " +
                    "$configuredAgents runtime bundles"
            }
        }
    }

    tasks.register<Zip>("packPiArchive") {
        group = "build"
        description = "Pack the generated Project Interface tree into assets/pi.zip"
        dependsOn(syncPiAssets)
        from(piRootDir)
        destinationDirectory.set(piPackedDir)
        archiveFileName.set("pi.zip")
        includeEmptyDirs = false
    }
} else {
    tasks.register<Delete>("clearPiArchive") {
        group = "build"
        description = "Remove stale Project Interface assets when no profile is configured"
        delete(piPackedDir)
    }
}

val prepareAgentRuntime = if (piProfile?.agent != null) {
    tasks.register("prepareAgentRuntime") {
        group = "build"
        description = "Package trusted MaaFW Python agent runtimes and their descriptor"
        dependsOn(preparePiArchive)
        val agentProfile = requireNotNull(requireNotNull(piProfile).agent)
        val runtimes = agentProfile.runtimes
        inputs.property("abi", "arm64-v8a")
        inputs.property("timeoutMs", agentProfile.timeoutMs)
        runtimes.forEach { runtime -> inputs.file(runtime.bundle) }
        inputs.files(piRootDir)
        inputs.file(piPackedDir.map { it.file("pi.zip") })
        inputs.property("runtimeConfig", canonicalJson(runtimes.map { runtime ->
            linkedMapOf<String, Any?>(
                "args" to runtime.args,
                "env" to runtime.env,
                "exec" to runtime.exec,
                "executables" to runtime.executables,
                "workingDir" to runtime.workingDir,
            )
        }))
        outputs.dir(agentPackedDir)
        doLast {
            val packedRoot = piPackedDir.get().asFile
            val packedAgentRoot = packedRoot.resolve("agent").apply { mkdirs() }
            packedAgentRoot.listFiles()?.forEach { it.deleteRecursively() }
            val packedPiArchive = packedRoot.resolve("pi.zip")
            require(packedPiArchive.isFile) { "the packed Project Interface archive is missing" }

            val descriptorRuntimes = runtimes.mapIndexed { index, runtime ->
                validateAgentBundle(runtime.bundle, index)
                val target = packedAgentRoot.resolve("runtime-$index.zip")
                runtime.bundle.copyTo(target, overwrite = true)
                linkedMapOf<String, Any?>(
                    "args" to runtime.args,
                    "env" to TreeMap(runtime.env),
                    "exec" to runtime.exec,
                    "executables" to runtime.executables,
                    "interfaceIndex" to index,
                    "workingDir" to runtime.workingDir,
                )
            }
            val canonicalDescriptor = linkedMapOf<String, Any?>(
                "abi" to "arm64-v8a",
                "runtimes" to descriptorRuntimes,
                "schemaVersion" to 1,
                "timeoutMs" to agentProfile.timeoutMs,
            )
            packedAgentRoot.resolve("runtime.json")
                .writeText(JsonOutput.prettyPrint(JsonOutput.toJson(canonicalDescriptor)))
        }
    }
} else {
    tasks.register("clearAgentRuntime") {
        group = "build"
        description = "Remove stale agent assets when no Python runtime is configured"
        doLast {
            piPackedDir.get().asFile.resolve("agent").deleteRecursively()
        }
    }
}

val piLauncherIconResDir = layout.buildDirectory.dir("generated/piLauncherIcon")

val syncPiLauncherIcon = tasks.register("syncPiLauncherIcon") {
    group = "build"
    description = "Generate launcher icons from the Project Interface app icon"
    val outputDir = piLauncherIconResDir
    outputs.dir(outputDir)
    dependsOn(preparePiArchive)
    if (piProfile != null) {
        inputs.files(piRootDir)
        doLast {
            val resRoot = outputDir.get().asFile.apply {
                deleteRecursively()
                mkdirs()
            }
            val icon = PiLauncherIcon.resolve(piRootDir.get().file("interface.json").asFile)
            if (icon != null) {
                PiLauncherIcon.generate(icon, resRoot)
            }
        }
    } else {
        doLast {
            outputDir.get().asFile.deleteRecursively()
        }
    }
}

tasks.named("preBuild") {
    dependsOn(preparePiArchive, prepareAgentRuntime, syncPiLauncherIcon)
}

extensions.configure<ApplicationExtension> {
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    namespace = "top.natsuu.mta"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "top.natsuu.mta.$maaTauriAndroidResourceId"
        resValue("string", "app_name", maaTauriAndroidAppName)
        resValue("string", "main_activity_title", maaTauriAndroidAppName)
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")

        ndk {
            abiFilters.add("arm64-v8a")
        }

        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    buildFeatures {
        buildConfig = true
        aidl = true
        resValues = true
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    packaging {
        // MaaFramework is reloaded from its file path by Rust; APK-internal
        // "!/lib/..." paths cannot be passed to ordinary dlopen().
        jniLibs.useLegacyPackaging = true
        jniLibs.pickFirsts.add("**/libc++_shared.so")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/native/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.directories.add(maaTauriAndroidMaaDirPath.absolutePath)
        }
    }

    androidResources {
        noCompress += "zip"
    }
}

extensions.configure<com.android.build.api.variant.ApplicationAndroidComponentsExtension> {
    onVariants { variant ->
        if (piProfile != null) {
            variant.sources.assets?.addStaticSourceDirectory(piPackedDir.get().asFile.absolutePath)
            // Generated launcher icons live at the variant level so they
            // override the committed Tauri defaults without touching tracked
            // res files. An interface without an icon leaves the directory
            // empty and the defaults win.
            variant.sources.res
                ?.addStaticSourceDirectory(piLauncherIconResDir.get().asFile.absolutePath)

            // AGP may keep the asset merge up-to-date when only files inside a
            // static source directory change. Declare the generated tree as a
            // task input as well, so Gradle fingerprints its contents directly.
            val mergeAssetsTaskName =
                "merge${variant.name.replaceFirstChar { it.uppercase() }}Assets"
            tasks.matching { it.name == mergeAssetsTaskName }.configureEach {
                dependsOn(preparePiArchive, prepareAgentRuntime)
                inputs.dir(piPackedDir)
                    .withPropertyName("piPackedAssets")
                    .withPathSensitivity(PathSensitivity.NONE)
            }
            val mergeResourcesTaskName =
                "merge${variant.name.replaceFirstChar { it.uppercase() }}Resources"
            tasks.matching { it.name == mergeResourcesTaskName }.configureEach {
                dependsOn(syncPiLauncherIcon)
                inputs.dir(piLauncherIconResDir)
                    .withPropertyName("piLauncherIconRes")
                    .withPathSensitivity(PathSensitivity.NONE)
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("dev.rikka.shizuku:api:13.1.5")
    implementation("dev.rikka.shizuku:provider:13.1.5")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile
import java.util.Properties
import java.util.TreeMap

import top.natsuu.maa.tauri.android.kotlin.PiProfileReader

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
val piInclude = piProfile?.include ?: listOf(
    "interface.json",
    "tasks/**",
    "resource/**",
    "resource_*/**",
    "config/**",
    "data/**",
    "locale/**",
    "locales/**",
    "agent/**",
    "python/**",
    "CONTACT",
    "LICENSE",
)
val piExclude = piProfile?.exclude.orEmpty()
val maaTauriAndroidResourceId = piProfile?.resourceId ?: "fixture"
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

fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

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
    val syncPiAssets = tasks.register<Sync>("syncPiAssets") {
        group = "build"
        description = "Sync the configured Project Interface resources into the generated PI tree"
        val sourceDir = requireNotNull(piAssets) {
            "No Project Interface configured; set pi.profile in local.properties or pass -Ppi.profile"
        }
        into(piRootDir)
        from(sourceDir) {
            include(piInclude)
            exclude(piExclude)
            exclude(".git/**", "node_modules/**", ".venv/**", "__pycache__/**")
        }
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
                "bundleSha256" to runtime.bundleSha256,
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
            val piArchiveHash = sha256(packedPiArchive)

            val descriptorRuntimes = runtimes.mapIndexed { index, runtime ->
                validateAgentBundle(runtime.bundle, index)
                val target = packedAgentRoot.resolve("runtime-$index.zip")
                runtime.bundle.copyTo(target, overwrite = true)
                val actualBundleHash = sha256(target)
                // bundle_sha256 is an optional pin. When the profile omits it the digest of the
                // archive just packaged is recorded instead, and that recorded value is what the
                // on-device runtime verifies against.
                val expectedBundleHash = runtime.bundleSha256
                require(expectedBundleHash == null || actualBundleHash == expectedBundleHash) {
                    "agent runtime $index does not match bundle_sha256: expected " +
                        "$expectedBundleHash but packaged $actualBundleHash (${runtime.bundle})"
                }
                linkedMapOf<String, Any?>(
                    "args" to runtime.args,
                    "bundleSha256" to actualBundleHash,
                    "env" to TreeMap(runtime.env),
                    "exec" to runtime.exec,
                    "executables" to runtime.executables,
                    "interfaceIndex" to index,
                    "workingDir" to runtime.workingDir,
                )
            }
            val interfaceHash = sha256(piRootDir.get().file("interface.json").asFile)
            val canonicalDescriptor = linkedMapOf<String, Any?>(
                "abi" to "arm64-v8a",
                "interfaceSha256" to interfaceHash,
                "piSha256" to piArchiveHash,
                "runtimes" to descriptorRuntimes,
                "schemaVersion" to 1,
                "timeoutMs" to agentProfile.timeoutMs,
            )
            val fingerprint = sha256(packedAgentRoot.resolve("fingerprint.temp").apply {
                writeText(canonicalJson(canonicalDescriptor))
            })
            packedAgentRoot.resolve("fingerprint.temp").delete()

            val descriptor = LinkedHashMap(canonicalDescriptor)
            descriptor["fingerprint"] = fingerprint
            packedAgentRoot.resolve("runtime.json")
                .writeText(JsonOutput.prettyPrint(JsonOutput.toJson(descriptor)))
            packedAgentRoot.resolve("runtime.fingerprint").writeText(fingerprint)
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

tasks.named("preBuild") {
    dependsOn(preparePiArchive, prepareAgentRuntime)
}

android {
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    namespace = "top.natsuu.maa.tauri.android"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "top.natsuu.maa.tauri.android.$maaTauriAndroidResourceId"
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
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
        aidl = true
    }

    packaging {
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
            jniLibs.srcDirs(maaTauriAndroidMaaDirPath)
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
        }
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

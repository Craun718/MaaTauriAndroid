import java.util.Properties
import java.io.File
import java.util.Locale
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
    ?: providers.gradleProperty("piProfile").orNull
    ?: localProperties.getProperty("pi.profile")?.trim()?.takeIf { it.isNotEmpty() }
    ?: System.getenv("PI_PROFILE")?.trim()?.takeIf { it.isNotEmpty() }
val piProfileFile = piProfilePath?.let { path ->
    val file = rootProject.file(path)
    require(file.isFile) { "pi.profile points at a missing file: ${file.absolutePath}" }
    file
}
val piProfile: Map<String, String> = piProfileFile?.let { file ->
    when (file.extension.lowercase(Locale.ROOT)) {
        "toml" -> PiProfileReader.read(file)
        "properties" -> Properties().apply {
            file.inputStream().use { load(it) }
        }.map { (key, value) -> key.toString() to value.toString() }.toMap()
        else -> throw IllegalArgumentException(
            "pi.profile must be a .toml or .properties file: ${file.absolutePath}",
        )
    }
} ?: emptyMap()

fun profileProperty(vararg keys: String): String? {
    for (key in keys) {
        providers.gradleProperty(key).orNull?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    }
    val aliases = keys.flatMap { key ->
        listOf(
            key,
            key.replace('.', '_'),
            key.replace(Regex("([a-z0-9])([A-Z])")) { match ->
                "${match.groupValues[1]}_${match.groupValues[2]}"
            }.lowercase(Locale.ROOT),
        )
    }.distinct()
    for (key in aliases) {
        piProfile[key]?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    }
    return null
}

fun profilePath(key: String): String? = profileProperty(key)?.let { value ->
    val file = File(value)
    if (file.isAbsolute) {
        file.normalize().absolutePath
    } else {
        requireNotNull(piProfileFile) { "$key requires pi.profile when the path is relative" }
            .parentFile
            .resolve(value)
            .normalize()
            .absolutePath
    }
}

fun pathList(key: String, fallback: List<String>? = null): List<String>? {
    val rawValue = profileProperty(key)
        ?: fallback?.joinToString(",")?.takeIf { fallback.isNotEmpty() }
        ?: return null
    return rawValue.split(',', '\n')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
}

val piAssets = profilePath("pi.assets") ?: profilePath("assets")
val piInclude = pathList(
    "pi.include",
    listOf(
        "interface.json",
        "tasks/**",
        "resource/**",
        "resource_*/**",
        "config/**",
        "data/**",
        "locale/**",
        "locales/**",
        "CONTACT",
        "LICENSE",
    ),
)!!
val piExclude = pathList("pi.exclude").orEmpty()
val maaTauriAndroidResourceId = profileProperty("maaTauriAndroidResourceId", "resourceId") ?: "fixture"
val maaTauriAndroidMaaDir = profileProperty("maaTauriAndroidMaaDir", "maaDir") ?: "vendor/maa/android"
val maaTauriAndroidMaaDirPath = File(maaTauriAndroidMaaDir).let { directory ->
    if (directory.isAbsolute) {
        directory.normalize()
    } else {
        file("../../../../$maaTauriAndroidMaaDir")
    }
}
val piGeneratedDir = layout.buildDirectory.dir("generated/piAssets")
val piRootDir = piGeneratedDir.map { it.dir("pi") }
val piPackedDir = piGeneratedDir.map { it.dir("packed") }
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
        require(piRootDir.get().file("interface.json").asFile.isFile) {
            "The Project Interface profile did not produce interface.json"
        }
    }
}
val preparePiAssets = if (piAssets != null) {
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
    tasks.register("clearPiArchive") {
        group = "build"
        description = "Remove a stale Project Interface archive after the profile is removed"
        doLast {
            delete(piPackedDir)
        }
    }
}

tasks.named("preBuild") {
    dependsOn(preparePiAssets)
}

piPackedDir.get().asFile.mkdirs()

android {
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    namespace = "top.natsuu.maa.tauri.android"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "top.natsuu.maa.tauri.android.$maaTauriAndroidResourceId"
        minSdk = 28
        targetSdk = 37
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
        variant.sources.assets?.addStaticSourceDirectory(piPackedDir.get().asFile.absolutePath)
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

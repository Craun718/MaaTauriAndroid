plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    // Gradle types are needed at test runtime too: PiLauncherIcon uses Groovy
    // JSON parsing and Gradle path helpers.
    implementation(gradleApi())
    implementation("com.android.tools.build:gradle:9.3.2")
    implementation("org.tomlj:tomlj:1.3.0")
    implementation("org.checkerframework:checker-qual:3.55.1")
    implementation("org.twelvemonkeys.imageio:image-ico:3.12.0")
    implementation("org.twelvemonkeys.imageio:imageio-webp:3.12.0")
    testImplementation("junit:junit:4.13.2")
}

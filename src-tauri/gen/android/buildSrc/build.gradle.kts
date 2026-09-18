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
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:9.3.2")
    implementation("org.tomlj:tomlj:1.3.0")
    implementation("org.checkerframework:checker-qual:3.55.1")
    testImplementation("junit:junit:4.13.2")
}

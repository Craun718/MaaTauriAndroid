package top.natsuu.mta.kotlin

import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PiLauncherIconTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private fun writeInterface(json: String): File =
        temporaryFolder.newFolder("pi").resolve("interface.json").apply { writeText(json) }

    private fun writeIcon(directory: File, name: String = "logo.png", size: Int = 9): File {
        val image = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val file = directory.resolve(name)
        file.parentFile.mkdirs()
        assertTrue(ImageIO.write(image, "png", file))
        return file
    }

    @Test
    fun returnsNullWhenTheInterfaceDeclaresNoIcon() {
        val interfaceFile = writeInterface("""{"name": "fixture"}""")

        assertNull(PiLauncherIcon.resolve(interfaceFile))
    }

    @Test
    fun resolvesTheDeclaredIconRelativeToTheInterface() {
        val interfaceFile = writeInterface("""{"icon": "./brand/logo.png"}""")
        val icon = writeIcon(interfaceFile.parentFile.resolve("brand"))

        assertEquals(icon.canonicalFile, PiLauncherIcon.resolve(interfaceFile)?.canonicalFile)
    }

    @Test
    fun resolvesWindowsStyleIconPathsRelativeToTheInterface() {
        val interfaceFile = writeInterface("""{"icon": ".\\brand\\logo.png"}""")
        val icon = writeIcon(interfaceFile.parentFile.resolve("brand"))

        assertEquals(icon.canonicalFile, PiLauncherIcon.resolve(interfaceFile)?.canonicalFile)
    }

    @Test
    fun resolvesIconKeysThroughTheDefaultLanguageLocale() {
        val interfaceFile = writeInterface(
            """
            {
              "icon": "${'$'}icon",
              "languages": {
                "en_us": "locale/en_us.json",
                "zh_cn": "locale/zh_cn.json"
              }
            }
            """.trimIndent(),
        )
        val root = interfaceFile.parentFile
        root.resolve("locale/en_us.json")
            .apply { parentFile.mkdirs() }
            .writeText("""{"icon": "english.png"}""")
        root.resolve("locale/zh_cn.json")
            .apply { parentFile.mkdirs() }
            .writeText("""{"icon": "logo.png"}""")
        val icon = writeIcon(root)

        assertEquals(icon.canonicalFile, PiLauncherIcon.resolve(interfaceFile)?.canonicalFile)
    }

    @Test
    fun treatsAnUnresolvableIconKeyAsMissing() {
        val interfaceFile = writeInterface(
            """
            {
              "icon": "${'$'}missing",
              "languages": {"zh_cn": "locale/zh_cn.json"}
            }
            """.trimIndent(),
        )
        val root = interfaceFile.parentFile
        root.resolve("locale/zh_cn.json")
            .apply { parentFile.mkdirs() }
            .writeText("{}")

        assertNull(PiLauncherIcon.resolve(interfaceFile))
    }

    @Test
    fun rejectsIconsOutsideTheInterface() {
        val interfaceFile = writeInterface("""{"icon": "../escape.png"}""")
        writeIcon(temporaryFolder.root)

        assertThrows(IllegalArgumentException::class.java) {
            PiLauncherIcon.resolve(interfaceFile)
        }
    }

    @Test
    fun generatesLauncherIconsForEveryDensity() {
        val source = writeIcon(temporaryFolder.newFolder("pi"), size = 7)
        val resDir = temporaryFolder.newFolder("res")

        PiLauncherIcon.generate(source, resDir)

        val densities = mapOf(
            "mdpi" to 48,
            "hdpi" to 72,
            "xhdpi" to 96,
            "xxhdpi" to 144,
            "xxxhdpi" to 192,
        )
        for ((density, size) in densities) {
            val launcher = resDir.resolve("mipmap-$density/ic_launcher.png")
            val round = resDir.resolve("mipmap-$density/ic_launcher_round.png")
            assertTrue(launcher.isFile)
            assertTrue(round.isFile)
            val decoded = requireNotNull(ImageIO.read(launcher))
            assertEquals(size, decoded.width)
            assertEquals(size, decoded.height)
        }
    }

    @Test
    fun writesAWebAppIconForTheFrontendDist() {
        val source = writeIcon(temporaryFolder.newFolder("pi"), size = 300)
        val target = temporaryFolder.newFolder("dist").resolve("app-icon.png")

        PiLauncherIcon.writeWebAppIcon(source, target)

        val decoded = requireNotNull(ImageIO.read(target))
        assertEquals(256, decoded.width)
        assertEquals(256, decoded.height)
    }
}

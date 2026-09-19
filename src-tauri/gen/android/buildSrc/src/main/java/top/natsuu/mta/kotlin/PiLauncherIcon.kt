package top.natsuu.mta.kotlin

import groovy.json.JsonSlurper
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.awt.geom.Ellipse2D
import java.io.File
import javax.imageio.ImageIO

// Classic launcher bitmaps in every density bucket the template ships.
private val launcherDensities = listOf(
    "mdpi" to 48,
    "hdpi" to 72,
    "xhdpi" to 96,
    "xxhdpi" to 144,
    "xxxhdpi" to 192,
)

object PiLauncherIcon {
    /**
     * Returns the app icon declared by interface.json, or null when the
     * interface declares no icon (or an icon key with no translation), in
     * which case the build keeps the default Tauri launcher icons.
     */
    fun resolve(interfaceFile: File): File? {
        val document = JsonSlurper().parse(interfaceFile)
        require(document is Map<*, *>) { "interface.json must contain an object" }
        val declared = (document["icon"] as? String)?.trim().orEmpty()
        if (declared.isEmpty()) return null
        val path = if (declared.startsWith("\$")) {
            localize(interfaceFile, document, declared.substring(1)) ?: return null
        } else {
            declared
        }
        val root = interfaceFile.canonicalFile.parentFile
        val source = File(root, path).canonicalFile
        require(source.path.startsWith("${root.path}${File.separator}")) {
            "launcher icon must stay inside the Project Interface: $path"
        }
        require(source.isFile) {
            "launcher icon does not exist: ${source.invariantSeparatorsPath}"
        }
        return source
    }

    fun generate(source: File, resDir: File) {
        val image = ImageIO.read(source)
            ?: throw IllegalArgumentException(
                "unsupported launcher icon image: ${source.invariantSeparatorsPath}",
            )
        require(image.width > 0 && image.height > 0) {
            "launcher icon is empty: ${source.invariantSeparatorsPath}"
        }
        for ((density, size) in launcherDensities) {
            val fitted = fitSquare(image, size)
            val directory = resDir.resolve("mipmap-$density")
            writePng(fitted, directory.resolve("ic_launcher.png"))
            writePng(circular(fitted), directory.resolve("ic_launcher_round.png"))
        }
    }

    // The runtime loader resolves $keys against the default language: zh_cn,
    // then the first declared language. Mirror that for the packaged icon.
    private fun localize(interfaceFile: File, document: Map<*, *>, key: String): String? {
        val languages = document["languages"] as? Map<*, *> ?: return null
        val localePath = (languages["zh_cn"] ?: languages.values.firstOrNull()) as? String
            ?: return null
        val localeFile = File(interfaceFile.parentFile, localePath)
        if (!localeFile.isFile) return null
        val locale = JsonSlurper().parse(localeFile)
        return (locale as? Map<*, *>)?.get(key) as? String
    }

    private fun fitSquare(image: BufferedImage, size: Int): BufferedImage {
        val canvas = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val graphics = canvas.createGraphics()
        try {
            configure(graphics)
            val scale = minOf(
                size.toDouble() / image.width,
                size.toDouble() / image.height,
            )
            val width = (image.width * scale).toInt().coerceAtLeast(1)
            val height = (image.height * scale).toInt().coerceAtLeast(1)
            graphics.drawImage(image, (size - width) / 2, (size - height) / 2, width, height, null)
        } finally {
            graphics.dispose()
        }
        return canvas
    }

    private fun circular(image: BufferedImage): BufferedImage {
        val canvas = BufferedImage(image.width, image.height, BufferedImage.TYPE_INT_ARGB)
        val graphics = canvas.createGraphics()
        try {
            configure(graphics)
            graphics.clip = Ellipse2D.Float(0f, 0f, image.width.toFloat(), image.height.toFloat())
            graphics.drawImage(image, 0, 0, null)
        } finally {
            graphics.dispose()
        }
        return canvas
    }

    private fun configure(graphics: Graphics2D) {
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        graphics.setRenderingHint(
            RenderingHints.KEY_INTERPOLATION,
            RenderingHints.VALUE_INTERPOLATION_BILINEAR,
        )
        graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
    }

    private fun writePng(image: BufferedImage, target: File) {
        target.parentFile.mkdirs()
        check(ImageIO.write(image, "png", target)) {
            "could not write launcher icon: ${target.invariantSeparatorsPath}"
        }
    }
}

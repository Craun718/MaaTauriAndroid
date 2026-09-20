package top.natsuu.mta.kotlin

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PiPackageTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private fun project(interfaceJson: String, files: Map<String, String> = emptyMap()): File {
        val root = temporaryFolder.newFolder("pi")
        root.resolve("interface.json").writeText(interfaceJson)
        files.forEach { (path, content) ->
            root.resolve(path).apply {
                parentFile?.mkdirs()
                writeText(content)
            }
        }
        return root
    }

    private fun minimal(extra: String = ""): String = """
        {
            "interface_version": 2,
            "name": "demo",
            "label": "Demo",
            "languages": {"zh_cn": "locales/zh_cn.json"},
            "resource": [{"name": "base", "path": ["./resource/base"]}],
            "task": [{"name": "Start", "entry": "Start"}]
            $extra
        }
    """.trimIndent()

    @Test
    fun packagesTheTranslationDirectoryTheInterfaceDeclares() {
        // Regression guard for M9A v4.9.0: i18n/ became locales/ and a hard-coded glob
        // matched nothing, so the packaged interface pointed at files that were not in it.
        val root = project(
            minimal(),
            mapOf(
                "locales/zh_cn.json" to """{"Task.Start": "开始"}""",
                "resource/base/pipeline/start.json" to """{"Start": {"next": []}}""",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("locales/zh_cn.json"))
        assertTrue(plan.entries.contains("resource/base"))
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun reportsADeclaredTranslationFileThatIsAbsent() {
        val root = project(minimal(), mapOf("resource/base/pipeline/start.json" to "{}"))

        val plan = PiPackage.plan(root)

        assertEquals(listOf("locales/zh_cn.json"), plan.missing)
    }

    @Test
    fun followsImportFilesToReachOptionsAndPresets() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "resource": [{"name": "base", "path": ["./resource/base"]}],
                "import": ["tasks/Daily.json"]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "tasks/Daily.json" to
                    """{"task": [{"name": "Daily", "entry": "Daily"}]}""",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("tasks/Daily.json"))
    }

    @Test
    fun collectsIconsAndRichTextImagesIncludingNestedOptions() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "icon": "logo.ico",
                "resource": [{"name": "base", "path": ["./resource/base"]}],
                "option": {
                    "Style": {
                        "type": "select",
                        "cases": [
                            {
                                "name": "Fancy",
                                "icon": "./resource/announcement/images/item.png"
                            }
                        ]
                    }
                }
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to """{"Help": "see ![guide](resource/announcement/images/guide.png)"}""",
                "resource/base/pipeline/start.json" to "{}",
                "logo.ico" to "icon",
                "resource/announcement/images/item.png" to "png",
                "resource/announcement/images/guide.png" to "png",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("logo.ico"))
        assertTrue(plan.entries.contains("resource/announcement/images/item.png"))
        assertTrue(plan.entries.contains("resource/announcement/images/guide.png"))
    }

    @Test
    fun treatsPlainProseAndUrlsAsTextRatherThanPaths() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "description": "Start on the home screen",
                "contact": "https://example.com/contact",
                "resource": [{"name": "base", "path": ["./resource/base"]}]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
            ),
        )

        val plan = PiPackage.plan(root)

        assertFalse(plan.entries.any { it.contains("example.com") })
        assertFalse(plan.entries.contains("Start on the home screen"))
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun packagesTheAgentDirectoryWhenTheInterfaceDeclaresAnAgent() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "resource": [{"name": "base", "path": ["./resource/base"]}],
                "agent": [{"child_exec": "uv", "child_args": ["run", "python", "agent/main.py"]}]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "agent/main.py" to "print('hi')",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("agent"))
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun reportsAnAgentEntrypointThatTheProjectDoesNotContain() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "resource": [{"name": "base", "path": ["./resource/base"]}],
                "agent": [{"child_exec": "uv", "child_args": ["run", "python", "agent/main.py"]}]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "agent/main.py" to "print('hi')",
            ),
        )
        root.resolve("agent/main.py").delete()

        val plan = PiPackage.plan(root)

        assertTrue(plan.missing.contains("agent/main.py"))
    }

    @Test
    fun ignoresPathsThatTryToEscapeTheProjectRoot() {
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "resource": [{"name": "base", "path": ["./resource/base"]}],
                "icon": "../../../etc/passwd"
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
            ),
        )

        val plan = PiPackage.plan(root)

        assertFalse(plan.entries.any { it.contains("..") })
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun packagesBundledDataThatTheAgentReadsWithoutTheProtocolDeclaringIt() {
        val root = project(
            minimal(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "data/combat/items.json" to "{}",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("data"))
    }

    @Test
    fun alwaysPackagesTheInterfaceItself() {
        val root = project(
            minimal(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
            ),
        )

        assertEquals("interface.json", PiPackage.plan(root).entries.first())
    }
}

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
    fun packagesAShellPretaskScriptAndExistingRelativeFileArguments() {
        val root = project(
            """{
                "interface_version": 2,
                "pretask": {
                    "exec": "/system/bin/sh",
                    "args": ["./scripts/prepare.sh", "config/startup.json", "配置 文件.txt", "--fast", "generated.json"]
                }
            }""",
            mapOf(
                "scripts/prepare.sh" to "echo ready",
                "config/startup.json" to "{}",
                "配置 文件.txt" to "input",
            ),
        )

        val plan = PiPackage.plan(root)

        assertEquals(
            listOf("interface.json", "scripts/prepare.sh", "config/startup.json", "配置 文件.txt"),
            plan.entries,
        )
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun collectsRelativeExecutablesAndArgumentsFromImportedPretaskArrays() {
        val root = project(
            """{
                "interface_version": 2,
                "import": ["tasks/startup.json"],
                "pretask": [{"exec": "./tools/bootstrap", "args": ["./scripts/shared.sh"]}]
            }""",
            mapOf(
                "tasks/startup.json" to """{
                    "pretask": [
                        {"exec": "tools/check", "args": ["./scripts/check.sh", "./scripts/shared.sh"]},
                        {"exec": "/system/bin/sh", "args": ["./scripts/imported.sh"]}
                    ]
                }""",
                "tools/bootstrap" to "executable",
                "tools/check" to "executable",
                "scripts/shared.sh" to "echo shared",
                "scripts/check.sh" to "echo check",
                "scripts/imported.sh" to "echo imported",
            ),
        )

        val plan = PiPackage.plan(root)

        assertEquals(
            listOf(
                "interface.json", "tasks/startup.json", "tools/bootstrap", "scripts/shared.sh",
                "tools/check", "scripts/check.sh", "scripts/imported.sh",
            ),
            plan.entries,
        )
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun collectsAnObjectPretaskFromAnImportRelativeToTheInterfaceDirectory() {
        val root = project(
            """{"interface_version": 2, "import": ["tasks/startup.json"]}""",
            mapOf(
                "tasks/startup.json" to """{"pretask": {"exec": "./tools/prepare", "args": ["input.txt"]}}""",
                "tools/prepare" to "executable",
                "input.txt" to "root input",
                "tasks/input.txt" to "wrong base directory",
            ),
        )

        val plan = PiPackage.plan(root)

        assertEquals(listOf("interface.json", "tasks/startup.json", "tools/prepare", "input.txt"), plan.entries)
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun reportsMissingRelativePretaskExecutablesButDoesNotRequirePathProgramsOrArguments() {
        val root = project(
            """{
                "interface_version": 2,
                "pretask": [
                    {"exec": "./tools/missing", "args": ["missing-input.txt"]},
                    {"exec": "python", "args": ["--version"]}
                ]
            }""",
            mapOf("python" to "not a project-relative executable reference"),
        )

        val plan = PiPackage.plan(root)

        assertEquals(listOf("interface.json"), plan.entries)
        assertEquals(listOf("tools/missing"), plan.missing)
    }

    @Test
    fun ignoresNonFileArgumentsAndPretaskPathsOutsideTheProject() {
        val root = project(
            """{
                "interface_version": 2,
                "pretask": [
                    {"exec": "../outside", "args": [
                        "../outside.txt", "/system/bin/sh", "C:/tools/prepare.exe",
                        "https://example.com/input", "--input=config.json", "inputs"
                    ]},
                    {"exec": "C:/tools/prepare.exe"},
                    {"exec": "https://example.com/tool"}
                ]
            }""",
            mapOf(
                "inputs/keep.txt" to "not a file argument",
                "--input=config.json" to "not an independent path argument",
            ),
        )
        root.parentFile.resolve("outside").writeText("outside executable")
        root.parentFile.resolve("outside.txt").writeText("outside input")

        val plan = PiPackage.plan(root)

        assertEquals(listOf("interface.json"), plan.entries)
        assertTrue(plan.missing.isEmpty())
    }

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
    fun packagesAnObjectAgentAndIgnoresAnEntrypointOutsideTheProject() {
        // NarutoMobile keeps its interface under assets/ and its agent at the repository
        // root, so the desktop interface names ../agent/main.py. The Android packer
        // receives an assembled root where agent/ is already top-level.
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "agent": {
                    "child_exec": "../.venv/Scripts/python.exe",
                    "child_args": ["-u", "../agent/main.py"]
                },
                "resource": [{"name": "base", "path": ["resource/base"]}]
            }
            """.trimIndent(),
            mapOf(
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

    @Test
    fun packagesExtraEntriesTheProfileAsksFor() {
        // pi_include can only widen the set: the protocol closure always ships.
        val root = project(
            minimal(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "assets/extra/notes.txt" to "hi",
            ),
        )

        val plan = PiPackage.plan(root, listOf("./assets/extra"))

        assertTrue(plan.entries.contains("assets/extra"))
        assertTrue(plan.entries.contains("locales/zh_cn.json"))
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun reportsAnExtraEntryThatDoesNotExist() {
        val root = project(
            minimal(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
            ),
        )

        val plan = PiPackage.plan(root, listOf("assets/missing.png"))

        assertEquals(listOf("assets/missing.png"), plan.missing)
    }

    @Test
    fun packsTheWelcomeBodyOfEveryDeclaredLanguage() {
        // M9A resolves $Welcome.N per language (`announcement/1.简介.md` in zh_cn,
        // `announcement/en_us/1.introduction.md` in en_us). Packing only the zh default
        // would leave an English device showing the raw file path instead of the body.
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {
                    "zh_cn": "locales/zh_cn.json",
                    "en_us": "locales/en_us.json"
                },
                "welcome": ["${'$'}Welcome.1"],
                "resource": [{"name": "base", "path": ["./resource/base"]}]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to """{"Welcome.1": "announcement/1.简介.md"}""",
                "locales/en_us.json" to
                    """{"Welcome.1": "announcement/en_us/1.introduction.md"}""",
                "resource/base/pipeline/start.json" to "{}",
                "announcement/1.简介.md" to "# 公告",
                "announcement/en_us/1.introduction.md" to "# Announcement",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("announcement/1.简介.md"))
        assertTrue(plan.entries.contains("announcement/en_us/1.introduction.md"))
        assertTrue(plan.missing.isEmpty())
    }

    @Test
    fun followsMarkdownImagesInsideReferencedRichTextBodies() {
        // M9A's `announcement/2.模拟器多开.md` links `announcement/images/...` from inside
        // the file. The interface only names the body, so the image is only reachable
        // through the body's own markdown.
        val root = project(
            """
            {
                "interface_version": 2,
                "name": "demo",
                "languages": {"zh_cn": "locales/zh_cn.json"},
                "welcome": ["announcement/2.模拟器多开.md"],
                "resource": [{"name": "base", "path": ["./resource/base"]}]
            }
            """.trimIndent(),
            mapOf(
                "locales/zh_cn.json" to "{}",
                "resource/base/pipeline/start.json" to "{}",
                "announcement/2.模拟器多开.md" to
                    "![主页面](announcement/images/newbie-main-interface.png)",
                "announcement/images/newbie-main-interface.png" to "png",
            ),
        )

        val plan = PiPackage.plan(root)

        assertTrue(plan.entries.contains("announcement/2.模拟器多开.md"))
        assertTrue(plan.entries.contains("announcement/images/newbie-main-interface.png"))
        assertTrue(plan.missing.isEmpty())
    }
}

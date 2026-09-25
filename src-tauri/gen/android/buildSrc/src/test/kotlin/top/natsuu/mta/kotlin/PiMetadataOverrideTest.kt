package top.natsuu.mta.kotlin

import groovy.json.JsonSlurper
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PiMetadataOverrideTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun profileRidReplacesTheInterfaceValueInThePackagedCopy() {
        val interfaceFile = temporaryFolder.newFolder("pi").resolve("interface.json").apply {
            writeText(
                """
                {
                    "interface_version": 2,
                    "name": "demo",
                    "mirrorchyan_rid": "Upstream"
                }
                """.trimIndent(),
            )
        }

        PiMetadataOverride.mirrorchyanRid(interfaceFile, "Packaged")

        val document = JsonSlurper().parse(interfaceFile) as Map<*, *>
        assertEquals("Packaged", document["mirrorchyan_rid"])
        assertEquals(2L, (document["interface_version"] as Number).toLong())
        assertEquals("demo", document["name"])
    }
}

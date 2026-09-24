package top.natsuu.mta.kotlin

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File

/**
 * Build-time metadata overrides layered on the generated Project Interface tree.
 *
 * The source Project Interface stays untouched; only the copy that is about to be
 * zipped into the APK is rewritten, so the runtime loader can keep reading exactly
 * one `interface.json` without knowing about profiles.
 */
object PiMetadataOverride {
    fun mirrorchyanRid(interfaceFile: File, rid: String) {
        val parsed = JsonSlurper().parse(interfaceFile)
        require(parsed is Map<*, *>) { "interface.json must contain an object" }
        val document = LinkedHashMap<String, Any?>()
        for ((key, value) in parsed) {
            document[key.toString()] = value
        }
        document["mirrorchyan_rid"] = rid
        interfaceFile.writeText(JsonOutput.prettyPrint(JsonOutput.toJson(document)))
    }
}

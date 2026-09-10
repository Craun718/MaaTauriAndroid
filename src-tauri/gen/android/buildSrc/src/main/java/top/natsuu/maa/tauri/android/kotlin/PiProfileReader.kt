package top.natsuu.maa.tauri.android.kotlin

import java.io.File

object PiProfileReader {
    fun read(file: File): Map<String, String> {
        val values = LinkedHashMap<String, String>()
        val lines = file.readLines()
        val cursor = intArrayOf(0)

        while (cursor[0] < lines.size) {
            val lineNumber = cursor[0] + 1
            val line = stripComment(lines[cursor[0]]).trim()
            cursor[0]++
            if (line.isEmpty()) {
                continue
            }
            require(!line.startsWith("[")) {
                "PI profile tables are not supported: ${file.invariantSeparatorsPath}"
            }

            val separator = line.indexOfFirst { it == '=' }
            require(separator > 0) {
                "Invalid PI profile entry: ${file.invariantSeparatorsPath}:$lineNumber"
            }
            val key = line.take(separator).trim().trim('"')
            require(key.isNotEmpty()) {
                "Invalid PI profile key: ${file.invariantSeparatorsPath}:$lineNumber"
            }

            val rawValue = line.drop(separator + 1).trim()
            values[key] = if (rawValue.startsWith("[")) {
                parseArray(rawValue, lines, cursor)
            } else {
                parseScalar(rawValue, file, lineNumber)
            }
        }

        return values
    }

    private fun parseArray(
        firstLine: String,
        lines: List<String>,
        cursor: IntArray,
    ): String {
        var value = firstLine
        while (unterminatedArray(value)) {
            val nextLine = lines.getOrNull(cursor[0])
                ?: throw IllegalArgumentException("Unterminated string array in PI profile")
            cursor[0]++
            value += " ${stripComment(nextLine).trim()}"
        }

        val items = mutableListOf<String>()
        val item = StringBuilder()
        var inBasicString = false
        var inLiteralString = false
        var escaped = false

        value.drop(1).dropLast(1).forEach { char ->
            when {
                escaped -> {
                    item.append(char)
                    escaped = false
                }
                inBasicString && char == '\\' -> {
                    item.append(char)
                    escaped = true
                }
                !inLiteralString && char == '"' -> {
                    item.append(char)
                    inBasicString = !inBasicString
                }
                !inBasicString && char == '\'' -> {
                    item.append(char)
                    inLiteralString = !inLiteralString
                }
                !inBasicString && !inLiteralString && char == ',' -> {
                    if (item.isNotBlank()) {
                        items += item.toString().trim()
                    }
                    item.clear()
                }
                else -> item.append(char)
            }
        }
        if (item.isNotBlank()) {
            items += item.toString().trim()
        }

        return items.joinToString("\n") { rawItem ->
            require(rawItem.startsWith("\"") || rawItem.startsWith("'")) {
                "PI profile arrays must contain strings"
            }
            parseScalar(rawItem)
        }
    }

    private fun unterminatedArray(value: String): Boolean {
        var inBasicString = false
        var inLiteralString = false
        var escaped = false

        value.forEach { char ->
            when {
                escaped -> escaped = false
                inBasicString && char == '\\' -> escaped = true
                !inLiteralString && char == '"' -> inBasicString = !inBasicString
                !inBasicString && char == '\'' -> inLiteralString = !inLiteralString
            }
        }
        return inBasicString || inLiteralString || !value.contains(']')
    }

    private fun parseScalar(value: String): String {
        return when {
            value.startsWith('"') -> parseBasicString(value)
            value.startsWith('\'') -> value.removeSuffix("'").removePrefix("'")
            value == "true" || value == "false" -> value
            value.toLongOrNull() != null || value.toDoubleOrNull() != null -> value
            else -> throw IllegalArgumentException("Unsupported PI profile value: $value")
        }
    }

    private fun parseScalar(value: String, file: File, line: Int): String {
        try {
            return parseScalar(value)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException(
                "${file.invariantSeparatorsPath}:$line ${error.message}",
                error,
            )
        }
    }

    private fun parseBasicString(value: String): String {
        require(value.endsWith("\"") && value.length >= 2) {
            "Unterminated string in PI profile"
        }

        val chars = value.drop(1).dropLast(1)
        val result = StringBuilder()
        var index = 0
        while (index < chars.length) {
            val char = chars[index]
            if (char != '\\') {
                result.append(char)
                index++
                continue
            }

            require(index + 1 < chars.length) { "Unterminated escape in PI profile" }
            val escape = chars[index + 1]
            when (escape) {
                '"' -> result.append('"')
                '\\' -> result.append('\\')
                'n' -> result.append('\n')
                't' -> result.append('\t')
                'r' -> result.append('\r')
                'u' -> {
                    val code = chars.drop(index + 2).take(4)
                    require(code.length == 4 && code.toIntOrNull(16) != null) {
                        "Invalid Unicode escape in PI profile"
                    }
                    result.append(code.toInt(16).toChar())
                    index += 4
                }
                else -> throw IllegalArgumentException("Unsupported escape in PI profile: \\$escape")
            }
            index += 2
        }
        return result.toString()
    }

    private fun stripComment(line: String): String {
        var inBasicString = false
        var inLiteralString = false
        var escaped = false

        line.forEachIndexed { index, char ->
            when {
                escaped -> escaped = false
                inBasicString && char == '\\' -> escaped = true
                !inLiteralString && char == '"' -> inBasicString = !inBasicString
                !inBasicString && char == '\'' -> inLiteralString = !inLiteralString
                !inBasicString && !inLiteralString && char == '#' -> return line.take(index)
            }
        }
        return line
    }
}

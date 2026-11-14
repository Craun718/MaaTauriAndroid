package top.natsuu.mta

import java.io.IOException

internal class OptionPathLimitExceeded : IOException("option file import exceeds the size limit")

/** Enforce limits against actual streamed bytes, not provider-reported metadata. */
internal class OptionPathCopyBudget {
    private var totalBytes = 0L
    fun bytes(count: Int) {
        require(count >= 0)
        totalBytes += count
        if (totalBytes > MAX_BYTES) throw OptionPathLimitExceeded()
    }

    companion object {
        const val MAX_BYTES = 256L * 1024L * 1024L

        fun safeName(name: String?): String {
            require(!name.isNullOrBlank() && name != "." && name != "..") { "invalid document name" }
            require(name.none { it == '/' || it == '\\' || it == '\u0000' }) { "invalid document name" }
            return name
        }
    }
}

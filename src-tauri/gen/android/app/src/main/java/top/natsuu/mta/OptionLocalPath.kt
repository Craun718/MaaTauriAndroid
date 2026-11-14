package top.natsuu.mta

/** Pure document-id mapping for the privileged Agent, independent of app-UID storage access. */
internal object OptionLocalPath {
    fun externalDocumentPath(documentId: String, primaryRoot: String, volumeRoot: (String) -> String?): String? {
        val parts = documentId.split(':', limit = 2)
        if (parts.size != 2) return null
        val volume = parts[0]
        val root = if (volume.equals("primary", ignoreCase = true)) primaryRoot else volumeRoot(volume) ?: return null
        val relative = parts[1]
        if (relative.startsWith('/') || relative.contains('\\') || relative.contains('\u0000')) return null
        if (relative.split('/').any { it == "." || it == ".." }) return null
        return if (relative.isEmpty()) root else "$root/$relative"
    }

    fun isSharedPath(path: String): Boolean {
        // This checks path shape, not app-UID access. AOSP MediaProviderWrapper's
        // isUidAllowedAccessToDataOrObbPath bypasses checks for shell/root; do not
        // reject external Android/data or Android/obb merely because app POSIX
        // access is scoped. Actual access depends on the consuming UID/device.
        return path.startsWith("/storage/") && !path.contains('\u0000') && !path.contains('\\') &&
            !path.contains("//") &&
            path.split('/').none { it == "." || it == ".." }
    }
}

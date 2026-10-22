package top.natsuu.mta.control

/** Creation flags and Display.flags use different bit assignments. */
internal object VirtualDisplayPolicy {
    private const val BASE = (1 shl 0) or (1 shl 1) or (1 shl 3) or (1 shl 6) or (1 shl 8)
    const val OWN_DISPLAY_GROUP = 1 shl 11

    fun tiers(sdk: Int): List<Int> {
        if (sdk < 33) return listOf(BASE)
        val compatibility = BASE or (1 shl 13)
        var full = compatibility or (1 shl 10) or OWN_DISPLAY_GROUP or (1 shl 12)
        if (sdk >= 34) full = full or (1 shl 14) or (1 shl 15) or (1 shl 16)
        return listOf(full, compatibility)
    }

    fun <T> create(sdk: Int, rejected: (Int, SecurityException) -> Unit, create: (Int) -> T): Pair<Int, T> {
        val flags = tiers(sdk)
        for ((tier, requested) in flags.withIndex()) {
            try {
                return tier to create(requested)
            } catch (error: SecurityException) {
                if (tier == flags.lastIndex) throw error
                rejected(tier, error)
            }
        }
        error("no virtual display flags")
    }
}

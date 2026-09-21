package top.natsuu.mta.control

internal class TargetPackages(private val store: TargetPackageStore? = null) {
    private val packages = LinkedHashSet<String>()

    fun add(packageName: String) {
        if (packageName.isEmpty()) return
        synchronized(packages) {
            if (packages.add(packageName)) {
                store?.write(packages.toList())
            }
        }
    }

    fun remove(packageName: String) {
        synchronized(packages) {
            if (packages.remove(packageName)) {
                store?.write(packages.toList())
            }
        }
    }

    /** Snapshot without clearing; failed stops stay eligible for a retry. */
    fun peek(): List<String> {
        synchronized(packages) {
            return packages.toList()
        }
    }

    fun drain(): List<String> {
        synchronized(packages) {
            val drained = packages.toList()
            packages.clear()
            store?.write(emptyList())
            return drained
        }
    }
}

package top.natsuu.mta.control

internal class TargetPackages {
    private val packages = LinkedHashSet<String>()

    fun add(packageName: String) {
        if (packageName.isNotEmpty()) {
            synchronized(packages) {
                packages.add(packageName)
            }
        }
    }

    fun remove(packageName: String) {
        synchronized(packages) {
            packages.remove(packageName)
        }
    }

    fun drain(): List<String> {
        synchronized(packages) {
            val drained = packages.toList()
            packages.clear()
            return drained
        }
    }
}

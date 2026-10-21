package top.natsuu.mta.control

import java.io.InputStream

/** A dedicated reader, independent of Binder's transaction/death-notification pool. */
internal object OwnerLifeline {
    fun watch(input: InputStream, failed: (Exception) -> Unit, gone: () -> Unit) {
        try {
            input.use { while (it.read() != -1) { } }
        } catch (error: Exception) {
            failed(error)
        } finally {
            gone()
        }
    }
}

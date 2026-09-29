package top.natsuu.mta.control

import android.os.IBinder
import android.os.IInterface
import android.os.Parcel
import android.os.RemoteException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.FileDescriptor
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class OwnerLeaseTest {
    @Test
    fun `rejects a missing owner`() {
        val lease = OwnerLease {}

        assertEquals(OwnerLease.RESULT_OWNER_MISSING, lease.attach(null))
    }

    @Test
    fun `allows one owner and reports duplicate attach`() {
        val lease = OwnerLease {}
        val owner = TestBinder()

        assertEquals(OwnerLease.RESULT_ATTACHED, lease.attach(owner))
        assertEquals(1, owner.linkedRecipientCount)
        assertEquals(OwnerLease.RESULT_ALREADY_OWNED, lease.attach(TestBinder()))
        assertEquals(1, owner.linkedRecipientCount)
    }

    @Test
    fun `reports a binder link failure without acquiring the lease`() {
        val ownerGone = CountDownLatch(1)
        val lease = OwnerLease { ownerGone.countDown() }

        assertEquals(
            OwnerLease.RESULT_WATCH_FAILED,
            lease.attach(TestBinder(linkShouldFail = true)),
        )
        assertEquals(1, ownerGone.count)
    }

    @Test
    fun `runs cleanup once after an attached owner dies`() {
        val ownerGone = CountDownLatch(1)
        val cleanupCount = AtomicInteger()
        val lease = OwnerLease { cleanupCount.incrementAndGet(); ownerGone.countDown() }
        val owner = TestBinder()

        assertEquals(OwnerLease.RESULT_ATTACHED, lease.attach(owner))
        owner.die()

        assertTrue(ownerGone.await(5, TimeUnit.SECONDS))
        assertEquals(1, cleanupCount.get())
        assertEquals(
            OwnerLease.RESULT_SERVICE_EXITING,
            lease.attach(TestBinder()),
        )
    }

    @Test
    fun `rejects an owner that dies while its death watch is armed`() {
        val ownerGone = CountDownLatch(1)
        val cleanupCount = AtomicInteger()
        val lease = OwnerLease { cleanupCount.incrementAndGet(); ownerGone.countDown() }
        val owner = TestBinder(notifyDeathOnLink = true)

        assertEquals(OwnerLease.RESULT_SERVICE_EXITING, lease.attach(owner))

        assertTrue(ownerGone.await(5, TimeUnit.SECONDS))
        assertEquals(1, cleanupCount.get())
        assertEquals(
            OwnerLease.RESULT_SERVICE_EXITING,
            lease.attach(TestBinder()),
        )
    }

    private class TestBinder(
        private val linkShouldFail: Boolean = false,
        private val notifyDeathOnLink: Boolean = false,
    ) : IBinder {
        private val recipients = mutableListOf<IBinder.DeathRecipient>()

        val linkedRecipientCount: Int
            get() = recipients.size

        fun die() {
            val current = recipients.toList()
            recipients.clear()
            current.forEach(IBinder.DeathRecipient::binderDied)
        }

        override fun linkToDeath(recipient: IBinder.DeathRecipient, flags: Int) {
            if (linkShouldFail) throw RemoteException("link failed")
            recipients.add(recipient)
            if (notifyDeathOnLink) recipient.binderDied()
        }

        override fun unlinkToDeath(recipient: IBinder.DeathRecipient, flags: Int): Boolean {
            return recipients.remove(recipient)
        }

        override fun pingBinder(): Boolean = true

        override fun isBinderAlive(): Boolean = true

        override fun getInterfaceDescriptor(): String? = null

        override fun queryLocalInterface(descriptor: String?): IInterface? = null

        override fun dump(fd: FileDescriptor, args: Array<String?>?) {}

        override fun dumpAsync(fd: FileDescriptor, args: Array<String?>?) {}

        override fun transact(
            code: Int,
            data: Parcel,
            reply: Parcel?,
            flags: Int,
        ): Boolean = false
    }
}

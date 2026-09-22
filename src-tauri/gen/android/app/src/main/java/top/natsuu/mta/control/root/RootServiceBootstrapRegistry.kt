package top.natsuu.mta.control.root

import android.os.Binder
import android.os.IBinder
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap

/**
 * Claims the binder a freshly spawned root service hands back to the app.
 *
 * The root service cannot bind to the app directly (it lives outside the
 * app's process and has no exported service to target), so it starts, is
 * handed the [RootServiceBootstrapProvider] binder, and calls back into the
 * provider with the token generated here. The provider matches the token and
 * completes the pending future; a token that does not match an in-flight
 * launch is rejected so a dying old process cannot be mistaken for the new
 * one.
 */
object RootServiceBootstrapRegistry {
    const val AUTHORITY_SUFFIX = ".root.bootstrap"
    const val METHOD_ATTACH_REMOTE_SERVICE = "attachRemoteService"
    const val KEY_TOKEN = "token"
    const val KEY_SERVICE_BINDER = "service_binder"
    const val KEY_APP_BINDER = "app_binder"
    const val KEY_APP_PID = "app_pid"

    private val pendingBinders = ConcurrentHashMap<String, CompletableFuture<IBinder>>()
    private val appLifecycleBinder: IBinder = Binder()

    fun register(token: String): CompletableFuture<IBinder> {
        return CompletableFuture<IBinder>().also { pendingBinders[token] = it }
    }

    fun unregister(token: String) {
        pendingBinders.remove(token)?.cancel(false)
    }

    fun attach(token: String, binder: IBinder): IBinder? {
        val deferred = pendingBinders.remove(token) ?: return null
        deferred.complete(binder)
        return appLifecycleBinder
    }
}

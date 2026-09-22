package top.natsuu.mta.control.root

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Process
import android.util.Log

/**
 * Receives the root service binder and hands the app lifecycle binder back.
 *
 * The provider is exported so the root process (which runs outside the app's
 * uid) can reach it, but the token handshake in
 * [RootServiceBootstrapRegistry] plus the calling-uid check keep an arbitrary
 * caller from claiming a launch. Only the root uid (0) and the shell uid are
 * accepted: the launcher runs as root on Android 14+ and as shell otherwise.
 */
class RootServiceBootstrapProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        if (method != RootServiceBootstrapRegistry.METHOD_ATTACH_REMOTE_SERVICE || extras == null) {
            return super.call(method, arg, extras)
        }
        val callingUid = Binder.getCallingUid()
        if (callingUid != Process.SHELL_UID && callingUid != 0) {
            Log.w(TAG, "Rejecting root bootstrap caller uid=$callingUid")
            return null
        }

        val token = extras.getString(RootServiceBootstrapRegistry.KEY_TOKEN) ?: return null
        val binder = extras.getBinder(RootServiceBootstrapRegistry.KEY_SERVICE_BINDER) ?: return null
        val appBinder = RootServiceBootstrapRegistry.attach(token, binder) ?: run {
            Log.w(TAG, "Root bootstrap token not found: $token")
            return null
        }

        return Bundle().apply {
            putBinder(RootServiceBootstrapRegistry.KEY_APP_BINDER, appBinder)
            putInt(RootServiceBootstrapRegistry.KEY_APP_PID, Process.myPid())
        }
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    private companion object {
        const val TAG = "MaaTauriAndroidControl"
    }
}

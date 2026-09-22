package android.content;

import android.os.Bundle;
import android.os.IBinder;
import android.os.IInterface;
import android.os.RemoteException;

/**
 * Compile-time stub for the hidden framework interface. It is compileOnly and
 * never packaged into the APK.
 */
public interface IContentProvider extends IInterface {
    Bundle call(String callingPkg, String method, String arg, Bundle extras) throws RemoteException;

    Bundle call(String callingPkg, String authority, String method, String arg, Bundle extras)
            throws RemoteException;

    Bundle call(
            String callingPkg,
            String attributionTag,
            String authority,
            String method,
            String arg,
            Bundle extras
    ) throws RemoteException;

    Bundle call(
            AttributionSource attributionSource,
            String authority,
            String method,
            String arg,
            Bundle extras
    ) throws RemoteException;
}

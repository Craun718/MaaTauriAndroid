package top.natsuu.mta.control.root;

import android.content.AttributionSource;
import android.content.IContentProvider;
import android.os.Build;
import android.os.Bundle;
import android.os.RemoteException;
import android.system.Os;

/**
 * Source-compatible wrapper around the hidden {@link IContentProvider#call}
 * overloads. The signature changed three times between API 28 and API 31, and
 * the root process may talk to a provider that lives in a differently aged
 * framework, so each version is attempted in turn.
 */
public final class RootIContentProviderCompat {

    private static final String SHELL_PACKAGE = "com.android.shell";

    private RootIContentProviderCompat() {
    }

    public static Bundle call(
            IContentProvider provider,
            String attributeTag,
            String callingPkg,
            String authority,
            String method,
            String arg,
            Bundle extras
    ) throws RemoteException {
        String pkg = callingPkg != null ? callingPkg : SHELL_PACKAGE;
        if (Build.VERSION.SDK_INT >= 31) {
            try {
                AttributionSource attributionSource = new AttributionSource.Builder(Os.getuid())
                        .setAttributionTag(attributeTag)
                        .setPackageName(pkg)
                        .build();
                return provider.call(attributionSource, authority, method, arg, extras);
            } catch (LinkageError | RuntimeException error) {
                return provider.call(pkg, attributeTag, authority, method, arg, extras);
            }
        } else if (Build.VERSION.SDK_INT == 30) {
            return provider.call(pkg, attributeTag, authority, method, arg, extras);
        } else if (Build.VERSION.SDK_INT == 29) {
            return provider.call(pkg, authority, method, arg, extras);
        } else {
            return provider.call(pkg, method, arg, extras);
        }
    }
}

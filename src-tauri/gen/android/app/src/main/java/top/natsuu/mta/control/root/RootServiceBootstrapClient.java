package top.natsuu.mta.control.root;

import android.content.IContentProvider;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Hands the root service binder back to the app through the exported
 * bootstrap provider.
 *
 * The root process cannot bind to the app directly, so it first asks
 * system_server for the provider binder
 * ({@code getContentProviderExternal}), then calls the provider with the
 * launch token and the service binder. The provider answers with the app
 * lifecycle binder and pid so the root service can watch the app process.
 */
public final class RootServiceBootstrapClient {

    private static final String TAG = "MaaTauriAndroidControl";
    private static final String ACTIVITY_SERVICE_NAME = "activity";
    private static final String ACTIVITY_MANAGER_STUB = "android.app.IActivityManager$Stub";

    private RootServiceBootstrapClient() {
    }

    /** Handshake result: the app lifecycle binder and the app process pid. */
    public record BootstrapResult(IBinder lifecycleBinder, int appPid) {
    }

    public static BootstrapResult attachRemoteService(
            String packageName,
            int userId,
            String token,
            IBinder serviceBinder
    ) {
        String authority = packageName + RootServiceBootstrapRegistry.AUTHORITY_SUFFIX;
        IBinder providerToken = new Binder();
        Object activityManager = null;
        try {
            activityManager = activityManager();
            if (activityManager == null) {
                Log.e(TAG, "Root bootstrap could not reach the activity manager");
                return null;
            }

            IContentProvider provider = getContentProviderExternal(
                    activityManager,
                    authority,
                    userId,
                    providerToken
            );
            if (provider == null) {
                Log.e(TAG, "Root bootstrap provider is null: " + authority + " user=" + userId);
                return null;
            }
            if (!provider.asBinder().pingBinder()) {
                Log.e(TAG, "Root bootstrap provider is dead: " + authority + " user=" + userId);
                return null;
            }

            Bundle extras = new Bundle();
            extras.putString(RootServiceBootstrapRegistry.KEY_TOKEN, token);
            extras.putBinder(RootServiceBootstrapRegistry.KEY_SERVICE_BINDER, serviceBinder);

            Bundle reply = RootIContentProviderCompat.call(
                    provider,
                    null,
                    null,
                    authority,
                    RootServiceBootstrapRegistry.METHOD_ATTACH_REMOTE_SERVICE,
                    null,
                    extras
            );
            if (reply == null) {
                Log.e(TAG, "Root bootstrap provider returned null");
                return null;
            }

            IBinder lifecycleBinder = reply.getBinder(RootServiceBootstrapRegistry.KEY_APP_BINDER);
            if (lifecycleBinder == null || !lifecycleBinder.pingBinder()) {
                Log.e(TAG, "Root bootstrap app lifecycle binder missing or dead");
                return null;
            }
            int appPid = reply.getInt(RootServiceBootstrapRegistry.KEY_APP_PID, 0);
            return new BootstrapResult(lifecycleBinder, appPid);
        } catch (Throwable error) {
            Log.e(TAG, "Failed to send the root service binder back to the app", error);
            return null;
        } finally {
            if (activityManager != null) {
                removeContentProviderExternal(activityManager, authority, providerToken);
            }
        }
    }

    private static Object activityManager() throws Exception {
        Class<?> serviceManager = Class.forName("android.os.ServiceManager");
        Method getService = serviceManager.getDeclaredMethod("getService", String.class);
        IBinder binder = (IBinder) getService.invoke(null, ACTIVITY_SERVICE_NAME);
        if (binder == null) {
            return null;
        }
        Class<?> stub = Class.forName(ACTIVITY_MANAGER_STUB);
        Method asInterface = stub.getMethod("asInterface", IBinder.class);
        return asInterface.invoke(null, binder);
    }

    private static IContentProvider getContentProviderExternal(
            Object activityManager,
            String authority,
            int userId,
            IBinder token
    ) throws Exception {
        Method method = findMethod(
                activityManager.getClass(),
                "getContentProviderExternal",
                String.class,
                int.class,
                IBinder.class,
                String.class
        );
        Object[] arguments;
        if (method != null) {
            arguments = new Object[] {authority, userId, token, authority};
        } else {
            method = findMethod(
                    activityManager.getClass(),
                    "getContentProviderExternal",
                    String.class,
                    int.class,
                    IBinder.class
            );
            if (method == null) {
                Log.e(TAG, "getContentProviderExternal is unavailable on this Android version");
                return null;
            }
            arguments = new Object[] {authority, userId, token};
        }

        Object holder = method.invoke(activityManager, arguments);
        if (holder == null) {
            return null;
        }
        Field providerField = holder.getClass().getDeclaredField("provider");
        providerField.setAccessible(true);
        return (IContentProvider) providerField.get(holder);
    }

    private static void removeContentProviderExternal(
            Object activityManager,
            String authority,
            IBinder token
    ) {
        try {
            Method method = findMethod(
                    activityManager.getClass(),
                    "removeContentProviderExternal",
                    String.class,
                    IBinder.class
            );
            if (method != null) {
                method.invoke(activityManager, authority, token);
            }
        } catch (Throwable error) {
            Log.w(TAG, "Could not release the root bootstrap provider reference", error);
        }
    }

    private static Method findMethod(Class<?> owner, String name, Class<?>... parameterTypes) {
        try {
            return owner.getMethod(name, parameterTypes);
        } catch (NoSuchMethodException ignored) {
            // Fall through to a manual scan: proxy classes sometimes hide the
            // interface methods from Class#getMethod on older runtimes.
        }
        for (Method candidate : owner.getMethods()) {
            if (!candidate.getName().equals(name)) {
                continue;
            }
            Class<?>[] actual = candidate.getParameterTypes();
            if (actual.length != parameterTypes.length) {
                continue;
            }
            boolean matches = true;
            for (int index = 0; index < actual.length; index++) {
                if (actual[index] != parameterTypes[index]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return candidate;
            }
        }
        return null;
    }
}

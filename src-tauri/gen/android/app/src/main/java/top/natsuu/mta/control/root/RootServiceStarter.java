package top.natsuu.mta.control.root;

import android.os.Binder;
import android.os.IBinder;
import android.os.Looper;
import android.os.Parcel;
import android.util.Log;

import top.natsuu.mta.IMaaTauriAndroidControlService;

/**
 * Entry point hosted by {@code /system/bin/app_process}: creates the control
 * service, hands its binder back to the app, then watches the app lifecycle
 * binder so the service is destroyed when the app process dies.
 */
public final class RootServiceStarter {

    private static final String TAG = "MaaTauriAndroidControl";

    /** Reserved Shizuku user-service transaction; TTFlow pins destroy() there too. */
    private static final int DESTROY_TRANSACTION_CODE = 16777114;

    // linkToDeath only watches a BinderProxy while something holds a strong
    // reference to it, so keep both fields alive for the whole process.
    private static IBinder appLifecycleBinder;
    private static IBinder.DeathRecipient appDeathRecipient;

    private RootServiceStarter() {
    }

    public static void main(String[] args) {
        if (Looper.getMainLooper() == null) {
            Looper.prepareMainLooper();
        }

        RootUserService.CreatedService createdService = RootUserService.create(args);
        if (createdService == null) {
            System.exit(1);
            return;
        }
        if (!sendBinder(createdService)) {
            System.exit(1);
            return;
        }

        Looper.loop();
        System.exit(0);
    }

    private static boolean sendBinder(RootUserService.CreatedService createdService) {
        RootServiceBootstrapClient.BootstrapResult result =
                RootServiceBootstrapClient.attachRemoteService(
                        createdService.packageName(),
                        createdService.userId(),
                        createdService.token(),
                        createdService.service()
                );
        if (result == null) {
            return false;
        }

        primeHeartbeat(createdService.service(), result.appPid());

        try {
            IBinder.DeathRecipient recipient = () -> {
                Log.i(TAG, "App process died; destroying the root control service");
                destroyService(createdService.service());
                System.exit(0);
            };
            IBinder lifecycleBinder = result.lifecycleBinder();
            lifecycleBinder.linkToDeath(recipient, 0);
            appLifecycleBinder = lifecycleBinder;
            appDeathRecipient = recipient;
            return true;
        } catch (Throwable error) {
            Log.e(TAG, "Could not link the app lifecycle binder", error);
            return false;
        }
    }

    /**
     * Arms the /proc watchdog before the owner token's death recipient lands.
     * The service polls the pid so it can run its exit cleanup even if the
     * app is hard-killed during the handshake.
     */
    private static void primeHeartbeat(IBinder service, int appPid) {
        if (appPid <= 0) {
            return;
        }
        try {
            IMaaTauriAndroidControlService remote =
                    IMaaTauriAndroidControlService.Stub.asInterface(service);
            if (remote != null) {
                remote.heartbeat(appPid);
            }
        } catch (Throwable error) {
            Log.w(TAG, "Could not prime the root service heartbeat", error);
        }
    }

    private static void destroyService(IBinder service) {
        if (service == null || !service.pingBinder()) {
            return;
        }

        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            String descriptor = service.getInterfaceDescriptor();
            if (descriptor != null) {
                data.writeInterfaceToken(descriptor);
            }
            service.transact(DESTROY_TRANSACTION_CODE, data, reply, Binder.FLAG_ONEWAY);
        } catch (Throwable error) {
            Log.w(TAG, "Could not destroy the root control service", error);
        } finally {
            data.recycle();
            reply.recycle();
        }
    }
}

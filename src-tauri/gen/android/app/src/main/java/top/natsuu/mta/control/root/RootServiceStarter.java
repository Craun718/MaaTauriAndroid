package top.natsuu.mta.control.root;

import android.os.Binder;
import android.os.IBinder;
import android.os.Looper;
import android.os.Parcel;
import android.util.Log;

import top.natsuu.mta.IMaaTauriAndroidControlService;
import top.natsuu.mta.control.OwnerLease;

/**
 * Entry point hosted by {@code /system/bin/app_process}: creates the control
 * service and hands its binder back to the app. The service itself owns the
 * app lifecycle binder supplied by the bootstrap handshake.
 */
public final class RootServiceStarter {

    private static final String TAG = "MaaTauriAndroidControl";

    /** Reserved Shizuku user-service transaction; MaaTauriAndroid pins destroy() there too. */
    private static final int DESTROY_TRANSACTION_CODE = 16777114;

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

        return attachOwner(createdService.service(), result.lifecycleBinder());
    }

    private static boolean attachOwner(IBinder service, IBinder owner) {
        IMaaTauriAndroidControlService remote =
                IMaaTauriAndroidControlService.Stub.asInterface(service);
        if (remote == null) {
            return false;
        }
        int result;
        try {
            result = remote.attachOwner(owner);
        } catch (Throwable error) {
            Log.w(TAG, "Could not attach the root service owner", error);
            destroyService(service);
            return false;
        }
        if (result != OwnerLease.RESULT_ATTACHED) {
            Log.w(TAG, "Root service rejected the owner attach: " + result);
            destroyService(service);
            return false;
        }
        return true;
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

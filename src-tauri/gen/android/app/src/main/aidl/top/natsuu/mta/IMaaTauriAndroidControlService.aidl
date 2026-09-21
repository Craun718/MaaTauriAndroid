package top.natsuu.mta;

import top.natsuu.mta.InputResult;
import top.natsuu.mta.AgentLaunch;

import android.os.ParcelFileDescriptor;
import android.view.Surface;

/**
 * Transaction ids are pinned explicitly and only ever appended: an app upgrade
 * may find a privileged service process from the old build still alive, and
 * both sides talk by transaction code, so inserting or reordering methods
 * would silently misroute calls. destroy() = 16777114 is the transaction id
 * the Shizuku server reserves for user services.
 */
interface IMaaTauriAndroidControlService {
    ParcelFileDescriptor captureFrame(int displayId) = 1;
    int startVirtualDisplay(int width, int height, int dpi, in Surface surface) = 2;
    void stopVirtualDisplay() = 3;
    int dispatchInput(int displayId, int method, int x, int y, int contact, int keyCode,
            in @nullable String text, in @nullable String packageName, boolean forceStop) = 4;
    InputResult dispatchInputDetailed(int displayId, int method, int x, int y, int contact,
            int keyCode, in @nullable String text, in @nullable String packageName,
            boolean forceStop) = 5;
    ParcelFileDescriptor capturePng(int displayId) = 6;
    ParcelFileDescriptor deviceInfo() = 7;
    ParcelFileDescriptor displayState() = 8;
    ParcelFileDescriptor logcat(boolean full) = 9;
    void bugreport(int displayId, in ParcelFileDescriptor destination) = 10;
    String bugreportProgress() = 11;
    ParcelFileDescriptor dumpsys() = 12;
    void cancelBugreport() = 13;
    void prepareAgentRuntime(String descriptorJson, int runtimeIndex,
            in ParcelFileDescriptor piArchive, in ParcelFileDescriptor runtimeBundle) = 14;
    AgentLaunch startAgent(int runtimeIndex, int port,
            String nativeLibraryDir, String executionId, String piEnvironment) = 15;
    void stopAgent(String executionId) = 16;
    void stopAllAgents() = 17;
    int[] setTouchMarkersEnabled(boolean enabled) = 18;
    int protocolVersion() = 19;

    /**
     * Hands the service a process-lifetime binder token from the app. The service
     * links a death recipient to it, so when the app process dies in any way
     * (hard kill, crash, force-stop) the privileged process can still force-stop
     * the target packages and release the virtual display before exiting.
     */
    oneway void registerOwner(in IBinder owner) = 20;

    /**
     * Reports the app pid once, right after the binder arrives. The service
     * polls /proc/<pid> as a fallback owner watchdog: linkToDeath on the owner
     * token is the primary app-death signal, this covers the window before
     * that recipient is registered (or if its notification is lost).
     */
    oneway void heartbeat(int appPid) = 21;

    /**
     * Reserved Shizuku user-service transaction: the server invokes it when it
     * unbinds the service, including after the app process died. The service runs
     * its exit cleanup and stops itself instead of leaking a shell-uid process.
     */
    oneway void destroy() = 16777114;
}

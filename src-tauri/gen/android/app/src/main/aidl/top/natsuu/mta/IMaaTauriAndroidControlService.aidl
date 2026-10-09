package top.natsuu.mta;

import top.natsuu.mta.InputResult;
import top.natsuu.mta.AgentLaunch;

import android.os.ParcelFileDescriptor;
import android.view.Surface;

/**
 * Transaction ids are pinned explicitly. destroy() = 16777114 is the
 * transaction id the Shizuku server reserves for user services.
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

    /**
     * Claims the service for one app process by handing over a process-lifetime
     * owner binder. The acknowledgement proves that death watching is armed
     * before stateful calls are allowed; when the owner dies, the service runs
     * its cleanup and exits.
     *
     * Returns 0 when attached, or a nonzero OwnerLease result on rejection.
     */
    int attachOwner(in IBinder owner) = 19;

    /**
     * Force-stops the target packages recorded on the virtual display during
     * the run. The privileged side is the only one that knows which apps were
     * actually launched, so no package name travels from the app. Returns
     * false when nothing was recorded or a stop failed; failed stops stay
     * recorded for exit cleanup to retry.
     */
    boolean stopTargetApp() = 20;

    /**
     * Samples the current game frame rate for the packages recorded on the
     * virtual display. Returns -1 when nothing is being monitored (no target
     * package, no matching task, or the device lacks the frame-rate callback);
     * 0 means the display went silent. The app polls this once a second while
     * a run is active.
     */
    float gameFps() = 21;

    /**
     * Reports the state of the controlled display for run diagnostics: which
     * target packages are recorded, whether their tasks still exist and on
     * which display, what the top package on the display is, and whether the
     * virtual display is still alive. Returns a JSON string; a binder failure
     * means the caller skips diagnostics entirely (same fallback contract as
     * gameFps).
     */
    String targetAppState(int displayId) = 22;

    /**
     * Temporarily disables networking for Xiaomi's XMSF service while a
     * HyperOS focus notification is active. The package is fixed on the
     * privileged side so this cannot be reused to block arbitrary packages.
     */
    boolean setXmsfNetworkingEnabled(boolean enabled) = 23;

    /**
     * Reports whether Honor's smart-resolution setting is enabled. It is read
     * with the privileged service's shell identity because background virtual
     * displays use the reduced render resolution and can break recognition.
     */
    boolean isSmartResolutionEnabled() = 24;

    /**
     * Reserved Shizuku user-service transaction: the server invokes it when it
     * unbinds the service, including after the app process died. The service runs
     * its exit cleanup and stops itself instead of leaking a shell-uid process.
     */
    oneway void destroy() = 16777114;
}

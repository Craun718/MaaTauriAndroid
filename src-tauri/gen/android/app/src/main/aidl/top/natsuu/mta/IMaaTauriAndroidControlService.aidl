package top.natsuu.mta;

import top.natsuu.mta.InputResult;
import top.natsuu.mta.AgentLaunch;

import android.os.ParcelFileDescriptor;

interface IMaaTauriAndroidControlService {
    ParcelFileDescriptor captureFrame(int displayId);
    int dispatchInput(int displayId, int method, int x, int y, int contact, int keyCode,
            in @nullable String text, in @nullable String packageName, boolean forceStop);
    InputResult dispatchInputDetailed(int displayId, int method, int x, int y, int contact,
            int keyCode, in @nullable String text, in @nullable String packageName,
            boolean forceStop);
    ParcelFileDescriptor capturePng(int displayId);
    ParcelFileDescriptor deviceInfo();
    ParcelFileDescriptor displayState();
    ParcelFileDescriptor logcat(boolean full);
    void bugreport(int displayId, in ParcelFileDescriptor destination);
    String bugreportProgress();
    ParcelFileDescriptor dumpsys();
    void cancelBugreport();
    void prepareAgentRuntime(String descriptorJson, String fingerprint, int runtimeIndex,
            in ParcelFileDescriptor piArchive, in ParcelFileDescriptor runtimeBundle);
    AgentLaunch startAgent(String fingerprint, int runtimeIndex, int port,
            String nativeLibraryDir, String executionId);
    void stopAgent(String executionId);
    void stopAllAgents();
    int protocolVersion();
}

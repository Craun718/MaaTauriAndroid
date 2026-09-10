package top.natsuu.ttflow;

import top.natsuu.ttflow.InputResult;

import android.os.ParcelFileDescriptor;

interface ITtflowControlService {
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
    int protocolVersion();
}

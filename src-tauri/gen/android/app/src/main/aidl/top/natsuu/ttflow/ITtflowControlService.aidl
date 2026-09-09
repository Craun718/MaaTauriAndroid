package top.natsuu.ttflow;

import android.os.ParcelFileDescriptor;

interface ITtflowControlService {
    ParcelFileDescriptor captureFrame(int displayId);
    int dispatchInput(int displayId, int method, int x, int y, int contact, int keyCode,
            in @nullable String text, in @nullable String packageName, boolean forceStop);
    int protocolVersion();
}

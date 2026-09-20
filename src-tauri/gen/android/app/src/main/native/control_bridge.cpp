#include <android/log.h>
#include <jni.h>

#include "virtual_display.hpp"

#include <cerrno>
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <mutex>
#include <unistd.h>
#include <utility>
#include <vector>

namespace {

constexpr auto kLogTag = "MaaTauriAndroidControl";

enum MethodType : int {
    START_GAME = 1,
    STOP_GAME = 2,
    INPUT = 4,
    TOUCH_DOWN = 6,
    TOUCH_MOVE = 7,
    TOUCH_UP = 8,
    KEY_DOWN = 9,
    KEY_UP = 10,
};

struct Position {
    int x = 0;
    int y = 0;
};

struct StartGameArgs {
    const char* package_name = nullptr;
    int force_stop = 0;
};

struct StopGameArgs {
    const char* client_type = nullptr;
};

struct InputArgs {
    const char* text = nullptr;
};

struct TouchArgs {
    Position p {};
    int contact = 0;
};

struct KeyArgs {
    int key_code = 0;
};

union ArgUnion {
    StartGameArgs start_game;
    StopGameArgs stop_game;
    InputArgs input;
    TouchArgs touch;
    KeyArgs key;
};

struct MethodParam {
    int display_id = 0;
    MethodType method = START_GAME;
    ArgUnion args {};
};

class ThreadGuard {
public:
    ThreadGuard(JavaVM* vm, bool attached) : vm_(vm), attached_(attached) {}

    ThreadGuard(const ThreadGuard&) = delete;
    ThreadGuard& operator=(const ThreadGuard&) = delete;

    ~ThreadGuard() {
        if (attached_ && vm_ != nullptr) {
            vm_->DetachCurrentThread();
        }
    }

private:
    JavaVM* vm_;
    bool attached_;
};

JavaVM* g_vm = nullptr;
jobject g_service = nullptr;
jmethodID g_capture_method = nullptr;
jmethodID g_start_virtual_display_method = nullptr;
jmethodID g_stop_virtual_display_method = nullptr;
jmethodID g_detach_fd_method = nullptr;
jmethodID g_dispatch_method = nullptr;
jmethodID g_dispatch_detailed_method = nullptr;
std::mutex g_state_mutex;
std::mutex g_frame_mutex;
std::vector<uint8_t> g_frame_buffer;
bool g_frame_locked = false;
int g_capture_fd = -1;
jint g_display_id = 0;
jint g_width = 0;
jint g_height = 0;

class AttachedEnv {
public:
    AttachedEnv() {
        if (g_vm == nullptr) {
            return;
        }
        if (g_vm->GetEnv(reinterpret_cast<void**>(&env_), JNI_VERSION_1_6) == JNI_OK) {
            return;
        }
        env_ = nullptr;

        JavaVMAttachArgs args {
            .version = JNI_VERSION_1_6,
            .name = "MaaTauriAndroidMaaBridge",
            .group = nullptr,
        };
        if (g_vm->AttachCurrentThread(&env_, &args) == JNI_OK) {
            guard_ = std::make_unique<ThreadGuard>(g_vm, true);
        }
    }

    JNIEnv* get() const { return env_; }

private:
    JNIEnv* env_ = nullptr;
    std::unique_ptr<ThreadGuard> guard_;
};

bool clear_exception(JNIEnv& env) {
    if (env.ExceptionCheck() != JNI_TRUE) {
        return false;
    }
    env.ExceptionDescribe();
    env.ExceptionClear();
    return true;
}

void log_input_failure(
    int display_id,
    int method,
    int x,
    int y,
    int contact,
    int key_code,
    size_t text_length,
    jint result,
    const char* message
) {
    __android_log_print(
        ANDROID_LOG_WARN,
        kLogTag,
        "Input failed displayId=%d method=%d x=%d y=%d contact=%d keyCode=%d "
        "textLength=%zu result=%d message=%s",
        display_id,
        method,
        x,
        y,
        contact,
        key_code,
        text_length,
        static_cast<int>(result),
        message
    );
}

void close_service_locked(JNIEnv& env) {
    if (g_service != nullptr) {
        env.DeleteGlobalRef(g_service);
        g_service = nullptr;
    }
    g_capture_method = nullptr;
    g_start_virtual_display_method = nullptr;
    g_stop_virtual_display_method = nullptr;
    g_detach_fd_method = nullptr;
    g_dispatch_method = nullptr;
    g_dispatch_detailed_method = nullptr;
}

jmethodID resolve_detach_fd_method(JNIEnv& env) {
    jclass descriptor_class = env.FindClass("android/os/ParcelFileDescriptor");
    jmethodID method = nullptr;
    if (descriptor_class != nullptr) {
        method = env.GetMethodID(descriptor_class, "detachFd", "()I");
        env.DeleteLocalRef(descriptor_class);
    }
    clear_exception(env);
    return method;
}

bool read_all(int fd, std::vector<uint8_t>& buffer) {
    size_t offset = 0;
    while (offset < buffer.size()) {
        const ssize_t count = read(fd, buffer.data() + offset, buffer.size() - offset);
        if (count == 0) {
            return false;
        }
        if (count < 0) {
            if (errno == EINTR) {
                continue;
            }
            return false;
        }
        offset += static_cast<size_t>(count);
    }
    return true;
}

} // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

extern "C" FrameInfo GetLockedPixels() {
    if (virtual_display::active()) {
        return virtual_display::lock_frame();
    }

    AttachedEnv attached;
    JNIEnv* env_ptr = attached.get();
    if (env_ptr == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, kLogTag, "JNI environment is unavailable");
        return {};
    }
    JNIEnv& env = *env_ptr;

    std::lock_guard<std::mutex> frame_lock(g_frame_mutex);
    if (g_frame_locked) {
        return {};
    }

    jint display_id = 0;
    jint width = 0;
    jint height = 0;
    {
        std::lock_guard<std::mutex> state_lock(g_state_mutex);
        jobject service = g_service;
        display_id = g_display_id;
        width = g_width;
        height = g_height;
        if (service == nullptr || g_capture_method == nullptr || g_detach_fd_method == nullptr ||
            width <= 0 || height <= 0) {
            return {};
        }

        jobject parcel_descriptor = env.CallObjectMethod(service, g_capture_method, display_id);
        if (clear_exception(env) || parcel_descriptor == nullptr) {
            return {};
        }

        const jint fd_value = env.CallIntMethod(parcel_descriptor, g_detach_fd_method);
        env.DeleteLocalRef(parcel_descriptor);
        if (clear_exception(env)) {
            if (fd_value >= 0) {
                close(fd_value);
            }
            return {};
        }
        if (fd_value < 0) {
            return {};
        }
        g_capture_fd = fd_value;
    }

    const int fd = std::exchange(g_capture_fd, -1);
    if (fd < 0) {
        return {};
    }

    const uint64_t byte_count = static_cast<uint64_t>(static_cast<uint32_t>(width)) *
                                static_cast<uint32_t>(height) * 4U;
    if (byte_count > std::numeric_limits<uint32_t>::max() ||
        byte_count > static_cast<uint64_t>(std::numeric_limits<size_t>::max())) {
        close(fd);
        return {};
    }

    std::vector<uint8_t> rgba_pixels(static_cast<size_t>(byte_count));
    const bool read_succeeded = read_all(fd, rgba_pixels);
    close(fd);
    if (!read_succeeded) {
        return {};
    }

    std::vector<uint8_t> bgr_pixels(static_cast<size_t>(width) *
                                    static_cast<size_t>(height) * 3U);
    virtual_display::copy_rgba_to_bgr(
        rgba_pixels.data(),
        static_cast<size_t>(width) * 4U,
        bgr_pixels.data(),
        static_cast<size_t>(width) * 3U,
        width,
        height
    );

    FrameInfo info;
    info.width = static_cast<uint32_t>(width);
    info.height = static_cast<uint32_t>(height);
    info.stride = static_cast<uint32_t>(width) * 3U;
    info.length = static_cast<uint32_t>(bgr_pixels.size());
    info.data = bgr_pixels.data();
    info.frame_ref = bgr_pixels.data();

    g_frame_buffer = std::move(bgr_pixels);
    g_frame_locked = true;
    return info;
}

extern "C" int UnlockPixels(FrameInfo frame) {
    if (virtual_display::is_frame(frame.frame_ref)) {
        return virtual_display::unlock_frame(frame);
    }

    std::lock_guard<std::mutex> frame_lock(g_frame_mutex);
    if (!g_frame_locked || frame.data == nullptr || frame.data != frame.frame_ref ||
        frame.data != g_frame_buffer.data()) {
        return -1;
    }

    g_frame_buffer.clear();
    g_frame_buffer.shrink_to_fit();
    g_frame_locked = false;
    return 0;
}

extern "C" JNIEXPORT jint JNICALL
Java_top_natsuu_mta_control_ControlHost_startVirtualDisplay(
    JNIEnv* env,
    jclass /*clazz*/,
    jint width,
    jint height,
    jint dpi
) {
    if (env == nullptr) {
        return -1;
    }
    std::lock_guard<std::mutex> state_lock(g_state_mutex);
    if (g_service == nullptr || g_start_virtual_display_method == nullptr) {
        return -1;
    }
    return virtual_display::start(
        *env, g_service, g_start_virtual_display_method, width, height, dpi
    );
}

extern "C" JNIEXPORT void JNICALL
Java_top_natsuu_mta_control_ControlHost_stopVirtualDisplay(JNIEnv* env, jclass /*clazz*/) {
    if (env == nullptr) {
        return;
    }
    jobject service = nullptr;
    jmethodID stop_method = nullptr;
    {
        std::lock_guard<std::mutex> state_lock(g_state_mutex);
        service = g_service;
        stop_method = g_stop_virtual_display_method;
    }
    virtual_display::stop(*env, service, stop_method);
}

extern "C" JNIEXPORT jintArray JNICALL
Java_top_natsuu_mta_control_ControlHost_virtualDisplayStatus(JNIEnv* env, jclass /*clazz*/) {
    if (env == nullptr) {
        return nullptr;
    }

    int32_t display_id = -1;
    int32_t width = 0;
    int32_t height = 0;
    virtual_display::geometry(display_id, width, height);
    const jint frame_count = static_cast<jint>(std::min<int64_t>(
        virtual_display::frame_count(),
        std::numeric_limits<jint>::max()
    ));
    const jint status[] = {
        virtual_display::active() ? 1 : 0,
        display_id,
        width,
        height,
        frame_count,
    };
    constexpr jsize status_length = static_cast<jsize>(sizeof(status) / sizeof(status[0]));
    jintArray result = env->NewIntArray(status_length);
    if (clear_exception(*env) || result == nullptr) {
        return nullptr;
    }
    env->SetIntArrayRegion(result, 0, status_length, status);
    if (clear_exception(*env)) {
        env->DeleteLocalRef(result);
        return nullptr;
    }
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_top_natsuu_mta_control_ControlHost_attachPreviewSurface(
    JNIEnv* env,
    jclass /*clazz*/,
    jobject surface
) {
    if (env == nullptr) {
        return;
    }
    virtual_display::attach_preview(*env, surface);
}

extern "C" int DispatchInputMessage(MethodParam param) {
    AttachedEnv attached;
    JNIEnv* env_ptr = attached.get();
    if (env_ptr == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, kLogTag, "JNI environment is unavailable for input");
        return -1;
    }
    JNIEnv& env = *env_ptr;

    std::lock_guard<std::mutex> state_lock(g_state_mutex);
    if (g_service == nullptr || (g_dispatch_method == nullptr && g_dispatch_detailed_method == nullptr)) {
        __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Control service is unavailable for input");
        return -1;
    }

    const char* first_text = nullptr;
    int x = 0;
    int y = 0;
    int contact = 0;
    int key_code = 0;
    jboolean force_stop = JNI_FALSE;

    switch (param.method) {
    case START_GAME:
        first_text = param.args.start_game.package_name;
        force_stop = param.args.start_game.force_stop != 0 ? JNI_TRUE : JNI_FALSE;
        if (first_text == nullptr) {
            return -1;
        }
        break;
    case STOP_GAME:
        first_text = param.args.stop_game.client_type;
        break;
    case INPUT:
        first_text = param.args.input.text;
        break;
    case TOUCH_DOWN:
    case TOUCH_MOVE:
    case TOUCH_UP:
        x = param.args.touch.p.x;
        y = param.args.touch.p.y;
        contact = param.args.touch.contact;
        break;
    case KEY_DOWN:
    case KEY_UP:
        key_code = param.args.key.key_code;
        break;
    default:
        return -1;
    }

    jstring text = nullptr;
    jstring package_name = nullptr;
    if (first_text != nullptr) {
        text = env.NewStringUTF(first_text);
        if (clear_exception(env) || text == nullptr) {
            __android_log_print(
                ANDROID_LOG_ERROR, kLogTag, "Could not create Java input string");
            return -1;
        }
    }
    if (param.method == START_GAME) {
        package_name = text;
        text = nullptr;
    }

    const size_t text_length =
        first_text == nullptr ? 0U : static_cast<size_t>(std::strlen(first_text));
    jint result = -1;
    // Only fall back before a detailed Binder call has been made. Replaying an
    // input after a post-call decoding error could inject the same event twice.
    bool use_fallback = g_dispatch_detailed_method == nullptr;

    if (g_dispatch_detailed_method != nullptr) {
        jobject detailed_result = env.CallObjectMethod(
            g_service,
            g_dispatch_detailed_method,
            static_cast<jint>(param.display_id),
            static_cast<jint>(param.method),
            static_cast<jint>(x),
            static_cast<jint>(y),
            static_cast<jint>(contact),
            static_cast<jint>(key_code),
            text,
            package_name,
            force_stop
        );
        if (clear_exception(env) || detailed_result == nullptr) {
            __android_log_print(
                ANDROID_LOG_WARN,
                kLogTag,
                "Detailed input dispatch failed"
            );
        } else {
            jclass result_class = env.GetObjectClass(detailed_result);
            jfieldID code_field = result_class == nullptr
                ? nullptr
                : env.GetFieldID(result_class, "code", "I");
            jfieldID message_field = result_class == nullptr || code_field == nullptr
                ? nullptr
                : env.GetFieldID(result_class, "message", "Ljava/lang/String;");
            if (clear_exception(env) || code_field == nullptr || message_field == nullptr) {
                __android_log_print(
                    ANDROID_LOG_WARN,
                    kLogTag,
                    "Could not read InputResult fields"
                );
            } else {
                result = env.GetIntField(detailed_result, code_field);
                if (clear_exception(env)) {
                    result = -1;
                } else {
                    auto message = static_cast<jstring>(env.GetObjectField(detailed_result, message_field));
                    if (clear_exception(env)) {
                        __android_log_print(
                            ANDROID_LOG_WARN, kLogTag, "Could not read InputResult message");
                    } else if (result != 0) {
                        const char* message_bytes =
                            message == nullptr ? nullptr : env.GetStringUTFChars(message, nullptr);
                        if (message_bytes == nullptr && message != nullptr) {
                            __android_log_print(
                                ANDROID_LOG_WARN, kLogTag, "Could not decode InputResult message");
                        } else {
                            log_input_failure(
                                param.display_id,
                                static_cast<int>(param.method),
                                x,
                                y,
                                contact,
                                key_code,
                                text_length,
                                result,
                                message_bytes == nullptr ? "unavailable" : message_bytes
                            );
                        }
                        if (message_bytes != nullptr) {
                            env.ReleaseStringUTFChars(message, message_bytes);
                        }
                    }
                    if (message != nullptr) {
                        env.DeleteLocalRef(message);
                    }
                    use_fallback = false;
                }
            }
            if (result_class != nullptr) {
                env.DeleteLocalRef(result_class);
            }
        }
        if (detailed_result != nullptr) {
            env.DeleteLocalRef(detailed_result);
        }
    }

    if (use_fallback) {
        if (g_dispatch_method == nullptr) {
            __android_log_print(
                ANDROID_LOG_ERROR, kLogTag, "Legacy input dispatch method is unavailable");
            result = -1;
        } else {
            result = env.CallIntMethod(
                g_service,
                g_dispatch_method,
                static_cast<jint>(param.display_id),
                static_cast<jint>(param.method),
                static_cast<jint>(x),
                static_cast<jint>(y),
                static_cast<jint>(contact),
                static_cast<jint>(key_code),
                text,
                package_name,
                force_stop
            );
            if (clear_exception(env)) {
                __android_log_print(ANDROID_LOG_ERROR, kLogTag, "Legacy input dispatch JNI call failed");
                result = -1;
            } else if (result != 0) {
                log_input_failure(
                    param.display_id,
                    static_cast<int>(param.method),
                    x,
                    y,
                    contact,
                    key_code,
                    text_length,
                    result,
                    "legacy dispatch rejected the input"
                );
            }
        }
    }

    if (text != nullptr) {
        env.DeleteLocalRef(text);
    }
    if (package_name != nullptr) {
        env.DeleteLocalRef(package_name);
    }
    clear_exception(env);
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_top_natsuu_mta_control_ControlHost_configure(
    JNIEnv* env,
    jclass /*clazz*/,
    jint display_id,
    jint width,
    jint height
) {
    if (env == nullptr) {
        return;
    }
    std::lock_guard<std::mutex> state_lock(g_state_mutex);
    g_display_id = display_id;
    g_width = width;
    g_height = height;
}

extern "C" JNIEXPORT void JNICALL
Java_top_natsuu_mta_control_ControlHost_attachNative(JNIEnv* env, jclass /*clazz*/, jobject service) {
    if (env == nullptr) {
        return;
    }

    virtual_display::release_local();
    std::lock_guard<std::mutex> state_lock(g_state_mutex);
    close_service_locked(*env);
    if (service == nullptr) {
        return;
    }

    jobject global_service = env->NewGlobalRef(service);
    if (clear_exception(*env) || global_service == nullptr) {
        return;
    }

    jclass service_class = env->GetObjectClass(global_service);
    if (service_class != nullptr) {
        g_capture_method = env->GetMethodID(
            service_class,
            "captureFrame",
            "(I)Landroid/os/ParcelFileDescriptor;");
        clear_exception(*env);
        g_start_virtual_display_method = env->GetMethodID(
            service_class,
            "startVirtualDisplay",
            "(IIILandroid/view/Surface;)I");
        clear_exception(*env);
        g_stop_virtual_display_method = env->GetMethodID(
            service_class,
            "stopVirtualDisplay",
            "()V");
        clear_exception(*env);
        g_dispatch_method = env->GetMethodID(
            service_class,
            "dispatchInput",
            "(IIIIIILjava/lang/String;Ljava/lang/String;Z)I");
        clear_exception(*env);
        g_dispatch_detailed_method = env->GetMethodID(
            service_class,
            "dispatchInputDetailed",
            "(IIIIIILjava/lang/String;Ljava/lang/String;Z)Ltop/natsuu/mta/InputResult;");
        clear_exception(*env);
        env->DeleteLocalRef(service_class);
    }
    g_detach_fd_method = resolve_detach_fd_method(*env);

    if (g_capture_method == nullptr || g_detach_fd_method == nullptr ||
        (g_dispatch_method == nullptr && g_dispatch_detailed_method == nullptr)) {
        __android_log_print(
            ANDROID_LOG_ERROR,
            kLogTag,
            "Control service methods are unavailable capture=%d detach=%d legacy=%d detailed=%d",
            g_capture_method == nullptr ? 0 : 1,
            g_detach_fd_method == nullptr ? 0 : 1,
            g_dispatch_method == nullptr ? 0 : 1,
            g_dispatch_detailed_method == nullptr ? 0 : 1
        );
        env->DeleteGlobalRef(global_service);
    } else {
        g_service = global_service;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_top_natsuu_mta_control_ControlHost_detachNative(JNIEnv* env, jclass /*clazz*/) {
    if (env == nullptr) {
        return;
    }
    virtual_display::release_local();
    std::lock_guard<std::mutex> state_lock(g_state_mutex);
    close_service_locked(*env);
}

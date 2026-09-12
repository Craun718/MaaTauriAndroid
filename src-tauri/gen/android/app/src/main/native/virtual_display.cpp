#include "virtual_display.hpp"

#include <android/hardware_buffer.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <media/NdkImage.h>
#include <media/NdkImageReader.h>

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <queue>
#include <thread>
#include <utility>
#include <vector>

namespace {

constexpr auto kLogTag = "MaaTauriAndroidControl";
constexpr size_t kFrameBufferCount = 3;

struct FrameBuffer {
    std::vector<uint8_t> pixels;
    bool locked = false;
};

struct VirtualState {
    std::mutex mutex;
    FrameBuffer buffers[kFrameBufferCount];
    int latest = -1;
    int32_t display_id = -1;
    int32_t width = 0;
    int32_t height = 0;
};

VirtualState g_state;
AImageReader* g_reader = nullptr;
std::mutex g_reader_mutex;
std::condition_variable g_frames_idle;
std::atomic<int64_t> g_frame_count {0};
std::atomic<bool> g_active {false};

void log_error(const char* function, const char* message, int code = 0) {
    __android_log_print(ANDROID_LOG_ERROR, kLogTag, "%s: %s code=%d", function, message, code);
}

void seed_frames_locked(int32_t width, int32_t height) {
    const size_t size = static_cast<size_t>(width) * static_cast<size_t>(height) * 4U;
    for (FrameBuffer& buffer : g_state.buffers) {
        buffer.pixels.assign(size, 0);
        buffer.locked = false;
    }
    g_state.latest = 0;
    g_state.width = width;
    g_state.height = height;
}

void store_frame(const uint8_t* pixels, int32_t width, int32_t height, size_t stride_bytes) {
    if (pixels == nullptr || width <= 0 || height <= 0) {
        return;
    }

    std::lock_guard<std::mutex> lock(g_state.mutex);
    if (!g_active.load(std::memory_order_acquire) || g_state.width != width ||
        g_state.height != height) {
        return;
    }

    int target = -1;
    for (size_t index = 0; index < kFrameBufferCount; ++index) {
        const auto slot = static_cast<int>(index);
        if (!g_state.buffers[index].locked && slot != g_state.latest) {
            target = slot;
            break;
        }
    }
    if (target < 0) {
        return;
    }

    const size_t row_bytes = static_cast<size_t>(width) * 4U;
    uint8_t* destination = g_state.buffers[target].pixels.data();
    if (destination == nullptr || g_state.buffers[target].pixels.size() < row_bytes * height) {
        return;
    }
    for (int32_t row = 0; row < height; ++row) {
        std::memcpy(
            destination + static_cast<size_t>(row) * row_bytes,
            pixels + static_cast<size_t>(row) * stride_bytes,
            row_bytes
        );
    }
    g_state.latest = target;
    g_frame_count.fetch_add(1, std::memory_order_release);
}

void copy_hardware_frame(AImage* image) {
    AHardwareBuffer* buffer = nullptr;
    if (AImage_getHardwareBuffer(image, &buffer) != AMEDIA_OK || buffer == nullptr) {
        return;
    }

    AHardwareBuffer_Desc description {};
    AHardwareBuffer_describe(buffer, &description);
    int32_t image_width = 0;
    int32_t image_height = 0;
    int32_t image_stride = 0;
    if (AImage_getWidth(image, &image_width) != AMEDIA_OK ||
        AImage_getHeight(image, &image_height) != AMEDIA_OK ||
        AImage_getPlaneRowStride(image, &image_stride) != AMEDIA_OK) {
        return;
    }

    void* pixels = nullptr;
    if (AHardwareBuffer_lock(
            buffer,
            AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN,
            -1,
            nullptr,
            &pixels
        ) != 0 || pixels == nullptr) {
        log_error("copy_hardware_frame", "could not lock the hardware buffer");
        return;
    }
    store_frame(
        static_cast<const uint8_t*>(pixels),
        image_width,
        image_height,
        static_cast<size_t>(image_stride)
    );
    AHardwareBuffer_unlock(buffer, nullptr);
}

bool dispatch_preview(AImage* image);

void on_image_available(void* /*context*/, AImageReader* reader) {
    std::lock_guard<std::mutex> reader_lock(g_reader_mutex);
    AImage* image = nullptr;
    if (AImageReader_acquireLatestImage(reader, &image) != AMEDIA_OK || image == nullptr) {
        return;
    }

    copy_hardware_frame(image);
    if (!dispatch_preview(image)) {
        AImage_delete(image);
    }
}

void stop_preview();

void release_reader() {
    // Callback and release both take the reader lock before the frame-state lock.
    std::lock_guard<std::mutex> reader_lock(g_reader_mutex);
    std::lock_guard<std::mutex> state_lock(g_state.mutex);
    if (g_reader != nullptr) {
        AImageReader_setImageListener(g_reader, nullptr);
        AImageReader_delete(g_reader);
        g_reader = nullptr;
    }
}

} // namespace

namespace virtual_display {

jint start(
    JNIEnv& env,
    jobject service,
    jmethodID start_method,
    jint width,
    jint height,
    jint dpi
) {
    if (service == nullptr || start_method == nullptr || width <= 0 || height <= 0 || dpi <= 0) {
        return -1;
    }

    release_local();

    AImageReader* reader = nullptr;
    const media_status_t status = AImageReader_newWithUsage(
        width,
        height,
        AIMAGE_FORMAT_RGBA_8888,
        AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN | AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE,
        3,
        &reader
    );
    if (status != AMEDIA_OK || reader == nullptr) {
        log_error("virtual_display_start", "could not create AImageReader", status);
        return -1;
    }

    AImageReader_ImageListener listener {};
    listener.onImageAvailable = on_image_available;
    if (AImageReader_setImageListener(reader, &listener) != AMEDIA_OK) {
        log_error("virtual_display_start", "could not set the image listener");
        AImageReader_delete(reader);
        return -1;
    }

    ANativeWindow* window = nullptr;
    if (AImageReader_getWindow(reader, &window) != AMEDIA_OK || window == nullptr) {
        log_error("virtual_display_start", "could not get the reader window");
        AImageReader_setImageListener(reader, nullptr);
        AImageReader_delete(reader);
        return -1;
    }
    jobject surface = ANativeWindow_toSurface(&env, window);
    if (env.ExceptionCheck() == JNI_TRUE || surface == nullptr) {
        env.ExceptionDescribe();
        env.ExceptionClear();
        AImageReader_setImageListener(reader, nullptr);
        AImageReader_delete(reader);
        return -1;
    }

    const jint display_id =
        env.CallIntMethod(service, start_method, width, height, dpi, surface);
    const bool failed = env.ExceptionCheck() == JNI_TRUE;
    if (failed) {
        env.ExceptionDescribe();
        env.ExceptionClear();
    }
    env.DeleteLocalRef(surface);
    if (failed || display_id < 0) {
        AImageReader_setImageListener(reader, nullptr);
        AImageReader_delete(reader);
        return -1;
    }

    {
        std::lock_guard<std::mutex> reader_lock(g_reader_mutex);
        std::lock_guard<std::mutex> lock(g_state.mutex);
        seed_frames_locked(width, height);
        g_state.display_id = display_id;
        g_reader = reader;
    }
    g_frame_count.store(0, std::memory_order_release);
    g_active.store(true, std::memory_order_release);
    return display_id;
}

jint stop(JNIEnv& env, jobject service, jmethodID stop_method) {
    g_active.store(false, std::memory_order_release);
    if (service != nullptr && stop_method != nullptr) {
        env.CallVoidMethod(service, stop_method);
        if (env.ExceptionCheck() == JNI_TRUE) {
            env.ExceptionDescribe();
            env.ExceptionClear();
        }
    }
    release_local();
    return 0;
}

void release_local() {
    g_active.store(false, std::memory_order_release);
    stop_preview();
    {
        std::unique_lock<std::mutex> lock(g_state.mutex);
        g_frames_idle.wait(lock, [] {
            for (const FrameBuffer& buffer : g_state.buffers) {
                if (buffer.locked) {
                    return false;
                }
            }
            return true;
        });
    }
    release_reader();
    {
        std::lock_guard<std::mutex> lock(g_state.mutex);
        for (FrameBuffer& buffer : g_state.buffers) {
            buffer.locked = false;
        }
        g_state.latest = -1;
        g_state.display_id = -1;
        g_state.width = 0;
        g_state.height = 0;
    }
    g_frame_count.store(0, std::memory_order_release);
}

bool active() {
    return g_active.load(std::memory_order_acquire);
}

bool is_frame(const void* frame_ref) {
    if (frame_ref == nullptr) {
        return false;
    }
    std::lock_guard<std::mutex> lock(g_state.mutex);
    for (const FrameBuffer& buffer : g_state.buffers) {
        if (&buffer == frame_ref) {
            return true;
        }
    }
    return false;
}

void geometry(int32_t& display_id, int32_t& width, int32_t& height) {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    display_id = g_state.display_id;
    width = g_state.width;
    height = g_state.height;
}

int64_t frame_count() {
    return g_frame_count.load(std::memory_order_acquire);
}

FrameInfo lock_frame() {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    if (!g_active.load(std::memory_order_acquire) || g_state.latest < 0) {
        return {};
    }

    FrameBuffer& buffer = g_state.buffers[g_state.latest];
    if (buffer.locked || buffer.pixels.empty()) {
        return {};
    }
    buffer.locked = true;

    FrameInfo frame;
    frame.width = static_cast<uint32_t>(g_state.width);
    frame.height = static_cast<uint32_t>(g_state.height);
    frame.stride = frame.width * 4U;
    frame.length = static_cast<uint32_t>(buffer.pixels.size());
    frame.data = buffer.pixels.data();
    frame.frame_ref = &buffer;
    return frame;
}

int unlock_frame(FrameInfo frame) {
    std::lock_guard<std::mutex> lock(g_state.mutex);
    auto* buffer = static_cast<FrameBuffer*>(frame.frame_ref);
    if (buffer == nullptr || !buffer->locked || buffer->pixels.data() != frame.data) {
        return -1;
    }
    buffer->locked = false;
    g_frames_idle.notify_all();
    return 0;
}

} // namespace virtual_display

namespace {

struct EglState {
    EGLDisplay display = EGL_NO_DISPLAY;
    EGLConfig config = nullptr;
    EGLContext context = EGL_NO_CONTEXT;
    EGLSurface surface = EGL_NO_SURFACE;
    GLuint program = 0;
    GLuint texture = 0;
};

PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC get_native_client_buffer = nullptr;
PFNEGLCREATEIMAGEKHRPROC create_egl_image = nullptr;
PFNEGLDESTROYIMAGEKHRPROC destroy_egl_image = nullptr;
PFNGLEGLIMAGETARGETTEXTURE2DOESPROC image_target_texture = nullptr;

EglState g_egl;
std::mutex g_preview_mutex;
std::mutex g_render_mutex;
std::condition_variable g_render_condition;
std::thread g_render_thread;
std::queue<AImage*> g_render_queue;
ANativeWindow* g_pending_window = nullptr;
bool g_pending_detach = false;
std::atomic<bool> g_preview_enabled {false};
std::atomic<bool> g_render_running {false};

const char* kVertexShader = R"(
attribute vec4 position;
attribute vec2 tex_coord;
varying vec2 fragment_tex_coord;
void main() {
    gl_Position = position;
    fragment_tex_coord = tex_coord;
}
)";

const char* kFragmentShader = R"(
#extension GL_OES_EGL_image_external : require
precision mediump float;
uniform samplerExternalOES texture_unit;
varying vec2 fragment_tex_coord;
void main() {
    gl_FragColor = texture2D(texture_unit, fragment_tex_coord);
}
)";

GLuint load_shader(GLenum type, const char* source) {
    const GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    GLint compiled = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
    if (compiled == GL_FALSE) {
        log_error("load_shader", "shader compilation failed");
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

bool ensure_egl_display() {
    if (g_egl.display != EGL_NO_DISPLAY) {
        return true;
    }
    EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (display == EGL_NO_DISPLAY || eglInitialize(display, nullptr, nullptr) == EGL_FALSE) {
        log_error("ensure_egl_display", "eglInitialize failed", eglGetError());
        return false;
    }

    const EGLint attributes[] = {
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_BLUE_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_RED_SIZE, 8,
        EGL_NONE,
    };
    EGLint count = 0;
    if (eglChooseConfig(display, attributes, &g_egl.config, 1, &count) == EGL_FALSE ||
        count <= 0) {
        log_error("ensure_egl_display", "eglChooseConfig failed", eglGetError());
        return false;
    }
    g_egl.display = display;
    return true;
}

void ensure_gl_objects() {
    if (g_egl.program != 0) {
        return;
    }
    get_native_client_buffer = reinterpret_cast<PFNEGLGETNATIVECLIENTBUFFERANDROIDPROC>(
        eglGetProcAddress("eglGetNativeClientBufferANDROID"));
    create_egl_image =
        reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(eglGetProcAddress("eglCreateImageKHR"));
    destroy_egl_image =
        reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(eglGetProcAddress("eglDestroyImageKHR"));
    image_target_texture = reinterpret_cast<PFNGLEGLIMAGETARGETTEXTURE2DOESPROC>(
        eglGetProcAddress("glEGLImageTargetTexture2DOES"));

    const GLuint vertex_shader = load_shader(GL_VERTEX_SHADER, kVertexShader);
    const GLuint fragment_shader = load_shader(GL_FRAGMENT_SHADER, kFragmentShader);
    const GLuint program = glCreateProgram();
    glAttachShader(program, vertex_shader);
    glAttachShader(program, fragment_shader);
    glLinkProgram(program);
    glDeleteShader(vertex_shader);
    glDeleteShader(fragment_shader);
    GLint linked = GL_FALSE;
    glGetProgramiv(program, GL_LINK_STATUS, &linked);
    if (linked == GL_FALSE) {
        log_error("ensure_gl_objects", "program link failed");
        glDeleteProgram(program);
        return;
    }
    glUseProgram(program);

    GLuint texture = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_EXTERNAL_OES, texture);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    g_egl.program = program;
    g_egl.texture = texture;
}

void detach_window() {
    if (g_egl.surface == EGL_NO_SURFACE) {
        return;
    }
    eglMakeCurrent(g_egl.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    eglDestroySurface(g_egl.display, g_egl.surface);
    g_egl.surface = EGL_NO_SURFACE;
}

bool attach_window(ANativeWindow* window) {
    if (!ensure_egl_display()) {
        return false;
    }
    EGLSurface surface =
        eglCreateWindowSurface(g_egl.display, g_egl.config, window, nullptr);
    if (surface == EGL_NO_SURFACE) {
        log_error("attach_window", "eglCreateWindowSurface failed", eglGetError());
        return false;
    }
    if (g_egl.context == EGL_NO_CONTEXT) {
        const EGLint context_attributes[] = {EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
        g_egl.context =
            eglCreateContext(g_egl.display, g_egl.config, EGL_NO_CONTEXT, context_attributes);
        if (g_egl.context == EGL_NO_CONTEXT) {
            log_error("attach_window", "eglCreateContext failed", eglGetError());
            eglDestroySurface(g_egl.display, surface);
            return false;
        }
    }
    if (eglMakeCurrent(g_egl.display, surface, surface, g_egl.context) == EGL_FALSE) {
        log_error("attach_window", "eglMakeCurrent failed", eglGetError());
        eglDestroySurface(g_egl.display, surface);
        return false;
    }

    EGLSurface previous = g_egl.surface;
    g_egl.surface = surface;
    if (previous != EGL_NO_SURFACE) {
        eglDestroySurface(g_egl.display, previous);
    }
    ensure_gl_objects();

    EGLint width = 0;
    EGLint height = 0;
    eglQuerySurface(g_egl.display, surface, EGL_WIDTH, &width);
    eglQuerySurface(g_egl.display, surface, EGL_HEIGHT, &height);
    glViewport(0, 0, width, height);
    eglMakeCurrent(g_egl.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    return true;
}

void render_frame(AHardwareBuffer* hardware_buffer) {
    if (g_egl.surface == EGL_NO_SURFACE || g_egl.program == 0 || hardware_buffer == nullptr ||
        get_native_client_buffer == nullptr || create_egl_image == nullptr ||
        destroy_egl_image == nullptr || image_target_texture == nullptr) {
        return;
    }
    if (eglMakeCurrent(g_egl.display, g_egl.surface, g_egl.surface, g_egl.context) == EGL_FALSE) {
        return;
    }

    EGLClientBuffer client_buffer = get_native_client_buffer(hardware_buffer);
    const EGLint image_attributes[] = {EGL_IMAGE_PRESERVED_KHR, EGL_TRUE, EGL_NONE};
    EGLImageKHR image = create_egl_image(
        g_egl.display,
        EGL_NO_CONTEXT,
        EGL_NATIVE_BUFFER_ANDROID,
        client_buffer,
        image_attributes
    );
    if (image == EGL_NO_IMAGE_KHR) {
        log_error("render_frame", "eglCreateImageKHR failed", eglGetError());
        eglMakeCurrent(g_egl.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        return;
    }

    glBindTexture(GL_TEXTURE_EXTERNAL_OES, g_egl.texture);
    image_target_texture(GL_TEXTURE_EXTERNAL_OES, image);
    glClearColor(0.0F, 0.0F, 0.0F, 1.0F);
    glClear(GL_COLOR_BUFFER_BIT);

    const GLfloat vertices[] = {-1, 1, -1, -1, 1, 1, 1, -1};
    const GLfloat coordinates[] = {0, 0, 0, 1, 1, 0, 1, 1};
    const GLint position = glGetAttribLocation(g_egl.program, "position");
    const GLint tex_coord = glGetAttribLocation(g_egl.program, "tex_coord");
    glEnableVertexAttribArray(position);
    glVertexAttribPointer(position, 2, GL_FLOAT, GL_FALSE, 0, vertices);
    glEnableVertexAttribArray(tex_coord);
    glVertexAttribPointer(tex_coord, 2, GL_FLOAT, GL_FALSE, 0, coordinates);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

    eglSwapBuffers(g_egl.display, g_egl.surface);
    destroy_egl_image(g_egl.display, image);
    eglMakeCurrent(g_egl.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
}

void drain_render_queue_locked() {
    while (!g_render_queue.empty()) {
        AImage_delete(g_render_queue.front());
        g_render_queue.pop();
    }
}

void render_loop() {
    ANativeWindow* window = nullptr;
    while (g_render_running.load(std::memory_order_acquire)) {
        AImage* image = nullptr;
        ANativeWindow* next_window = nullptr;
        bool detach = false;
        {
            std::unique_lock<std::mutex> lock(g_render_mutex);
            g_render_condition.wait(lock, [] {
                return !g_render_running.load(std::memory_order_acquire) ||
                       !g_render_queue.empty() || g_pending_window != nullptr || g_pending_detach;
            });
            if (!g_render_running.load(std::memory_order_acquire)) {
                break;
            }
            detach = g_pending_detach;
            g_pending_detach = false;
            next_window = g_pending_window;
            g_pending_window = nullptr;
            if (!g_render_queue.empty()) {
                image = g_render_queue.front();
                g_render_queue.pop();
            }
        }

        if (detach || next_window != nullptr) {
            detach_window();
            if (window != nullptr) {
                ANativeWindow_release(window);
                window = nullptr;
            }
        }
        if (next_window != nullptr) {
            window = next_window;
            if (!attach_window(window)) {
                ANativeWindow_release(window);
                window = nullptr;
            }
        }
        if (image != nullptr) {
            AHardwareBuffer* hardware_buffer = nullptr;
            if (AImage_getHardwareBuffer(image, &hardware_buffer) == AMEDIA_OK) {
                render_frame(hardware_buffer);
            }
            AImage_delete(image);
        }
    }

    detach_window();
    if (window != nullptr) {
        ANativeWindow_release(window);
    }
}

} // namespace

namespace {

bool dispatch_preview(AImage* image) {
    if (image == nullptr || !g_preview_enabled.load(std::memory_order_acquire)) {
        return false;
    }
    static auto last_dispatch = std::chrono::steady_clock::time_point {};
    const auto now = std::chrono::steady_clock::now();
    if (std::chrono::duration_cast<std::chrono::milliseconds>(now - last_dispatch).count() < 16) {
        return false;
    }
    last_dispatch = now;

    AImage* replaced = nullptr;
    {
        std::lock_guard<std::mutex> lock(g_render_mutex);
        if (!g_preview_enabled.load(std::memory_order_acquire)) {
            return false;
        }
        if (!g_render_queue.empty()) {
            replaced = g_render_queue.front();
            g_render_queue.pop();
        }
        g_render_queue.push(image);
    }
    if (replaced != nullptr) {
        AImage_delete(replaced);
    }
    g_render_condition.notify_one();
    return true;
}

void stop_preview() {
    std::lock_guard<std::mutex> lock(g_preview_mutex);
    g_preview_enabled.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> render_lock(g_render_mutex);
        drain_render_queue_locked();
        if (g_pending_window != nullptr) {
            ANativeWindow_release(g_pending_window);
            g_pending_window = nullptr;
        }
        g_pending_detach = true;
    }
    if (g_render_running.exchange(false, std::memory_order_acq_rel)) {
        g_render_condition.notify_all();
        if (g_render_thread.joinable()) {
            g_render_thread.join();
        }
    }
}

} // namespace

namespace virtual_display {

void attach_preview(JNIEnv& env, jobject surface) {
    std::lock_guard<std::mutex> lock(g_preview_mutex);
    if (surface == nullptr) {
        lock.unlock();
        stop_preview();
        return;
    }

    ANativeWindow* window = ANativeWindow_fromSurface(&env, surface);
    if (env.ExceptionCheck() == JNI_TRUE || window == nullptr) {
        env.ExceptionDescribe();
        env.ExceptionClear();
        return;
    }

    {
        std::lock_guard<std::mutex> render_lock(g_render_mutex);
        drain_render_queue_locked();
        if (g_pending_window != nullptr) {
            ANativeWindow_release(g_pending_window);
        }
        g_pending_window = window;
        g_pending_detach = true;
    }
    g_preview_enabled.store(true, std::memory_order_release);
    if (!g_render_running.load(std::memory_order_acquire)) {
        if (g_render_thread.joinable()) {
            g_render_thread.join();
        }
        g_render_running.store(true, std::memory_order_release);
        g_render_thread = std::thread(render_loop);
    }
    g_render_condition.notify_all();
}

} // namespace virtual_display

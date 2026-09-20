#pragma once

#include <jni.h>

#include <cstdint>

struct FrameInfo {
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t stride = 0;
    uint32_t length = 0;
    void* data = nullptr;
    void* frame_ref = nullptr;
};

namespace virtual_display {

jint start(
    JNIEnv& env,
    jobject service,
    jmethodID start_method,
    jint width,
    jint height,
    jint dpi
);

jint stop(JNIEnv& env, jobject service, jmethodID stop_method);
void release_local();

bool active();
bool is_frame(const void* frame_ref);
void geometry(int32_t& display_id, int32_t& width, int32_t& height);
int64_t frame_count();

FrameInfo lock_frame();
int unlock_frame(FrameInfo frame);

void attach_preview(JNIEnv& env, jobject surface);

void copy_rgba_to_bgr(
    const uint8_t* source,
    size_t source_stride_bytes,
    uint8_t* destination,
    size_t destination_stride_bytes,
    int32_t width,
    int32_t height
);

} // namespace virtual_display

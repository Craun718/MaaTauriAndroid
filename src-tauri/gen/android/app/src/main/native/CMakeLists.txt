cmake_minimum_required(VERSION 3.22.1)
project(maa_tauri_android_control LANGUAGES C CXX)

add_library(maa_tauri_android_control SHARED control_bridge.cpp virtual_display.cpp)
target_compile_features(maa_tauri_android_control PRIVATE cxx_std_20)
target_compile_options(maa_tauri_android_control PRIVATE -Wall -Wextra -Wpedantic -Wno-return-type-c-linkage)
target_link_libraries(maa_tauri_android_control PRIVATE android EGL GLESv2 mediandk log)

add_executable(launcher launcher.c)
set_target_properties(launcher PROPERTIES
        OUTPUT_NAME "liblauncher"
        SUFFIX ".so"
        LINKER_LANGUAGE C)
target_link_libraries(launcher PRIVATE log)

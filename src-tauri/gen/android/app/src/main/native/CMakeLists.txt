cmake_minimum_required(VERSION 3.22.1)
project(ttflow_control LANGUAGES CXX)

add_library(ttflow_control SHARED control_bridge.cpp)
target_compile_features(ttflow_control PRIVATE cxx_std_20)
target_compile_options(ttflow_control PRIVATE -Wall -Wextra -Wpedantic -Wno-return-type-c-linkage)
target_link_libraries(ttflow_control PRIVATE log)

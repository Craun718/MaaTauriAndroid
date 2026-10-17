"""Cross-compile the CPU OpenCV and ONNX Runtime bindings for agent core.

Only build inputs live here: the caller owns the core manifest, RECORD hashes,
ELF validation and archives. No target Python executable runs on the build host.
"""

# ruff: noqa: INP001 -- Sibling helper imported by the standalone core build script.

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

OPENCV_VERSION = "4.12.0"
ORT_VERSION = "1.23.2"
ANDROID_API = 24
PREFERRED_NDK = "28.2.13676358"
ORT_REQUIREMENTS = {
    "coloredlogs": "15.0.1",
    "humanfriendly": "10.0",
    "flatbuffers": "25.9.23",
    "packaging": "25.0",
    "protobuf": "6.32.1",
    "sympy": "1.14.0",
    "mpmath": "1.3.0",
}
NATIVE_PROVIDES = {
    "opencv-python": OPENCV_VERSION,
    "onnxruntime": ORT_VERSION,
    **ORT_REQUIREMENTS,
}


class NativeBuildError(RuntimeError):
    """An upstream layout or a native build input is unsupported."""


def run(command: list[str | Path]) -> None:
    print(f"> {shlex.join(str(item) for item in command)}", flush=True)
    subprocess.run([str(item) for item in command], check=True)


def find_ndk() -> Path:
    for name in ("ANDROID_NDK_HOME", "ANDROID_NDK_ROOT"):
        if os.environ.get(name):
            ndk = Path(os.environ[name]).resolve()
            break
    else:
        ndk = Path(os.environ["ANDROID_HOME"]) / "ndk" / PREFERRED_NDK
    if not (ndk / "build/cmake/android.toolchain.cmake").is_file():
        raise NativeBuildError(
            f"Android NDK missing at {ndk}; install {PREFERRED_NDK} "
            "or set ANDROID_NDK_HOME"
        )
    return ndk


def patch_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise NativeBuildError(f"Upstream layout changed: {path}; update Android patch")
    path.write_text(text.replace(old, new), encoding="utf-8")


def prepare_sources(work: Path, python_version: str) -> dict[str, str]:
    if tuple(map(int, python_version.split(".")[:2])) != sys.version_info[:2]:
        raise NativeBuildError(
            "Run build_agent_core.py with a host Python matching the target major.minor"
        )
    for command in ("git", "cmake", "ninja"):
        if not shutil.which(command):
            raise NativeBuildError(f"Native bindings require {command} in PATH")
    find_ndk()
    sources = work / "native-sources"
    if sources.exists():
        shutil.rmtree(sources)
    sources.mkdir(parents=True)
    commits = {}
    for name, repository, tag in (
        ("opencv", "opencv/opencv", OPENCV_VERSION),
        ("onnxruntime", "microsoft/onnxruntime", f"v{ORT_VERSION}"),
    ):
        source = sources / name
        run([
            "git", "clone", "--depth", "1", "--branch", tag,
            "--recursive", "--shallow-submodules",
            f"https://github.com/{repository}.git", source,
        ])
        commits[name] = subprocess.check_output(
            ["git", "-C", str(source), "rev-parse", "HEAD"], text=True,
        ).strip()
    patch_once(
        sources / "opencv/modules/python/CMakeLists.txt",
        "if(ANDROID OR APPLE_FRAMEWORK OR WINRT)",
        "if(APPLE_FRAMEWORK OR WINRT)",
    )
    ort_cmake = sources / "onnxruntime/cmake/CMakeLists.txt"
    for components in ("Development", "Development.Module"):
        patch_once(
            ort_cmake,
            f"find_package(Python 3.10 COMPONENTS Interpreter {components} NumPy)",
            'include("${MTA_TARGET_PYTHON_CMAKE}")',
        )
    return commits


def write_distribution(
    site: Path, name: str, version: str, roots: list[Path], licenses: list[Path],
) -> None:
    info = site / f"{name.replace('-', '_')}-{version}.dist-info"
    license_dir = info / "licenses"
    license_dir.mkdir(parents=True)
    for index, license_path in enumerate(licenses):
        shutil.copy2(license_path, license_dir / f"{index}-{license_path.name}")
    (info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n",
        encoding="utf-8",
    )
    # Seed the roots for build_agent_core.regenerate_records, which fills in
    # hashes after all stripping and pruning are finished.
    entries = [*roots, info.relative_to(site)]
    (info / "RECORD").write_text(
        "".join(f"{entry.as_posix()},,\n" for entry in entries), encoding="utf-8",
    )


def build_opencv(
    source: Path, build: Path, site: Path, prefix: Path,
    ndk: Path, abi: str, python_version: str, numpy_version: str, jobs: int,
) -> None:
    major, minor, _patch = python_version.split(".")
    python_include = prefix / "include" / f"python{major}.{minor}"
    numpy_include = site / "numpy/_core/include"
    run([
        "cmake", "-S", source, "-B", build, "-G", "Ninja",
        f"-DCMAKE_TOOLCHAIN_FILE={ndk}/build/cmake/android.toolchain.cmake",
        f"-DANDROID_ABI={abi}", f"-DANDROID_PLATFORM=android-{ANDROID_API}",
        "-DANDROID_STL=c++_shared", "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_POSITION_INDEPENDENT_CODE=ON", "-DBUILD_SHARED_LIBS=OFF",
        "-DBUILD_LIST=core,imgproc,imgcodecs,calib3d,features2d,flann,photo,video,objdetect,dnn,ml,python3",
        "-DBUILD_opencv_python3=ON", "-DBUILD_opencv_python2=OFF",
        "-DBUILD_TESTS=OFF", "-DBUILD_PERF_TESTS=OFF", "-DBUILD_EXAMPLES=OFF",
        "-DBUILD_ANDROID_PROJECTS=OFF", "-DBUILD_ANDROID_EXAMPLES=OFF",
        "-DBUILD_JAVA=OFF", "-DWITH_OPENCL=OFF", "-DWITH_IPP=OFF",
        "-DWITH_TBB=OFF", "-DWITH_OPENEXR=OFF", "-DWITH_FFMPEG=OFF",
        "-DWITH_GSTREAMER=OFF", "-DWITH_V4L=OFF", "-DWITH_1394=OFF",
        "-DOPENCV_SKIP_PYTHON_LOADER=ON", "-DOPENCV_FORCE_PYTHON_LIBS=ON",
        f"-DPYTHON3_EXECUTABLE={sys.executable}",
        f"-DPYTHON_DEFAULT_EXECUTABLE={sys.executable}",
        "-DPYTHON3INTERP_FOUND=TRUE", "-DPYTHON3LIBS_FOUND=TRUE",
        f"-DPYTHON3_VERSION_STRING={python_version}",
        f"-DPYTHON3_VERSION_MAJOR={major}", f"-DPYTHON3_VERSION_MINOR={minor}",
        f"-DPYTHON3_INCLUDE_PATH={python_include}",
        f"-DPYTHON3_LIBRARIES={prefix}/lib/libpython{major}.{minor}.so",
        f"-DPYTHON3_NUMPY_INCLUDE_DIRS={numpy_include}",
        f"-DPYTHON3_NUMPY_VERSION={numpy_version}", "-DPYTHON3_CVPY_SUFFIX=.so",
        f"-DPYTHON3_PACKAGES_PATH={site}",
    ])
    run(["cmake", "--build", build, "--target", "opencv_python3", "--parallel", str(jobs)])
    extensions = list(build.rglob("cv2.so"))
    if len(extensions) != 1:
        raise NativeBuildError(f"Expected one cv2.so in {build}: {extensions}")
    shutil.copy2(extensions[0], site / "cv2.so")
    licenses = [source / "LICENSE"]
    for root in (source / "3rdparty", build / "3rdparty"):
        licenses.extend(sorted(
            path for path in root.rglob("*")
            if path.is_file() and path.name.lower().startswith(("license", "copying", "notice"))
        ))
    write_distribution(site, "opencv-python", OPENCV_VERSION, [Path("cv2.so")], licenses)


def build_ort(
    source: Path, build: Path, site: Path, prefix: Path,
    ndk: Path, abi: str, python_version: str, numpy_version: str, jobs: int,
) -> None:
    build.mkdir(parents=True, exist_ok=True)
    python_minor = ".".join(python_version.split(".")[:2])
    target_python = build / "target-python.cmake"
    target_python.write_text(
        f"""# Host interpreter generates sources; headers and libraries target Android.
find_package(Python 3.10 COMPONENTS Interpreter REQUIRED)
set(Python_INCLUDE_DIRS "{prefix}/include/python{python_minor}")
set(Python_LIBRARIES "{prefix}/lib/libpython{python_minor}.so")
set(Python_NumPy_INCLUDE_DIRS "{site}/numpy/_core/include")
set(Python_NumPy_VERSION "{numpy_version}")
set(Python_Development_FOUND TRUE)
set(Python_Development.Module_FOUND TRUE)
set(Python_NumPy_FOUND TRUE)
foreach(kind Module Python)
  if(NOT TARGET Python::${{kind}})
    add_library(Python::${{kind}} INTERFACE IMPORTED)
    set_target_properties(Python::${{kind}} PROPERTIES
      INTERFACE_INCLUDE_DIRECTORIES "${{Python_INCLUDE_DIRS}}"
      INTERFACE_LINK_LIBRARIES "${{Python_LIBRARIES}}")
  endif()
endforeach()
if(NOT TARGET Python::NumPy)
  add_library(Python::NumPy INTERFACE IMPORTED)
  set_target_properties(Python::NumPy PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${{Python_NumPy_INCLUDE_DIRS}}"
    INTERFACE_LINK_LIBRARIES Python::Module)
endif()
""", encoding="utf-8",
    )
    run([
        sys.executable, source / "tools/ci_build/build.py",
        "--update", "--build", "--config", "Release", "--build_dir", build,
        "--parallel", str(jobs), "--skip_tests", "--enable_pybind",
        "--android", "--android_abi", abi, "--android_api", str(ANDROID_API),
        "--android_sdk_path", os.environ["ANDROID_HOME"], "--android_ndk_path", ndk,
        "--cmake_generator", "Ninja", "--compile_no_warning_as_error",
        "--cmake_extra_defines",
        f"MTA_TARGET_PYTHON_CMAKE={target_python}",
        "onnxruntime_BUILD_UNIT_TESTS=OFF", "onnxruntime_USE_NNAPI_BUILTIN=OFF",
        "onnxruntime_USE_XNNPACK=OFF", "onnxruntime_USE_CUDA=OFF",
        "CMAKE_ANDROID_STL_TYPE=c++_shared", "ANDROID_STL=c++_shared",
    ])
    package = build / "Release/onnxruntime"
    if not (package / "capi/onnxruntime_pybind11_state.so").is_file():
        raise NativeBuildError(f"ORT Python extension missing in {package}")
    shutil.copytree(package, site / "onnxruntime", symlinks=False)
    (site / "onnxruntime/capi/build_and_package_info.py").write_text(
        f'package_name = "onnxruntime"\n__version__ = "{ORT_VERSION}"\n', encoding="utf-8",
    )
    write_distribution(
        site, "onnxruntime", ORT_VERSION, [Path("onnxruntime")],
        [source / "LICENSE", source / "ThirdPartyNotices.txt"],
    )


def build_native(
    work: Path, site: Path, target_prefix: Path, runtime_lib: Path,
    abi: str, host: str, python_version: str, numpy_version: str, jobs: int,
) -> None:
    ndk = find_ndk()
    sources = work / "native-sources"
    build = work / "native-build" / abi
    if build.exists():
        shutil.rmtree(build)
    for name, builder in (("opencv", build_opencv), ("onnxruntime", build_ort)):
        builder(
            sources / name, build / name, site, target_prefix,
            ndk, abi, python_version, numpy_version, jobs,
        )
    # Both extensions use the same NDK C++ runtime. Put it on the existing
    # prefix/lib LD_LIBRARY_PATH, shared with the Python runtime.
    candidates = list((ndk / "toolchains/llvm/prebuilt").glob(
        f"*/sysroot/usr/lib/{host}/libc++_shared.so"
    ))
    if len(candidates) != 1:
        raise NativeBuildError(f"Expected one NDK libc++_shared.so for {abi}: {candidates}")
    shutil.copy2(candidates[0], runtime_lib / "libc++_shared.so")
    notice = ndk / "sources/cxx-stl/llvm-libc++/NOTICE"
    if not notice.is_file():
        notice = ndk / "NOTICE"
    shutil.copy2(notice, runtime_lib / "libc++-NOTICE")
    strip_tool = candidates[0].parents[4] / "bin/llvm-strip"
    native_libraries = sorted(
        path for path in site.rglob("*.so*") if path.is_file()
    )
    run([strip_tool, "--strip-unneeded", *native_libraries, runtime_lib / "libc++_shared.so"])
    # ORT's intermediate objects are large; release them before the next ABI.
    shutil.rmtree(build)

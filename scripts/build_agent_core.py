#!/usr/bin/env python3
# Vendored into MaaTauriAndroid from Craun718/MaaAgentCoreAndroid. The body is
# upstream's apart from the launcher.c path below and plain lint cleanups from
# ruff.toml (`select = ["ALL"]`), so a `git diff` against upstream shows more
# than this header.
#
#   upstream: https://github.com/Craun718/MaaAgentCoreAndroid
#   path:     `scripts/build_agent_core.py` (the backticks keep the note from
#             parsing as an annotated assignment; ruff ERA001)
#   sync:     refresh from the upstream repo when the agent core pipeline changes,
#             then reapply the launcher.c path change and the lint fixes
#   license:  undeclared upstream; maintained by the same author as this repo
"""Build Android agent-core archives from source inputs."""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import json
import os
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import TypedDict

NUMPY_VERSION = "2.3.2"
STRENUM_VERSION = "0.4.15"
WHEEL_APIS = (24, 21, 16)
CHAQUOPY_INDEX = "https://chaquo.com/pypi-upstream/"
EXCLUDED_STDLIB_DIRECTORIES = {
    "ensurepip",
    "idlelib",
    "pydoc_data",
    "tkinter",
    "turtledemo",
}
ELF_HEADER_SIZE = 64
ELF_CLASS_64 = 2
ELF_TYPE_SHARED_OBJECT = 3
ELF_PROGRAM_HEADER_INTERP = 3


class AbiInfo(TypedDict):
    """Per-ABI build inputs: NDK host tuple, wheel tag and ELF machine id."""

    host: str
    wheel_abi: str
    elf_machine: int


ABIS: dict[str, AbiInfo] = {
    "arm64-v8a": {
        "host": "aarch64-linux-android",
        "wheel_abi": "arm64_v8a",
        "elf_machine": 183,
    },
    "x86_64": {
        "host": "x86_64-linux-android",
        "wheel_abi": "x86_64",
        "elf_machine": 62,
    },
}


class BuildError(RuntimeError):
    """Raised when an input, a step or a validation result is unusable."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python-version", required=True)
    parser.add_argument("--maafw-version", required=True)
    parser.add_argument("--work-dir", type=Path, default=Path("build/work"))
    parser.add_argument("--print-normalized-versions", action="store_true")
    return parser.parse_args()


def normalize_python_version(raw: str) -> tuple[str, int, int, int]:
    value = raw.strip()
    match = re.fullmatch(r"(3)\.(\d+)\.(\d+)", value)
    if not match:
        raise BuildError(
            "Python version must be a stable 3.x.y release such as 3.13.15"
        )
    major, minor, patch = map(int, match.groups())
    if (major, minor) < (3, 13):
        raise BuildError("CPython Android official build support starts at 3.13")
    return value, major, minor, patch


def normalize_maafw_version(raw: str) -> str:
    value = raw.strip().lower()
    value = re.sub(
        r"-(?:beta|b)\.(\d+)",
        lambda match: f"b{int(match.group(1))}",
        value,
    )
    if not re.fullmatch(r"\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?", value):
        raise BuildError(
            "MaaFramework version must be a release such as 5.12.3, "
            "or a beta such as 5.13.0b1 / 5.13.0-beta.1"
        )
    return value


def is_prerelease(version: str) -> bool:
    return re.search(r"(?:a|b|rc)\d+$", version) is not None


def run(
    command: list[str | Path],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    printable = " ".join(shlex.quote(str(item)) for item in command)
    print(f"> {printable}", flush=True)
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    subprocess.run(
        [str(item) for item in command],
        cwd=cwd,
        env=merged_env,
        check=True,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reset_directory(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def download_python_source(version: str, destination: Path) -> Path:
    url = f"https://www.python.org/ftp/python/{version}/Python-{version}.tgz"
    archive = destination / f"Python-{version}.tgz"
    run(["curl", "-fL", "--retry", "5", "--retry-all-errors", "-o", archive, url])
    return archive


def download_maafw_wheel(version: str, destination: Path) -> Path:
    run(
        [
            sys.executable,
            "-m",
            "pip",
            "download",
            "--dest",
            destination,
            "--only-binary=:all:",
            "--no-deps",
            "--platform",
            "manylinux2014_aarch64",
            "--implementation",
            "py",
            "--python-version",
            "3.13",
            "--abi",
            "none",
            f"maafw=={version}",
        ]
    )
    matches = [
        path
        for path in destination.glob("*.whl")
        if path.name.lower().startswith(f"maafw-{version}-")
    ]
    if len(matches) != 1:
        raise BuildError(
            f"Expected exactly one maafw wheel for {version}, found {matches}"
        )
    return matches[0]


def download_runtime_wheels(
    destination: Path,
    python_version: str,
    py_abi: str,
) -> dict[str, str]:
    base_command = [
        sys.executable,
        "-m",
        "pip",
        "download",
        "--dest",
        destination,
        "--only-binary=:all:",
        "--no-deps",
        "--python-version",
        python_version,
        "--implementation",
        "cp",
        "--abi",
        py_abi,
        "--extra-index-url",
        CHAQUOPY_INDEX,
    ]
    run([*base_command, f"StrEnum=={STRENUM_VERSION}"])
    wheel_hashes: dict[str, str] = {}
    for abi_info in ABIS.values():
        run(
            [
                *base_command,
                "--platform",
                f"android_{WHEEL_APIS[0]}_{abi_info['wheel_abi']}",
                f"numpy=={NUMPY_VERSION}",
            ]
        )
    for path in destination.glob("*.whl"):
        if path.name.startswith(("StrEnum-", "numpy-")):
            wheel_hashes[path.name] = sha256(path)
    if len(wheel_hashes) != 1 + len(ABIS):
        raise BuildError(
            f"Expected {1 + len(ABIS)} runtime wheels, found {sorted(wheel_hashes)}"
        )
    return wheel_hashes


def build_cpython(source_root: Path, cross_build: Path) -> None:
    android_dir = source_root / "Android"
    commands = [
        sys.executable,
        android_dir / "android.py",
        "configure-build",
        "--clean",
        "--cross-build-dir",
        cross_build,
    ]
    run(commands, cwd=android_dir)
    run(
        [
            sys.executable,
            android_dir / "android.py",
            "make-build",
            "--cross-build-dir",
            cross_build,
        ],
        cwd=android_dir,
    )
    run(
        [
            sys.executable,
            android_dir / "android.py",
            "pythoninfo-build",
            "--cross-build-dir",
            cross_build,
        ],
        cwd=android_dir,
    )
    for abi in ABIS.values():
        run(
            [
                sys.executable,
                android_dir / "android.py",
                "configure-host",
                "--clean",
                abi["host"],
                "--cross-build-dir",
                cross_build,
            ],
            cwd=android_dir,
        )
        run(
            [
                sys.executable,
                android_dir / "android.py",
                "make-host",
                abi["host"],
                "--cross-build-dir",
                cross_build,
            ],
            cwd=android_dir,
        )


def copy_runtime(source: Path, destination: Path, major: int, minor: int) -> None:
    source_lib = source / "lib"
    destination.mkdir(parents=True)
    stdlib_name = f"python{major}.{minor}"
    zip_name = f"python{major}{minor}.zip"
    keep_directories = {
        stdlib_name,
        zip_name,
        "engines-3",
        "ossl-modules",
    }
    for item in source_lib.iterdir():
        if item.name not in keep_directories and ".so" not in item.name:
            continue
        target = destination / item.name
        if item.is_symlink() or item.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target, follow_symlinks=True)
        elif item.is_dir():
            shutil.copytree(
                item,
                target,
                symlinks=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        else:
            raise BuildError(f"Unsupported runtime input: {item}")


def normalize_stdlib(prefix: Path, major: int, minor: int) -> None:
    stdlib = prefix / "lib" / f"python{major}.{minor}"
    archive = prefix / "lib" / f"python{major}{minor}.zip"
    for child in stdlib.iterdir():
        exclude = (
            child.name in EXCLUDED_STDLIB_DIRECTORIES
            or child.name in {"test", "tests"}
            or child.name.startswith(f"config-{major}.{minor}-")
        )
        if not exclude:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        elif child.exists() or child.is_symlink():
            raise BuildError(f"Unsupported standard library exclusion input: {child}")
    source_paths: list[Path] = []
    for path in sorted(stdlib.rglob("*.py")):
        relative = path.relative_to(stdlib)
        parts = relative.parts
        if not parts or parts[0] in {"lib-dynload", "test", "tests"}:
            continue
        if "__pycache__" in parts:
            continue
        source_paths.append(path)

    if not source_paths:
        raise BuildError(f"No standard library source files found under {stdlib}")
    with zipfile.ZipFile(
        archive,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as bundle:
        for path in source_paths:
            name = path.relative_to(stdlib).as_posix()
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(
                info,
                path.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )
    for path in source_paths:
        path.unlink()


def strip_runtime(source_root: Path, prefix: Path, host: str) -> None:
    libraries = sorted(
        path
        for path in (prefix / "lib").rglob("*.so*")
        if path.is_file() and not path.is_symlink()
    )
    if not libraries:
        raise BuildError(f"No runtime libraries found to strip under {prefix / 'lib'}")
    shell_script = f"""set -eu
HOST={shlex.quote(host)}
PREFIX={shlex.quote(str(prefix))}
. {shlex.quote(str(source_root / "Android" / "android-env.sh"))}
exec "$STRIP" --strip-unneeded {" ".join(shlex.quote(str(path)) for path in libraries)}
"""
    run(["bash", "-c", shell_script], cwd=source_root)


def compile_launcher(
    source_root: Path,
    launcher_source: Path,
    prefix: Path,
    output: Path,
    host: str,
    major: int,
    minor: int,
) -> None:
    output.parent.mkdir(parents=True)
    shell_script = f"""set -eu
HOST={shlex.quote(host)}
PREFIX={shlex.quote(str(prefix))}
. {shlex.quote(str(source_root / "Android" / "android-env.sh"))}
exec "$CC" $CFLAGS -std=c17 -O2 -fPIE -pie \
  -I{shlex.quote(str(prefix / "include" / f"python{major}.{minor}"))} \
  {shlex.quote(str(launcher_source))} \
  -L{shlex.quote(str(prefix / "lib"))} \
  -lpython{major}.{minor} -ldl $LDFLAGS \
  -o {shlex.quote(str(output))}
"""
    run(["bash", "-c", shell_script], cwd=source_root)
    output.chmod(0o755)


def install_site_packages(
    input_dir: Path,
    destination: Path,
    python_version: str,
    wheel_abi: str,
    py_abi: str,
) -> None:
    destination.mkdir(parents=True)
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--target",
        destination,
        "--no-index",
        "--find-links",
        input_dir,
        "--only-binary=:all:",
        "--no-deps",
        "--no-compile",
        "--python-version",
        python_version,
        "--implementation",
        "cp",
        "--abi",
        py_abi,
        f"numpy=={NUMPY_VERSION}",
        f"StrEnum=={STRENUM_VERSION}",
    ]
    for api in WHEEL_APIS:
        command.extend(["--platform", f"android_{api}_{wheel_abi}"])
    run(command)


def prune_site_packages(site_packages: Path) -> None:
    for relative in (
        Path("bin"),
        Path("numpy") / "f2py",
        Path("numpy") / "_pyinstaller",
    ):
        path = site_packages / relative
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()

    for path in list((site_packages / "numpy").rglob("tests")):
        if path.is_dir():
            shutil.rmtree(path)
    remove_caches(site_packages)


def remove_caches(root: Path) -> None:
    for path in list(root.rglob("__pycache__")):
        if path.is_dir():
            shutil.rmtree(path)
    for path in list(root.rglob("*.pyc")):
        if path.is_file():
            path.unlink()


def regenerate_records(site_packages: Path) -> None:
    for dist_info in sorted(site_packages.glob("*.dist-info")):
        record = dist_info / "RECORD"
        if not record.is_file():
            raise BuildError(f"Missing RECORD: {record}")
        with record.open(newline="", encoding="utf-8") as handle:
            old_rows = list(csv.reader(handle))

        roots = {dist_info.name}
        for row in old_rows:
            if not row or row[0] == record.name:
                continue
            parts = Path(row[0]).parts
            if not parts or ".." in parts or Path(row[0]).is_absolute():
                continue
            if parts[0] not in {"bin", "__pycache__"}:
                roots.add(parts[0])

        new_rows = []
        for root_name in sorted(roots):
            root = site_packages / root_name
            if not root.exists():
                continue
            for path in sorted(
                item
                for item in root.rglob("*")
                if item.is_file() and not item.is_symlink()
            ):
                if path == record:
                    continue
                digest = hashlib.sha256(path.read_bytes()).digest()
                encoded = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
                new_rows.append(
                    (
                        path.relative_to(site_packages).as_posix(),
                        encoded,
                        str(path.stat().st_size),
                    )
                )

        with record.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerows(new_rows)


def extract_and_patch_maafw(wheel: Path, destination: Path) -> None:
    destination.mkdir(parents=True)
    with zipfile.ZipFile(wheel) as bundle:
        python_files = sorted(
            name
            for name in bundle.namelist()
            if name.startswith("maa/") and name.endswith(".py")
        )
        for name in python_files:
            relative = Path(name)
            if ".." in relative.parts or relative.is_absolute():
                raise BuildError(f"Unsafe path in maafw wheel: {name}")
            relative = relative.relative_to("maa")
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(name))

    library = destination / "library.py"
    text = library.read_text(encoding="utf-8")
    needle = "        platform_type = platform.system().lower()\n"
    patch = (
        '        if platform_type == "android":\n            platform_type = LINUX\n'
    )
    if text.count(needle) != 1:
        raise BuildError(
            "maa/library.py platform selection changed; update the Android patch"
        )
    with library.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text.replace(needle, needle + patch))

    with zipfile.ZipFile(wheel) as bundle:
        for name in python_files:
            if name == "maa/library.py":
                continue
            extracted = destination / Path(name).relative_to("maa")
            if extracted.read_bytes() != bundle.read(name):
                raise BuildError(f"Unexpected difference while copying {name}")


def write_manifest(
    path: Path,
    python_version: str,
    py_abi: str,
    abi: str,
    wheel_abi: str,
    maafw_version: str,
) -> None:
    manifest = {
        "python": python_version,
        "pyAbiTag": py_abi,
        "wheelApis": list(WHEEL_APIS),
        "abi": abi,
        "wheelAbi": wheel_abi,
        "provides": {
            "numpy": NUMPY_VERSION,
            "strenum": STRENUM_VERSION,
            "maafw": maafw_version,
        },
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def elf_info(path: Path) -> tuple[int, int, list[str]]:
    data = path.read_bytes()
    if (
        len(data) < ELF_HEADER_SIZE
        or data[:4] != b"\x7fELF"
        or data[4] != ELF_CLASS_64
    ):
        raise BuildError(f"Not a 64-bit little-endian ELF: {path}")
    endian = "<" if data[5] == 1 else ">"
    elf_type, machine = struct.unpack_from(endian + "HH", data, 16)
    phoff = struct.unpack_from(endian + "Q", data, 32)[0]
    phentsize, phnum = struct.unpack_from(endian + "HH", data, 54)
    interpreters: list[str] = []
    for index in range(phnum):
        offset = phoff + index * phentsize
        ph_type, _flags, p_offset = struct.unpack_from(endian + "IIQ", data, offset)
        if ph_type == ELF_PROGRAM_HEADER_INTERP:
            end = data.index(b"\0", p_offset)
            interpreters.append(data[p_offset:end].decode("ascii"))
    return elf_type, machine, interpreters


def validate_bundle(
    bundle: Path,
    abi: str,
    python_version: str,
    maafw_version: str,
    major: int,
    minor: int,
) -> None:
    abi_info = ABIS[abi]
    expected_top = {"agent-core.json", "bin", "prefix", "site-packages"}
    if {item.name for item in bundle.iterdir()} != expected_top:
        raise BuildError(f"Unexpected bundle top level in {abi}")

    manifest = json.loads((bundle / "agent-core.json").read_text(encoding="utf-8"))
    expected_manifest_values = {
        "python": python_version,
        "pyAbiTag": f"cp{major}{minor}",
        "wheelApis": list(WHEEL_APIS),
        "abi": abi,
        "wheelAbi": abi_info["wheel_abi"],
    }
    for key, value in expected_manifest_values.items():
        if manifest.get(key) != value:
            raise BuildError(
                f"Manifest mismatch for {abi}.{key}: {manifest.get(key)!r} != {value!r}"
            )
    if manifest["provides"].get("maafw") != maafw_version:
        raise BuildError(f"Manifest maafw mismatch for {abi}")

    launcher = bundle / "bin" / "python3"
    elf_type, machine, interpreters = elf_info(launcher)
    if (
        elf_type != ELF_TYPE_SHARED_OBJECT
        or machine != abi_info["elf_machine"]
        or interpreters != ["/system/bin/linker64"]
    ):
        raise BuildError(
            f"Invalid launcher ELF for {abi}: type={elf_type}, "
            f"machine={machine}, interp={interpreters}"
        )

    prefix_lib = bundle / "prefix" / "lib"
    for required in (
        f"libpython{major}.{minor}.so",
        "libpython3.so",
        f"python{major}{minor}.zip",
        f"python{major}.{minor}",
    ):
        if not (prefix_lib / required).exists():
            raise BuildError(f"Missing runtime input {required} for {abi}")
    for shared_object in prefix_lib.rglob("*"):
        if shared_object.is_symlink() or not shared_object.is_file():
            continue
        if ".so" not in shared_object.name:
            continue
        _, machine, _ = elf_info(shared_object)
        if machine != abi_info["elf_machine"]:
            raise BuildError(f"Wrong ELF machine in {shared_object}: {machine}")

    site_packages = bundle / "site-packages"
    required_sites = ("maa", "numpy", "numpy.libs", "strenum")
    if not all((site_packages / name).is_dir() for name in required_sites):
        raise BuildError(f"Missing site-packages directories for {abi}")
    if (site_packages / "maa" / "bin").exists():
        raise BuildError(f"maa/bin must not be packaged for {abi}")
    for native in site_packages.rglob("*"):
        if native.is_file() and not native.is_symlink() and ".so" in native.name:
            _, machine, _ = elf_info(native)
            if machine != abi_info["elf_machine"]:
                raise BuildError(
                    f"Wrong site-packages ELF machine in {native}: {machine}"
                )
    if any(path.is_dir() for path in bundle.rglob("__pycache__")):
        raise BuildError(f"Found __pycache__ in {abi}")
    if any(path.is_file() for path in bundle.rglob("*.pyc")):
        raise BuildError(f"Found bytecode in {abi}")
    if any(path.name.startswith("libMaa") for path in bundle.rglob("libMaa*.so")):
        raise BuildError(f"Found MaaFramework native library in {abi}")

    validate_records(site_packages)


def validate_records(site_packages: Path) -> None:
    for dist_info in sorted(site_packages.glob("*.dist-info")):
        record = dist_info / "RECORD"
        with record.open(newline="", encoding="utf-8") as handle:
            rows = {(row[0], row[1], row[2]) for row in csv.reader(handle) if row}
        recorded_paths = {Path(row[0]) for row in rows}
        roots = {path.parts[0] for path in recorded_paths}
        actual_paths: set[Path] = set()
        for root_name in roots:
            root = site_packages / root_name
            if not root.exists():
                continue
            actual_paths.update(
                path.relative_to(site_packages)
                for path in root.rglob("*")
                if path.is_file() and not path.is_symlink()
            )
        actual_paths.discard(Path(dist_info.name) / "RECORD")
        if actual_paths != recorded_paths:
            missing = sorted(actual_paths - recorded_paths)
            dangling = sorted(recorded_paths - actual_paths)
            raise BuildError(
                f"RECORD mismatch in {dist_info.name}; "
                f"missing={missing}, dangling={dangling}"
            )
        for path_text, encoded, size_text in rows:
            path = site_packages / path_text
            if not path.is_file():
                raise BuildError(f"RECORD references missing file: {path}")
            digest = hashlib.sha256(path.read_bytes()).digest()
            expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
            if encoded != expected or size_text != str(path.stat().st_size):
                raise BuildError(f"RECORD hash or size mismatch: {path}")
        has_license = any(
            "licenses" in path.parts or path.name.startswith("LICENSE")
            for path in recorded_paths
        )
        if not has_license:
            raise BuildError(f"No license entry found in {dist_info.name}")


def normalize_modes(stage_root: Path) -> None:
    for path in stage_root.rglob("*"):
        if path.is_symlink():
            # Tar metadata is normalized explicitly for symlink entries.
            continue
        if path.is_dir() or (
            path.is_file()
            and path.name == "python3"
            and path.parent.parent.name == "bundle"
        ):
            path.chmod(0o755)
        elif path.is_file():
            path.chmod(0o644)


def write_archive(
    stage_root: Path,
    abi: str,
    output: Path,
    python_version: str,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    bundle_root = stage_root / abi / "bundle"
    with tempfile.NamedTemporaryFile(
        prefix=f"agent-core-{python_version}-{abi}-",
        suffix=".tar",
    ) as raw:
        raw_path = Path(raw.name)
        with tarfile.open(raw_path, "w", format=tarfile.GNU_FORMAT) as archive:
            paths = sorted(
                bundle_root.rglob("*"),
                key=lambda path: path.as_posix(),
            )
            entries = [bundle_root, *paths]
            for path in entries:
                relative = path.relative_to(stage_root)
                info = archive.gettarinfo(
                    str(path),
                    arcname=relative.as_posix(),
                )
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                info.mtime = 0
                if (
                    info.isdir()
                    or info.issym()
                    or (info.isfile() and info.name.endswith("/bundle/bin/python3"))
                ):
                    info.mode = 0o755
                elif info.isfile():
                    info.mode = 0o644
                else:
                    raise BuildError(f"Unsupported archive entry: {path}")
                if info.isfile():
                    with path.open("rb") as source_handle:
                        archive.addfile(info, source_handle)
                else:
                    archive.addfile(info)

        with (
            output.open("wb") as compressed_handle,
            raw_path.open("rb") as raw_handle,
            gzip.GzipFile(
                filename="",
                mode="wb",
                compresslevel=9,
                fileobj=compressed_handle,
                mtime=0,
            ) as gzip_handle,
        ):
            shutil.copyfileobj(raw_handle, gzip_handle, length=1024 * 1024)


def validate_archive(path: Path, abi: str) -> None:
    bundle_root = f"{abi}/bundle"
    expected_prefix = f"{abi}/bundle/"
    with tarfile.open(path, "r:gz") as archive:
        members = archive.getmembers()
        if not members or members[0].name != bundle_root:
            raise BuildError(f"Archive for {abi} does not start at {bundle_root}")
        for member in members:
            if (
                member.name != bundle_root
                and not member.name.startswith(expected_prefix)
            ) or member.name.startswith("/"):
                raise BuildError(
                    f"Unexpected archive path {member.name} in {path.name}"
                )
            if (
                member.name.endswith("/bundle/bin/python3")
                or member.isdir()
                or member.issym()
            ):
                expected_mode = 0o755
            else:
                expected_mode = 0o644
            if member.mode != expected_mode:
                raise BuildError(
                    f"Archive mode mismatch for {member.name}: {oct(member.mode)}"
                )
            if member.uid != 0 or member.gid != 0 or member.mtime != 0:
                raise BuildError(f"Archive metadata mismatch for {member.name}")


def main() -> None:
    args = parse_args()
    python_version, major, minor, _patch = normalize_python_version(args.python_version)
    maafw_version = normalize_maafw_version(args.maafw_version)
    if args.print_normalized_versions:
        print(
            json.dumps(
                {"python": python_version, "maafw": maafw_version},
                sort_keys=True,
            )
        )
        return

    if "ANDROID_HOME" not in os.environ:
        raise BuildError("ANDROID_HOME must be set")

    py_abi = f"cp{major}{minor}"
    script_root = Path(__file__).resolve().parent.parent
    work = args.work_dir.resolve()
    inputs = work / "inputs"
    stage = work / "stage"
    dist = work / "dist"
    source_root = work / f"Python-{python_version}"
    cross_build = work / "cross-build"
    for directory in (inputs, stage, dist):
        reset_directory(directory)
    if source_root.exists():
        shutil.rmtree(source_root)

    python_archive = download_python_source(python_version, inputs)
    maafw_wheel = download_maafw_wheel(maafw_version, inputs)
    runtime_wheel_hashes = download_runtime_wheels(inputs, python_version, py_abi)
    print(f"Python source SHA-256: {sha256(python_archive)}")
    print(f"maafw wheel SHA-256: {sha256(maafw_wheel)}")
    shutil.unpack_archive(python_archive, work)

    build_cpython(source_root, cross_build)

    archives: list[Path] = []
    for abi, abi_info in ABIS.items():
        prefix_source = cross_build / abi_info["host"] / "prefix"
        bundle = stage / abi / "bundle"
        prefix = bundle / "prefix"
        site_packages = bundle / "site-packages"
        copy_runtime(prefix_source, prefix / "lib", major, minor)
        normalize_stdlib(prefix, major, minor)
        strip_runtime(source_root, prefix, abi_info["host"])
        compile_launcher(
            source_root,
            script_root / "scripts" / "agent-core-launcher.c",
            prefix_source,
            bundle / "bin" / "python3",
            abi_info["host"],
            major,
            minor,
        )
        install_site_packages(
            inputs,
            site_packages,
            python_version,
            abi_info["wheel_abi"],
            py_abi,
        )
        prune_site_packages(site_packages)
        regenerate_records(site_packages)
        extract_and_patch_maafw(maafw_wheel, site_packages / "maa")
        write_manifest(
            bundle / "agent-core.json",
            python_version,
            py_abi,
            abi,
            abi_info["wheel_abi"],
            maafw_version,
        )
        remove_caches(bundle)
        validate_bundle(
            bundle,
            abi,
            python_version,
            maafw_version,
            major,
            minor,
        )
        normalize_modes(stage / abi)
        archive = dist / f"agent-core-{python_version}-{abi}.tar.gz"
        write_archive(stage, abi, archive, python_version)
        validate_archive(archive, abi)
        archives.append(archive)

    hashes = {archive.name: sha256(archive) for archive in archives}
    (dist / "SHA256SUMS").write_text(
        "".join(f"{value}  {name}\n" for name, value in hashes.items()),
        encoding="utf-8",
    )
    metadata = {
        "pythonVersion": python_version,
        "maafwVersion": maafw_version,
        "maafwInput": args.maafw_version,
        "maafwPrerelease": is_prerelease(maafw_version),
        "numpyVersion": NUMPY_VERSION,
        "strenumVersion": STRENUM_VERSION,
        "runtimeWheelSha256": runtime_wheel_hashes,
        "pythonSourceSha256": sha256(python_archive),
        "maafwWheelSha256": sha256(maafw_wheel),
        "archives": hashes,
        "commit": os.environ.get("GITHUB_SHA", ""),
    }
    (dist / "build-metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    notes = [
        "# Agent core build report",
        "",
        "This build was generated by the manual CI workflow.",
        "",
        f"- CPython: `{python_version}`",
        f"- MaaFramework Python binding: `{maafw_version}`",
        f"- numpy: `{NUMPY_VERSION}`",
        f"- StrEnum: `{STRENUM_VERSION}`",
        "- Android ABIs: `arm64-v8a`, `x86_64`",
        "",
        (
            "The archives do **not** contain MaaFramework native libraries. "
            "The Android host must provide native libraries matching the manifest version."
        ),
        "Static validation passed in CI. Android on-device smoke testing has not been run by this workflow.",
        "",
        "## SHA-256",
        "",
    ]
    notes.extend(f"- `{name}`: `{value}`" for name, value in hashes.items())
    (dist / "build-report.md").write_text("\n".join(notes), encoding="utf-8")
    print(json.dumps(metadata, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (
        BuildError,
        OSError,
        subprocess.CalledProcessError,
        shutil.Error,
        tarfile.TarError,
        zipfile.BadZipFile,
    ) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error

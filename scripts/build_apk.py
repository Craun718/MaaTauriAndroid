#!/usr/bin/env python3
"""One-click APK build from a prepared resource project.

Usage:
    scripts/build_apk.py --profile PATH [--abi arm64-v8a] [--release]

The resource project must already be cloned (by CI or manually) at
<profile-dir>/<resource_id>/. This script does not clone anything.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
AGENT_CORE_PY = "3.13.15"

ABIS = {
    "arm64-v8a": ("aarch64-linux-android", "aarch64"),
    "x86_64": ("x86_64-linux-android", "x86_64"),
}

PREFERRED_NDK = "28.2.13676358"
ANDROID_PACKAGE = "top.natsuu.mta"
ANDROID_LIBRARY = "maa_tauri_android_lib"


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd: list[str], **kwargs: object) -> None:
    log(f"==> {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)  # noqa: S603


def read_profile(path: Path) -> tuple[str, str]:
    """Return (resource_id, bundle_template) from a profile TOML."""
    with path.open("rb") as f:
        data = tomllib.load(f)
    resource_id: str = data.get("resource_id", "")
    if not resource_id:
        die(f"{path} does not declare resource_id")
    runtimes: list[dict[str, str]] = data.get("agent", {}).get("runtimes", [])
    bundle = runtimes[0]["bundle"] if runtimes else ""
    return resource_id, bundle


def pick_ndk(android_home: Path) -> Path:
    ndk_root = android_home / "ndk"
    if not ndk_root.is_dir():
        die(f"no NDK found under {ndk_root}")
    preferred = ndk_root / PREFERRED_NDK
    if preferred.is_dir():
        return preferred
    versions = sorted(p.name for p in ndk_root.iterdir() if p.is_dir())
    if not versions:
        die(f"no NDK versions installed under {ndk_root}")
    chosen = ndk_root / versions[-1]
    log(f"warning: NDK {PREFERRED_NDK} not found; using {chosen.name}")
    return chosen


def detect_build_mode(force_release: bool, force_debug: bool) -> str:
    if force_release and force_debug:
        die("--release and --debug are mutually exclusive")
    if force_release:
        return "release"
    if force_debug:
        return "debug"
    result = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "describe", "--exact-match", "--tags"],
        capture_output=True,
    )
    return "release" if result.returncode == 0 else "debug"


def ensure_rust_target(target: str) -> None:
    result = subprocess.run(
        ["rustup", "target", "list", "--installed"],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and target in result.stdout.splitlines():
        return
    log(f"==> Installing Rust target {target}…")
    subprocess.run(["rustup", "target", "add", target], check=True)


def load_env() -> None:
    env_sh = REPO_ROOT / "scripts" / "env.sh"
    if not env_sh.is_file():
        return
    result = subprocess.run(
        ["bash", "-c", f"source {env_sh} && env"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        die(f"failed to source {env_sh}")
    for line in result.stdout.splitlines():
        key, _, value = line.partition("=")
        if key in ("MAAFW_VERSION", "MAAFW_CORE_REPO", "MAAFW_CORE_TAG"):
            os.environ.setdefault(key, value)


def build(args: argparse.Namespace) -> None:
    if args.abi not in ABIS:
        die(f"unsupported ABI: {args.abi}")
    rust_target, tauri_target = ABIS[args.abi]

    profile = args.profile.resolve()
    if not profile.is_file():
        die(f"profile not found: {profile}")
    profile_dir = profile.parent

    resource_id, bundle_template = read_profile(profile)
    project_dir = profile_dir / resource_id
    if not project_dir.is_dir():
        die(
            f"resource project not found at {project_dir}\n"
            "       clone it (and its submodules) first, or point --profile at the right place"
        )

    runtime_zip = profile_dir / bundle_template.replace("{abi}", args.abi) if bundle_template else None
    if args.skip_runtime and (runtime_zip is None or not runtime_zip.is_file()):
        die(f"--skip-runtime requires an existing runtime ZIP at {runtime_zip}")

    build_mode = detect_build_mode(args.release, args.debug)
    log(f"==> Building {resource_id} ({args.abi}) {build_mode} APK")

    android_home = Path(os.environ.get("ANDROID_HOME", ""))
    if not android_home.is_dir():
        die("ANDROID_HOME is not set or does not exist")
    ndk_dir = pick_ndk(android_home)
    toolchain = ndk_dir / "toolchains" / "llvm" / "prebuilt" / "linux-x86_64" / "bin"

    ensure_rust_target(rust_target)

    # --- 1/4 MaaFramework ------------------------------------------------------

    maafw_version = os.environ.get("MAAFW_VERSION", "")
    log(f"==> [1/4] Fetching MaaFramework {maafw_version} ({args.abi})…")
    run([str(REPO_ROOT / "scripts" / "fetch-maafw.sh"), args.abi])

    # --- 1.5/4 agent core ------------------------------------------------------

    core_tarball: Path | None = None
    if not args.use_prebuilt_core and not args.skip_runtime:
        pypi_maafw = maafw_version.removeprefix("v")
        core_work = REPO_ROOT / ".cache" / "agent-core"
        log(f"==> [1.5/4] Building agent core (CPython {args.python_version}, MaaFW {pypi_maafw})…")
        run([
            "python3", str(REPO_ROOT / "scripts" / "build_agent_core.py"),
            "--python-version", args.python_version,
            "--maafw-version", pypi_maafw,
            "--work-dir", str(core_work),
        ])
        core_tarball = core_work / "dist" / f"agent-core-{args.python_version}-{args.abi}.tar.gz"
        if not core_tarball.is_file():
            die(f"agent core tarball not found: {core_tarball}")

    # --- 2/4 agent runtime -------------------------------------------------------

    if not args.skip_runtime and runtime_zip is not None:
        log(f"==> [2/4] Building agent runtime ({args.abi})…")
        run(["python3", str(REPO_ROOT / "scripts" / "prepare-pi.py"), str(project_dir)])
        runtime_cmd = [
            "python3", str(REPO_ROOT / "scripts" / "build-agent-runtime.sh"),
            "--project-dir", str(project_dir),
            "--out", str(runtime_zip),
            "--abi", args.abi,
        ]
        for pkg in args.exclude:
            runtime_cmd += ["--exclude", pkg]
        for spec in args.require:
            runtime_cmd += ["--require", spec]
        if core_tarball is not None:
            runtime_cmd += ["--core", str(core_tarball)]
        run(runtime_cmd)
    else:
        log(f"==> [2/4] Skipping agent runtime; using {runtime_zip}")

    # --- 3/4 configure -----------------------------------------------------------

    log("==> [3/4] Configuring the Android build…")
    android_gen = REPO_ROOT / "src-tauri" / "gen" / "android"
    (android_gen / "local.properties").write_text(
        f"sdk.dir={android_home}\npi.profile={profile}\n"
    )

    env = {
        **os.environ,
        "ANDROID_NDK_HOME": str(ndk_dir),
        "ANDROID_NDK_ROOT": str(ndk_dir),
        "NDK_HOME": str(ndk_dir),
        "AR": str(toolchain / "llvm-ar"),
        "CC_aarch64_linux_android": str(toolchain / "aarch64-linux-android35-clang"),
        "CXX_aarch64_linux_android": str(toolchain / "aarch64-linux-android35-clang++"),
        "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER": str(toolchain / "aarch64-linux-android35-clang"),
        "CC_x86_64_linux_android": str(toolchain / "x86_64-linux-android35-clang"),
        "CXX_x86_64_linux_android": str(toolchain / "x86_64-linux-android35-clang++"),
        "CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER": str(toolchain / "x86_64-linux-android35-clang"),
        "TAURI_ANDROID_PROJECT_PATH": str(android_gen),
        "WRY_ANDROID_PACKAGE": ANDROID_PACKAGE,
        "WRY_ANDROID_LIBRARY": ANDROID_LIBRARY,
    }

    run(["pnpm", "install", "--frozen-lockfile"], cwd=REPO_ROOT, env=env)

    cargo_toml = str(REPO_ROOT / "src-tauri" / "Cargo.toml")
    run(["cargo", "clean", "--manifest-path", cargo_toml, "--package", "maa_tauri_android"], env=env)
    run(["cargo", "check", "--manifest-path", cargo_toml, "--target", rust_target, "--lib"], env=env)

    # --- 4/4 APK -------------------------------------------------------------------

    log("==> [4/4] Building the APK…")
    tauri_cmd = [
        "pnpm", "tauri", "android", "build",
        "--target", tauri_target,
        "--apk",
        "--split-per-abi",
    ]
    if build_mode == "debug":
        tauri_cmd.append("--debug")
    run(tauri_cmd, cwd=REPO_ROOT, env=env)

    apk_dir = android_gen / "app" / "build" / "outputs" / "apk"
    log("\n==> Done. APKs:")
    for apk in sorted(apk_dir.rglob("*.apk")):
        log(f"  {apk} ({apk.stat().st_size / 1024 / 1024:.1f} MB)")
    if runtime_zip is not None:
        log(f"==> Agent runtime: {runtime_zip}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="One-click APK build from a prepared resource project.",
    )
    parser.add_argument(
        "--profile", type=Path, required=True,
        help="Resource profile TOML (defines resource_id and agent bundle)",
    )
    parser.add_argument("--abi", default="arm64-v8a", choices=list(ABIS), help="Target ABI")
    parser.add_argument("--release", action="store_true", help="Force release build")
    parser.add_argument("--debug", action="store_true", help="Force debug build")
    parser.add_argument("--skip-runtime", action="store_true", help="Use the existing agent runtime ZIP")
    parser.add_argument(
        "--python-version", default=AGENT_CORE_PY,
        help="CPython version for the agent core build (default %(default)s)",
    )
    parser.add_argument(
        "--use-prebuilt-core", action="store_true",
        help="Download the prebuilt agent core instead of compiling from source",
    )
    parser.add_argument("--exclude", action="append", default=[], metavar="PKG", help="Pass to build-agent-runtime.sh")
    parser.add_argument("--require", action="append", default=[], metavar="SPEC", help="Pass to build-agent-runtime.sh")
    args = parser.parse_args()

    for cmd in ["pnpm", "cargo", "python3", "curl", "unzip"]:
        if not shutil.which(cmd):
            die(f"{cmd} not found in PATH")

    load_env()
    build(args)


if __name__ == "__main__":
    main()

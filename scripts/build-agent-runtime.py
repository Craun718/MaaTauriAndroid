#!/usr/bin/env python3
"""Build a Python agent runtime ZIP for a MaaFramework PI project."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from agent_runtime_versions import AGENT_LIBS
from build_agent_bundle import CORE_REPO, CORE_TAG, MACHINES

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAQUOPY_INDEX = "https://chaquo.com/pypi-13.1/"


def nonempty(value: str) -> str:
    if not value:
        raise argparse.ArgumentTypeError("expected a non-empty value")
    return value


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    result.add_argument("--project-dir", required=True, type=nonempty, metavar="DIR", help="resource project root")
    result.add_argument("--out", required=True, type=nonempty, metavar="ZIP", help="output runtime ZIP")
    result.add_argument("--requirements", type=nonempty, metavar="FILE", help="default <project-dir>/requirements.txt")
    result.add_argument("--core", type=nonempty, metavar="PATH", help="local core tar.gz or directory instead of a release download")
    result.add_argument("--dist", type=nonempty, metavar="DIR", help="default <out dir>/<project basename>-agent-dist")
    result.add_argument("--abi", choices=MACHINES, default="arm64-v8a", help="default %(default)s")
    result.add_argument("--exclude", action="append", type=nonempty, default=[], metavar="PKG", help="skip a package; repeatable")
    result.add_argument("--require", action="append", type=nonempty, default=[], metavar="SPEC", help="add a dependency spec; repeatable")
    result.add_argument("--extra-index-url", action="append", type=nonempty, default=[], metavar="URL",
                        help=f"additional pip index; repeatable ({CHAQUOPY_INDEX} is always included)")
    result.add_argument("--no-deps", action="store_true", help="treat the requirements file as a full lock")
    result.add_argument("--work", type=nonempty, metavar="DIR", help="default .cache/maafw/<repo>/<tag>")
    return result


def log(message: str) -> None:
    print(message, flush=True)


def fetch_agent_libs(abi: str, version: str, destination: Path) -> None:
    arch = MACHINES[abi]
    url = f"https://github.com/MaaXYZ/MaaFramework/releases/download/{version}/MAA-android-{arch}-{version}.zip"
    with tempfile.TemporaryDirectory(prefix="maafw-") as temporary:
        archive_path = Path(temporary) / "maafw-android.zip"
        with urllib.request.urlopen(url, timeout=120) as response, archive_path.open("wb") as output:
            shutil.copyfileobj(response, output)
        with ZipFile(archive_path) as archive:
            available = set(archive.namelist())
            for name in AGENT_LIBS:
                if f"bin/{name}" not in available:
                    raise ValueError(f"MaaFramework {version} archive for {abi} is missing bin/{name}")
            if destination.exists():
                shutil.rmtree(destination)
            destination.mkdir(parents=True)
            for name in AGENT_LIBS:
                with archive.open(f"bin/{name}") as source, (destination / name).open("wb") as output:
                    shutil.copyfileobj(source, output)


def agent_lib_dir(abi: str, version: str, work: Path) -> Path:
    vendor = REPO_ROOT / "vendor" / "maa" / "android" / abi
    try:
        installed = (vendor / ".maafw-version").read_text(encoding="utf-8").rstrip("\n")
    except (OSError, UnicodeError):
        installed = ""
    if installed == version and all((vendor / name).is_file() for name in AGENT_LIBS):
        log(f"  2/3  reusing agent libraries from vendor/maa/android/{abi}/…")
        return vendor
    cache = work / "agent-libs" / version / abi
    if all((cache / name).is_file() for name in AGENT_LIBS):
        log("  2/3  reusing cached MaaFW agent libraries…")
    else:
        log("  2/3  downloading MaaFW agent libraries…")
        fetch_agent_libs(abi, version, cache)
    return cache


def build(args: argparse.Namespace, project: Path, requirements: Path) -> None:
    abi = args.abi
    version = os.environ.get("MAAFW_VERSION") or (REPO_ROOT / ".maafwversion").read_text(encoding="utf-8").strip()
    core_repo = os.environ.get("MAAFW_CORE_REPO") or CORE_REPO
    core_tag = os.environ.get("MAAFW_CORE_TAG") or CORE_TAG
    out = REPO_ROOT / args.out
    dist = REPO_ROOT / args.dist if args.dist else out.parent / f"{project.name}-agent-dist"
    work = REPO_ROOT / args.work if args.work else REPO_ROOT / ".cache" / "maafw" / core_repo / core_tag

    command = [
        sys.executable, str(REPO_ROOT / "scripts" / "build_agent_bundle.py"),
        "--out", str(dist), "--abi", abi, "--expected-maafw", version,
        "--requirements", str(requirements),
    ]
    for package in args.exclude:
        command.extend(("--exclude", package))
    for spec in args.require:
        command.extend(("--require", spec))
    for index in (CHAQUOPY_INDEX, *args.extra_index_url):
        command.extend(("--extra-index-url", index))
    if args.no_deps:
        command.append("--no-deps")
    if args.core:
        command.extend(("--core", str(REPO_ROOT / args.core)))
    else:
        command.extend(("--core-repo", core_repo, "--core-tag", core_tag))
    command.extend(("--work", str(work)))

    log(f"==> Building the Python {abi} agent runtime for {project}…")
    log("  1/3  building the Python core + site-packages bundle…")
    subprocess.run(command, check=True)

    libs = agent_lib_dir(abi, version, work)
    log("  3/3  packing the archive…")
    subprocess.run([
        sys.executable, str(REPO_ROOT / "src-tauri" / "profiles" / "pack_agent_bundle.py"),
        str(dist / abi / "bundle"), str(libs), str(out), "--abi", abi,
    ], check=True)
    log(f"==> Done: {out}")


def main() -> int:
    cli = parser()
    args = cli.parse_args()
    project = REPO_ROOT / args.project_dir
    requirements = REPO_ROOT / args.requirements if args.requirements else project / "requirements.txt"
    if not project.is_dir():
        cli.error(f"project directory missing: {project}")
    if not requirements.is_file():
        cli.error(f"requirements file missing: {requirements}")
    try:
        build(args, project, requirements)
    except subprocess.CalledProcessError as error:
        return error.returncode if error.returncode > 0 else 128 - error.returncode
    except (BadZipFile, OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

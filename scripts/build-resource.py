#!/usr/bin/env python3
"""Clone an arbitrary MaaFramework PI project and build its Python runtime."""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RESOURCE_ID = re.compile(r"[a-z][a-z0-9_-]*")


def run(command: list[str], *, cwd: Path | None = None) -> None:
    print(f"==> {' '.join(command)}")
    try:
        subprocess.run(command, cwd=cwd, check=True)
    except FileNotFoundError as error:
        raise RuntimeError(f"command not found: {error.filename}") from error


def normalized_resource_id(url: str) -> str:
    name = url.rstrip("/").rsplit("/", 1)[-1]
    if name.endswith(".git"):
        name = name[:-4]
    resource_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not RESOURCE_ID.fullmatch(resource_id):
        raise RuntimeError(f"cannot derive a resource id from {url!r}; pass --id ID")
    return resource_id


def validate_resource_id(resource_id: str) -> str:
    if not RESOURCE_ID.fullmatch(resource_id):
        raise RuntimeError(
            "--id may contain only lowercase letters, digits, hyphens, and "
            "underscores, and must start with a letter"
        )
    return resource_id


def clone(url: str, ref: str, resource_id: str, submodules: bool) -> Path:
    path = REPO_ROOT / "resource" / resource_id
    if path.exists():
        raise RuntimeError(
            f"refusing to overwrite {path}; CI uses a fresh checkout, "
            "so remove an explicit local clone first"
        )

    run(["git", "clone", "--no-checkout", url, str(path)])
    run(
        ["git", "-c", "advice.detachedHead=false", "checkout", ref],
        cwd=path,
    )
    if submodules:
        run(
            [
                "git",
                "submodule",
                "update",
                "--init",
                "--recursive",
                "--depth",
                "1",
            ],
            cwd=path,
        )
    return path


def build(arguments: argparse.Namespace, resource_id: str) -> None:
    run(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "prepare-pi.py"),
            f"resource/{resource_id}",
        ]
    )
    for prepare in arguments.prepare:
        command = shlex.split(prepare)
        if not command:
            raise RuntimeError("--prepare must not be empty")
        run(command)

    project_dir = REPO_ROOT / "resource" / resource_id
    requirements = arguments.requirements
    if requirements:
        requirements_path = Path(requirements)
        requirements_path = (
            requirements_path if requirements_path.is_absolute() else REPO_ROOT / requirements_path
        )
    else:
        requirements_path = project_dir / "requirements.txt"

    if not requirements_path.is_file():
        requirements_path = REPO_ROOT / ".cache" / "empty-requirements.txt"
        requirements_path.parent.mkdir(parents=True, exist_ok=True)
        requirements_path.touch()

    output = REPO_ROOT / "resource" / f"{resource_id}-agent-runtime-arm64-v8a.zip"
    command = [
        str(REPO_ROOT / "scripts" / "build-agent-runtime.sh"),
        "--project-dir",
        f"resource/{resource_id}",
        "--out",
        str(output.relative_to(REPO_ROOT)),
    ]
    command.extend(("--requirements", str(requirements_path)))
    for package in arguments.exclude:
        command.extend(("--exclude", package))
    for requirement in arguments.require:
        command.extend(("--require", requirement))
    if arguments.no_deps:
        command.append("--no-deps")
    command.extend(arguments.runtime_arg)
    run(command)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description=__doc__,
        epilog=(
            "example: python3 scripts/build-resource.py "
            "https://github.com/example/project.git --ref main --id project "
            "--submodules --exclude pillow"
        ),
    )
    result.add_argument("url", help="Git URL of the MaaFramework PI project")
    result.add_argument(
        "--id", help="resource directory name; derived from URL by default"
    )
    result.add_argument("--ref", default="HEAD", help="branch, tag, or commit to check out")
    result.add_argument(
        "--submodules",
        action="store_true",
        help="initialize the project's submodules after checkout",
    )
    result.add_argument(
        "--prepare",
        action="append",
        default=[],
        metavar="COMMAND",
        help="repository-root command to run after checkout; repeatable",
    )
    result.add_argument("--requirements", help="requirements file for the Python runtime")
    result.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="PKG",
        help="package to prune from site-packages; repeatable",
    )
    result.add_argument(
        "--require",
        action="append",
        default=[],
        metavar="SPEC",
        help="extra dependency requirement; repeatable",
    )
    result.add_argument(
        "--no-deps",
        action="store_true",
        help="treat the requirements file as a full lock and do not resolve dependencies",
    )
    result.add_argument(
        "--runtime-arg",
        action="append",
        default=[],
        metavar="ARG",
        help="extra argument passed to scripts/build-agent-runtime.sh; repeatable",
    )
    return result


def main() -> int:
    arguments = parser().parse_args()

    if os.environ.get("GITHUB_ACTIONS") != "true":
        print("error: resource cloning is restricted to CI", file=sys.stderr)
        return 1
    if shutil.which("git") is None:
        print("error: git is required", file=sys.stderr)
        return 1

    try:
        resource_id = (
            validate_resource_id(arguments.id)
            if arguments.id
            else normalized_resource_id(arguments.url)
        )
        clone(arguments.url, arguments.ref, resource_id, arguments.submodules)
        run([str(REPO_ROOT / "scripts" / "fetch-maafw.sh")])
        build(arguments, resource_id)
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

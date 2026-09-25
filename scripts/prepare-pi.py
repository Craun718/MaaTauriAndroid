#!/usr/bin/env python3
"""Prepare a MaaFramework PI project for the Android packaging build."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".git")
METADATA_FILES = ("LICENSE", "CONTACT", "DISCLAIMER.md", "NOTICE")


def copy_tree(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=IGNORE, dirs_exist_ok=True)


def jsonc_text(source: Path) -> str:
    """Return JSONC as strict JSON, preserving positions by blanking comments."""
    text = source.read_text(encoding="utf-8")
    output: list[str] = []
    index = 0
    in_string = False

    while index < len(text):
        char = text[index]
        if in_string:
            output.append(char)
            if char == "\\" and index + 1 < len(text):
                output.append(text[index + 1])
                index += 2
                continue
            if char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue

        if char == "/" and index + 1 < len(text) and text[index + 1] == "/":
            output.append("  ")
            index += 2
            while index < len(text) and text[index] != "\n":
                index += 1
            continue

        if char == "/" and index + 1 < len(text) and text[index + 1] == "*":
            end = text.find("*/", index + 2)
            if end < 0:
                raise ValueError(f"unterminated block comment in {source}")
            output.append(" " * (end + 2 - index))
            index = end + 2
            continue

        output.append(char)
        index += 1

    return "".join(output)


def read_interface(source: Path) -> dict[str, Any]:
    document = json.loads(jsonc_text(source))
    if not isinstance(document, dict):
        raise RuntimeError(f"{source} must contain a JSON object")
    return document


def normalize_relative_path(value: str) -> PurePosixPath:
    path = PureWindowsPath(value.strip().replace("\\", "/"))
    parts = [part for part in path.parts if part not in ("", ".")]
    if any(part == ".." for part in parts) or not parts:
        raise RuntimeError(f"invalid PI-relative path: {value!r}")
    return PurePosixPath(*parts)


def first_resource_path(interface: dict[str, Any]) -> PurePosixPath:
    resources = interface.get("resource", [])
    if not isinstance(resources, list):
        raise RuntimeError("interface.resource must be a list")
    for resource in resources:
        if not isinstance(resource, dict):
            continue
        paths = resource.get("path", [])
        if isinstance(paths, str):
            paths = [paths]
        if not isinstance(paths, list):
            continue
        for path in paths:
            if isinstance(path, str) and path.strip():
                return normalize_relative_path(path)
    raise RuntimeError("interface does not declare a resource path")


def run_configure_script(script: Path, *, cwd: Path) -> None:
    print(f"==> Running {script.relative_to(REPO_ROOT)}")
    subprocess.run([sys.executable, str(script)], cwd=cwd, check=True)


def prepare_models(project: Path) -> None:
    configure = project / "tools" / "ci" / "configure.py"
    if configure.is_file():
        run_configure_script(configure, cwd=project)


def copy_common_ocr(project: Path, interface_path: Path, destination: Path) -> None:
    common_ocr = project / "assets" / "MaaCommonAssets" / "OCR"
    if not common_ocr.is_dir():
        return

    sources = sorted(
        path
        for path in common_ocr.glob("*/*")
        if path.is_dir() and path.name == "zh_cn"
    )
    if not sources:
        raise RuntimeError(f"no zh_cn OCR model found under {common_ocr}")

    resource_path = first_resource_path(read_interface(interface_path))
    target = destination / resource_path / "model" / "ocr"
    if target.exists():
        shutil.rmtree(target)
    copy_tree(sources[0], target)


def copy_icon(project: Path, interface: dict[str, Any], destination: Path) -> None:
    icon = interface.get("icon")
    if not isinstance(icon, str) or not icon.strip():
        return
    icon_dir = project / "docs" / "imgs"
    target = destination / normalize_relative_path(icon)
    stem = target.stem

    candidates = [
        icon_dir / f"{stem}.png",
        *sorted(icon_dir.glob("*.png")),
        icon_dir / target.name,
        project / target.name,
    ]
    source = next((path for path in candidates if path.is_file()), None)
    if source is None:
        raise RuntimeError(f"icon declared by interface is missing: {icon}")

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    relative_source = source.relative_to(project)
    relative_copy = destination / relative_source
    relative_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, relative_copy)


def assemble_assets_layout(project: Path) -> Path:
    assets = project / "assets"
    agent = project / "agent"
    interface_path = assets / "interface.json"
    destination = project / "Android" / "pi-root"

    if not interface_path.is_file():
        raise RuntimeError(f"missing {interface_path}")
    if not agent.is_dir():
        raise RuntimeError(f"missing {agent}")

    prepare_models(project)
    interface = read_interface(interface_path)

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    for child in assets.iterdir():
        if child.name == "MaaCommonAssets":
            continue
        if child.is_dir():
            copy_tree(child, destination / child.name)
        else:
            shutil.copy2(child, destination / child.name)

    copy_common_ocr(project, interface_path, destination)
    copy_tree(agent, destination / "agent")

    for name in METADATA_FILES:
        metadata = project / name
        if metadata.is_file():
            shutil.copy2(metadata, destination / name)

    copy_icon(project, interface, destination)
    for json_file in destination.rglob("*.json"):
        json_file.write_text(jsonc_text(json_file), encoding="utf-8")

    return destination


def prepare_root_layout(project: Path) -> Path:
    configure = project / "tools" / "configure.py"
    if configure.is_file():
        run_configure_script(configure, cwd=project)
    return project


def prepare(project_value: str) -> Path:
    project = Path(project_value)
    if not project.is_absolute():
        project = REPO_ROOT / project
    project = project.resolve()
    if not project.is_dir():
        raise RuntimeError(f"resource project directory missing: {project}")

    if (project / "interface.json").is_file():
        return prepare_root_layout(project)
    if (project / "assets" / "interface.json").is_file():
        return assemble_assets_layout(project)
    raise RuntimeError(
        f"cannot find interface.json in {project} or {project / 'assets'}"
    )


def main() -> int:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument(
        "project",
        help="resource project directory, for example resource/maapvz",
    )
    arguments = argument_parser.parse_args()

    try:
        destination = prepare(arguments.project)
        files = sum(1 for path in destination.rglob("*") if path.is_file())
        print(f"{files} files -> {destination}")
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

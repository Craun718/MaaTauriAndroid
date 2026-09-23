#!/usr/bin/env python3
"""Assemble MAAPVZ's assets and agent into a TTFlow-compatible PI root."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "resource" / "maapvz"
ASSETS = SOURCE / "assets"
AGENT = SOURCE / "agent"
DEST = SOURCE / "Android" / "pi-root"
OCR_SOURCE = ASSETS / "MaaCommonAssets" / "OCR" / "ppocr_v5" / "zh_cn"
OCR_TARGET = DEST / "resource" / "model" / "ocr"
ICON_SOURCE = SOURCE / "docs" / "imgs" / "PVZAA.png"
ICON_TARGET = DEST / "resource" / "logo.ico"
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".git")


def copy_tree(source: Path, target: Path) -> None:
    shutil.copytree(source, target, ignore=IGNORE, dirs_exist_ok=True)


def strip_jsonc_comments(source: Path, target: Path) -> None:
    """Write JSONC as strict JSON for Groovy's JsonSlurper."""
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

    target.write_text("".join(output), encoding="utf-8")


def main() -> int:
    interface = ASSETS / "interface.json"
    if not interface.is_file():
        print(f"missing {interface}", file=sys.stderr)
        return 1
    if not AGENT.is_dir():
        print(f"missing {AGENT}", file=sys.stderr)
        return 1
    if not OCR_SOURCE.is_dir():
        print(
            f"missing {OCR_SOURCE}; initialize resource/maapvz recursively",
            file=sys.stderr,
        )
        return 1
    if not ICON_SOURCE.is_file():
        print(f"missing {ICON_SOURCE}", file=sys.stderr)
        return 1

    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)

    for child in ASSETS.iterdir():
        if child.name == "MaaCommonAssets":
            continue
        target = DEST / child.name
        if child.is_dir():
            copy_tree(child, target)
        else:
            if child.name == "interface.json":
                strip_jsonc_comments(child, target)
            else:
                shutil.copy2(child, target)

    copy_tree(AGENT, DEST / "agent")

    license_file = SOURCE / "LICENSE"
    if license_file.is_file():
        shutil.copy2(license_file, DEST / license_file.name)

    # Keep the interface's declared path, but use the upstream PNG payload
    # because the Android launcher generator cannot decode Windows ICO files.
    ICON_TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ICON_SOURCE, ICON_TARGET)

    if OCR_TARGET.exists():
        shutil.rmtree(OCR_TARGET)
    shutil.copytree(OCR_SOURCE, OCR_TARGET)

    files = sum(1 for path in DEST.rglob("*") if path.is_file())
    print(f"{files} files -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

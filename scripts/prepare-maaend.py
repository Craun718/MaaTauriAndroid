#!/usr/bin/env python3
"""Adapt MaaEnd presets for the Android packaging build."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

PRESETS = (
    "tasks/preset/DailyFull.json",
    "tasks/preset/QuickDaily.json",
    "tasks/preset/RealtimeAssist.json",
)
ANDROID_OPEN_GAME_NAME = "AndroidOpenGame"
ANDROID_OPEN_GAME = {"name": "AndroidOpenGame"}


def load_preset(path: Path) -> dict[str, Any]:
    """Load and validate one MaaEnd preset document."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid JSON in {path}: {error.msg}") from error

    presets = document.get("preset") if isinstance(document, dict) else None
    if not isinstance(presets, list) or not all(isinstance(item, dict) for item in presets):
        raise RuntimeError(f"{path} must contain a 'preset' array of objects")

    for index, preset in enumerate(presets):
        tasks = preset.get("task")
        if not isinstance(tasks, list) or not all(isinstance(task, dict) for task in tasks):
            raise RuntimeError(f"preset {index} in {path} must contain a 'task' array")
    return document


def prepare(pi_root: Path) -> None:
    """Put AndroidOpenGame first in each Android-startable MaaEnd preset."""
    for relative in PRESETS:
        path = pi_root / relative
        document = load_preset(path)
        presets = document["preset"]
        changed = False
        for preset in presets:
            first = preset["task"][0] if preset["task"] else None
            first_name = first.get("name") if isinstance(first, dict) else None
            if first_name != ANDROID_OPEN_GAME_NAME:
                preset["task"].insert(0, ANDROID_OPEN_GAME.copy())
                changed = True

        if changed:
            path.write_text(
                json.dumps(document, ensure_ascii=False, indent=4) + "\n",
                encoding="utf-8",
            )
            print(f"adapted {path.relative_to(pi_root)}")


def main() -> int:
    """Run the command-line adapter."""
    argument_parser = argparse.ArgumentParser(description=__doc__)
    argument_parser.add_argument(
        "pi_root",
        help="assembled PI root, for example resource/maaend/Android/pi-root",
    )
    arguments = argument_parser.parse_args()

    pi_root = Path(arguments.pi_root)
    if not pi_root.is_dir():
        print(f"error: PI root missing: {pi_root}", file=sys.stderr)
        return 1

    try:
        prepare(pi_root)
    except (OSError, RuntimeError, UnicodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

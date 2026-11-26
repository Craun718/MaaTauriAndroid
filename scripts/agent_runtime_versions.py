"""Validate the MaaFramework release and ABI declared by an Android runtime."""

# ruff: noqa: INP001 -- Build scripts are invoked directly, not as a package.

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING
from zipfile import BadZipFile, ZipFile

if TYPE_CHECKING:
    from pathlib import Path

CORE_MANIFEST = "agent-core.json"
COMPILED_MANIFEST = "agent-runtime.json"
AGENT_LIBS = ("libMaaAgentClient.so", "libMaaAgentServer.so")


def normalize_maafw(value: str) -> str:
    """Accept the same release in Git-tag and PyPI beta notation."""
    version = value.strip().lower().removeprefix("v")
    stages = {"alpha": "a", "beta": "b", "rc": "rc"}
    return re.sub(r"-(alpha|beta|rc)\.(\d+)$", lambda match: stages[match[1]] + match[2], version)


def validate_runtime_metadata(
    metadata: object, abi: str, expected_version: str, label: str, *, python: bool,
) -> None:
    if not isinstance(metadata, dict) or metadata.get("abi") != abi:
        actual = metadata.get("abi") if isinstance(metadata, dict) else None
        raise ValueError(f"{label}: ABI is {actual!r}, expected {abi}")
    provides = metadata.get("provides") if python else metadata
    actual = provides.get("maafw") if isinstance(provides, dict) else None
    if not isinstance(actual, str) or normalize_maafw(actual) != normalize_maafw(expected_version):
        raise ValueError(f"{label}: MaaFramework is {actual!r}, expected {expected_version}")


def validate_runtime_zip(path: Path, abi: str, expected_version: str) -> None:
    """Reject incompatible Python or versioned compiled ZIPs before an APK build."""
    try:
        with ZipFile(path) as archive:
            names = {entry.filename.removeprefix("./"): entry for entry in archive.infolist() if not entry.is_dir()}
            for library in AGENT_LIBS:
                if f"lib/{abi}/{library}" not in names:
                    raise ValueError(f"{path}: missing lib/{abi}/{library}")
            if CORE_MANIFEST in names:
                validate_runtime_metadata(
                    json.loads(archive.read(names[CORE_MANIFEST])), abi, expected_version, str(path), python=True,
                )
            elif any(name == "bin/python3" or name.startswith("site-packages/") for name in names):
                raise ValueError(f"{path}: missing {CORE_MANIFEST} for Python runtime")
            elif COMPILED_MANIFEST in names:
                validate_runtime_metadata(
                    json.loads(archive.read(names[COMPILED_MANIFEST])), abi, expected_version, str(path), python=False,
                )
    except (BadZipFile, OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{path}: invalid agent runtime ZIP: {error}") from error

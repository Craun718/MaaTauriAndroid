#!/usr/bin/env python3
"""Pack one compiled Android agent ELF into a runtime-safe ZIP."""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
import sys
import time
import zipfile
from pathlib import Path

ABIS = ("arm64-v8a", "x86_64")
AGENT_LIB_NAMES = ("libMaaAgentClient.so", "libMaaAgentServer.so")
ZIP_EPOCH_TIMESTAMP = 315532800
ZIP64_ENTRY_LIMIT = 0xFFFF


def zip_date_time() -> tuple[int, int, int, int, int, int]:
    """Return the deterministic timestamp used for every ZIP entry."""
    try:
        source_timestamp = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    except ValueError as error:
        raise RuntimeError("SOURCE_DATE_EPOCH must be an integer") from error
    return time.gmtime(max(source_timestamp, ZIP_EPOCH_TIMESTAMP))[:6]


def regular_file(path: Path, description: str) -> Path:
    """Return a resolved regular-file input, rejecting links and directories."""
    resolved = path.resolve()
    if path.is_symlink() or not resolved.is_file():
        raise RuntimeError(f"{description} is not a regular file: {path}")
    return resolved


def archive_entry(source: Path, name: str, *, executable: bool) -> tuple[Path, str, int]:
    """Return one source/name/mode tuple for the output archive."""
    mode = 0o100755 if executable else 0o100644
    return source, name, mode


def pack(arguments: argparse.Namespace) -> None:
    """Validate inputs and write the runtime archive."""
    if arguments.abi not in ABIS:
        raise RuntimeError(f"unsupported Android ABI: {arguments.abi}")
    if (
        not arguments.name
        or arguments.name in {".", ".."}
        or "/" in arguments.name
        or "\\" in arguments.name
    ):
        raise RuntimeError(f"agent name must be a path component: {arguments.name}")

    elf = regular_file(arguments.elf, "agent ELF")
    maa_dir = arguments.maa_dir.resolve()
    output = arguments.out.resolve()
    sources = [elf, *(maa_dir / arguments.abi / name for name in AGENT_LIB_NAMES)]
    if output in {source for source in sources if source.exists()}:
        raise RuntimeError(f"output must not overwrite an input: {output}")

    with elf.open("rb") as source:
        elf_magic = source.read(4)
    if elf_magic != b"\x7fELF":
        raise RuntimeError(f"agent input is not an ELF file: {elf}")

    entries = [archive_entry(elf, f"bin/{arguments.name}", executable=True)]
    for name in AGENT_LIB_NAMES:
        source = regular_file(maa_dir / arguments.abi / name, f"agent library {name}")
        entries.append(
            archive_entry(
                source,
                f"lib/{arguments.abi}/{name}",
                executable=False,
            )
        )
    if len(entries) > ZIP64_ENTRY_LIMIT:
        raise RuntimeError("too many entries for a non-ZIP64 archive")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    with zipfile.ZipFile(
        output,
        "w",
        zipfile.ZIP_DEFLATED,
        compresslevel=9,
        allowZip64=False,
    ) as archive:
        for source, name, mode in entries:
            info = zipfile.ZipInfo(name, date_time=zip_date_time())
            info.create_system = 3
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.compress_level = 9
            archive.writestr(info, source.read_bytes())

    required_names = [name for _, name, _ in entries]
    with zipfile.ZipFile(output) as archive:
        infos = archive.infolist()
        for info in infos:
            if stat.S_ISLNK(info.external_attr >> 16):
                raise RuntimeError(f"archive contains a symlink: {info.filename}")
        missing = [name for name in required_names if name not in archive.namelist()]
        if missing:
            raise RuntimeError(f"archive is missing required entries: {missing}")

    print(f"entries : {len(infos)}")
    print(f"zip     : {output}")
    print(f"sha256  : {hashlib.sha256(output.read_bytes()).hexdigest()}")


def parser() -> argparse.ArgumentParser:
    """Build the command-line parser."""
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--elf", required=True, type=Path, help="Android agent ELF")
    result.add_argument("--name", required=True, help="agent name inside bin/")
    result.add_argument("--abi", required=True, choices=ABIS, help="Android ABI")
    result.add_argument(
        "--maa-dir",
        required=True,
        type=Path,
        help="MaaFramework Android directory containing ABI subdirectories",
    )
    result.add_argument("--out", required=True, type=Path, help="output ZIP")
    return result


def main() -> int:
    """Run the command-line packer."""
    arguments = parser().parse_args()
    try:
        pack(arguments)
    except (
        OSError,
        RuntimeError,
        UnicodeError,
        zipfile.BadZipFile,
        zipfile.LargeZipFile,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

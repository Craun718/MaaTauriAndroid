#!/usr/bin/env python3
"""Pack a MaaFwApp agent runtime bundle into a MaaTauriAndroid-compatible ZIP.

`AgentRuntimeManager`/`ZipSafety` impose two hard requirements that this script
enforces, because a plain `zip`/`shutil.make_archive` call can silently violate
them:

  1. the archive may not contain symlinks — entries are written as regular files,
     symlinks being dereferenced to their target's contents;
  2. the archive may not need ZIP64 — `allowZip64=False`, so exceeding the entry
     count or size limits fails loudly instead of producing an archive the Android
     runtime refuses to open.

It also copies `libMaaAgentClient.so` and `libMaaAgentServer.so` into
`lib/<abi>/` inside the bundle, which `validateAgentBundle` requires.

Usage:
    python3 pack_agent_bundle.py <bundle_dir> <agent_lib_dir> <out_zip>

Example (see README.md for the full agent runtime workflow):

    python3 pack_agent_bundle.py \
      ../../resource/m9a-agent-dist/arm64-v8a/bundle \
      /tmp/maafw-agent-libs \
      ../../resource/m9a-agent-runtime-arm64-v8a.zip
"""
from __future__ import annotations

import hashlib
import os
import sys
import zipfile
from pathlib import Path

ABI = "arm64-v8a"
REQUIRED_LIBS = (
    f"lib/{ABI}/libMaaAgentClient.so",
    f"lib/{ABI}/libMaaAgentServer.so",
)
AGENT_LIB_NAMES = ("libMaaAgentClient.so", "libMaaAgentServer.so")
# ZIP stores the entry count in a 16-bit field; anything larger forces ZIP64.
MAX_ENTRIES = 0xFFFF


def collect(bundle: Path) -> list[tuple[Path, str]]:
    items: list[tuple[Path, str]] = []
    for path in sorted(bundle.rglob("*")):
        relative = path.relative_to(bundle).as_posix()
        if path.is_symlink():
            target = path.resolve()
            if not target.is_file():
                raise SystemExit(f"symlink does not resolve to a file: {relative}")
            items.append((target, relative))
        elif path.is_file():
            items.append((path, relative))
    return items


def main() -> int:
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    bundle = Path(sys.argv[1]).resolve()
    lib_dir = Path(sys.argv[2]).resolve()
    out_zip = Path(sys.argv[3]).resolve()

    if not bundle.is_dir():
        raise SystemExit(f"bundle directory missing: {bundle}")
    if not (bundle / "agent-core.json").is_file():
        raise SystemExit(f"not an agent core bundle (agent-core.json missing): {bundle}")

    target_lib = bundle / "lib" / ABI
    target_lib.mkdir(parents=True, exist_ok=True)
    for name in AGENT_LIB_NAMES:
        source = lib_dir / name
        if not source.is_file():
            raise SystemExit(f"agent library missing: {source}")
        (target_lib / name).write_bytes(source.read_bytes())
        print(f"  + lib/{ABI}/{name}")

    items = collect(bundle)
    if len(items) > MAX_ENTRIES:
        raise SystemExit(f"too many entries for a non-ZIP64 archive: {len(items)}")

    out_zip.parent.mkdir(parents=True, exist_ok=True)
    out_zip.unlink(missing_ok=True)
    payload = 0
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9,
                         allowZip64=False) as sink:
        for source, relative in items:
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = (0o100755 if os.access(source, os.X_OK) else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            data = source.read_bytes()
            payload += len(data)
            sink.writestr(info, data)

    with zipfile.ZipFile(out_zip) as archive:
        names = archive.namelist()
        for info in archive.infolist():
            if info.external_attr >> 16 & 0xA000 == 0xA000:
                raise SystemExit(f"archive contains a symlink: {info.filename}")
        missing = [name for name in REQUIRED_LIBS if name not in names]
        if missing:
            raise SystemExit(f"archive is missing required libraries: {missing}")

    print(f"entries : {len(names)} (limit {MAX_ENTRIES})")
    print(f"payload : {payload / 1048576:.1f} MiB uncompressed")
    print(f"zip     : {out_zip} ({out_zip.stat().st_size / 1048576:.1f} MiB)")
    print(f"sha256  : {hashlib.sha256(out_zip.read_bytes()).hexdigest()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

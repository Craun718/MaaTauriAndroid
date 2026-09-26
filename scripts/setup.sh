#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ABI="${1:-arm64-v8a}"
case "${ABI}" in
  arm64-v8a) RUST_TARGET="aarch64" ;;
  x86_64) RUST_TARGET="x86_64" ;;
  *)
    echo "error: unsupported ABI: ${ABI}" >&2
    exit 2
    ;;
esac

echo "==> MaaTauriAndroid setup"
echo

"${SCRIPT_DIR}/fetch-maafw.sh" "${ABI}"
echo

echo "==> Resource projects are pinned in scripts/resources.toml."
echo "==> CI clones each pinned project and builds its runtime."

echo
echo "==> Setup complete. Build the APK with:"
echo "    pnpm tauri android build --target ${RUST_TARGET} --apk"

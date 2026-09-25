#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> MaaTauriAndroid setup"
echo

"${SCRIPT_DIR}/fetch-maafw.sh"
echo

echo "==> Resource projects are pinned in scripts/resources.toml."
echo "==> CI clones each pinned project and builds its runtime."

echo
echo "==> Setup complete. Build the APK with:"
echo "    pnpm tauri android build --target aarch64 --apk"

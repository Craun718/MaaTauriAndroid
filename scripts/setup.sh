#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> TTFlow setup"
echo

"${SCRIPT_DIR}/fetch-submodules.sh"
echo
"${SCRIPT_DIR}/fetch-maafw.sh"
echo
"${SCRIPT_DIR}/build-agent-runtime.sh"

echo
echo "==> Setup complete. Build the APK with:"
echo "    pnpm tauri android build --target aarch64 --apk"


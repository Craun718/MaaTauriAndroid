#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> MaaTauriAndroid setup"
echo

"${SCRIPT_DIR}/fetch-submodules.sh"
echo
"${SCRIPT_DIR}/fetch-maafw.sh"
echo
"${SCRIPT_DIR}/build-agent-runtime.sh" \
  --project-dir resource/m9a \
  --out resource/m9a-agent-runtime-arm64-v8a.zip \
  --exclude pillow \
  --require pillow==11.0.0
echo
"${SCRIPT_DIR}/prepare-narutomobile-pi.sh"
echo
"${SCRIPT_DIR}/build-agent-runtime.sh" \
  --project-dir resource/narutomobile \
  --out resource/narutomobile-agent-runtime-arm64-v8a.zip \
  --exclude pillow \
  --exclude win32-setctime \
  --exclude colorama \
  --exclude jeepney \
  --require pillow==11.0.0
echo
"${SCRIPT_DIR}/prepare-maapvz-pi.sh"
echo
"${SCRIPT_DIR}/build-agent-runtime.sh" \
  --project-dir resource/maapvz \
  --out resource/maapvz-agent-runtime-arm64-v8a.zip \
  --exclude pillow \
  --exclude win32-setctime \
  --exclude colorama \
  --exclude jeepney \
  --exclude onnxruntime \
  --require pillow==11.0.0

echo
echo "==> Setup complete. Build the APK with:"
echo "    pnpm tauri android build --target aarch64 --apk"

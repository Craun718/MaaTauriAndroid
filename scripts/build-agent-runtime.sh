#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

ABI="arm64-v8a"
OUT_DIST="${REPO_ROOT}/resource/m9a-agent-dist"
OUT_ZIP="${REPO_ROOT}/resource/m9a-agent-runtime-${ABI}.zip"
WORK="${REPO_ROOT}/.cache/maafw"

echo "==> Building the ${ABI} Python agent runtime…"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "  1/4  fetching build_agent_bundle.py from MaaFwApp…"
curl -fsSL -o "${TMP}/build_agent_bundle.py" \
  "https://raw.githubusercontent.com/Aliothmoon/MaaFwApp/${MAAFW_SCRIPT_REF}/scripts/build_agent_bundle.py"

echo "  2/4  building the Python core + site-packages bundle…"
python3 "${TMP}/build_agent_bundle.py" \
  --out "${OUT_DIST}" \
  --abi "${ABI}" \
  --requirements "${REPO_ROOT}/resource/m9a/requirements.txt" \
  --exclude pillow --require pillow==11.0.0 \
  --extra-index-url https://chaquo.com/pypi-13.1/ \
  --work "${WORK}"

VENDOR_DIR="${REPO_ROOT}/vendor/maa/android/${ABI}"
if [ -f "${VENDOR_DIR}/libMaaAgentClient.so" ]; then
  echo "  3/4  reusing agent libraries from vendor/maa/android/${ABI}/…"
  mkdir -p "${TMP}/agent-libs"
  cp "${VENDOR_DIR}/libMaaAgentClient.so" "${VENDOR_DIR}/libMaaAgentServer.so" "${TMP}/agent-libs/"
else
  echo "  3/4  downloading MaaFW agent libraries…"
  curl -fsSL -o "${TMP}/maafw-android.zip" \
    "https://github.com/MaaXYZ/MaaFramework/releases/download/${MAAFW_VERSION}/MAA-android-aarch64-${MAAFW_VERSION}.zip"
  unzip -j -q "${TMP}/maafw-android.zip" \
    "bin/libMaaAgentClient.so" "bin/libMaaAgentServer.so" \
    -d "${TMP}/agent-libs"
fi

echo "  4/4  packing the archive…"
python3 "${REPO_ROOT}/src-tauri/profiles/pack_agent_bundle.py" \
  "${OUT_DIST}/${ABI}/bundle" \
  "${TMP}/agent-libs" \
  "${OUT_ZIP}"

echo "==> Done: ${OUT_ZIP}"

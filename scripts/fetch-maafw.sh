#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

DEST="${REPO_ROOT}/vendor/maa/android/arm64-v8a"
VERSION_FILE="${DEST}/.maafw-version"
installed_version="$(cat "${VERSION_FILE}" 2>/dev/null || true)"
mkdir -p "${DEST}"

if
  [ -f "${DEST}/libMaaFramework.so" ] &&
    [ "${installed_version}" = "${MAAFW_VERSION}" ]
then
  echo "==> MaaFramework already present at ${DEST}; skipping download."
  echo "    (delete the directory to force a re-download)"
  exit 0
fi

URL="https://github.com/MaaXYZ/MaaFramework/releases/download/${MAAFW_VERSION}/MAA-android-aarch64-${MAAFW_VERSION}.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "==> Downloading MaaFramework ${MAAFW_VERSION} (android arm64)…"
curl -fsSL -o "${TMP}/maafw.zip" "${URL}"
unzip -q "${TMP}/maafw.zip" -d "${TMP}/maafw"

echo "==> Installing into vendor/maa/android/arm64-v8a/…"
cp "${TMP}"/maafw/bin/*.so "${DEST}/"
printf '%s\n' "${MAAFW_VERSION}" >"${VERSION_FILE}"

echo "==> Installed:"
ls -lh "${DEST}"

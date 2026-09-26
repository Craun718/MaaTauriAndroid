#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

TMP=""
trap 'if [ -n "${TMP}" ]; then rm -rf "${TMP}"; fi' EXIT

if [ "$#" -eq 0 ]; then
  set -- arm64-v8a
fi

for ABI in "$@"; do
  case "${ABI}" in
    arm64-v8a) ARCH="aarch64" ;;
    x86_64) ARCH="x86_64" ;;
    *)
      echo "error: unsupported ABI: ${ABI}" >&2
      exit 2
      ;;
  esac

  DEST="${REPO_ROOT}/vendor/maa/android/${ABI}"
  VERSION_FILE="${DEST}/.maafw-version"
  installed_version="$(cat "${VERSION_FILE}" 2>/dev/null || true)"
  mkdir -p "${DEST}"

  if
    [ -f "${DEST}/libMaaFramework.so" ] &&
      [ "${installed_version}" = "${MAAFW_VERSION}" ]
  then
    echo "==> MaaFramework ${ABI} already present; skipping download."
    echo "    (delete the directory to force a re-download)"
    continue
  fi

  URL="https://github.com/MaaXYZ/MaaFramework/releases/download/${MAAFW_VERSION}/MAA-android-${ARCH}-${MAAFW_VERSION}.zip"
  TMP="$(mktemp -d)"

  echo "==> Downloading MaaFramework ${MAAFW_VERSION} (android ${ABI})…"
  curl -fsSL -o "${TMP}/maafw.zip" "${URL}"
  unzip -q "${TMP}/maafw.zip" -d "${TMP}/maafw"

  echo "==> Installing into vendor/maa/android/${ABI}/…"
  cp "${TMP}"/maafw/bin/*.so "${DEST}/"
  printf '%s\n' "${MAAFW_VERSION}" >"${VERSION_FILE}"

  echo "==> Installed:"
  ls -lh "${DEST}"
  rm -rf "${TMP}"
  TMP=""
done

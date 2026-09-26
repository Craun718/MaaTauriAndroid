#!/usr/bin/env bash
# Build a Python agent runtime ZIP for any MaaFramework PI project. The
# prebuilt Python core (CPython + stdlib + the maa package) is pinned by
# scripts/env.sh; only the project's own dependencies are layered on top.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

ABI="arm64-v8a"
PROJECT_DIR=""
REQUIREMENTS=""
OUT_ZIP=""
DIST=""
WORK=""
NO_DEPS=0
EXCLUDES=()
REQUIRES=()
EXTRA_INDEXES=()

usage() {
  cat >&2 <<'EOF'
usage: scripts/build-agent-runtime.sh --project-dir DIR --out ZIP [options]

Build a Python agent runtime ZIP for a MaaFramework PI project. The prebuilt
Python core comes from MAAFW_CORE_REPO / MAAFW_CORE_TAG (see scripts/env.sh);
only the project's own dependencies are installed on top.

required:
  --project-dir DIR   resource project root (contains requirements.txt)
  --out ZIP           output runtime archive, e.g. /tmp/my-agent-runtime-arm64-v8a.zip

options:
  --requirements FILE   requirements file; default <project-dir>/requirements.txt
  --dist DIR            intermediate bundle root; default <out dir>/<project basename>-agent-dist
  --abi ABI             target ABI; default arm64-v8a
  --exclude PKG         package to prune from site-packages; repeatable
  --require SPEC        extra dependency spec, unfiltered; repeatable, e.g. pillow==11.0.0
  --extra-index-url URL extra pip index; repeatable (chaquo.com/pypi-13.1 is always included)
  --no-deps             pass through to build_agent_bundle.py (requirements is a full lock)
  --work DIR            core download/unpack cache; default .cache/maafw/<repo>/<tag>
  -h, --help            show this help
EOF
  exit "${1:-2}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project-dir)      PROJECT_DIR="${2:?--project-dir needs a value}"; shift 2 ;;
    --requirements)     REQUIREMENTS="${2:?--requirements needs a value}"; shift 2 ;;
    --out)              OUT_ZIP="${2:?--out needs a value}"; shift 2 ;;
    --dist)             DIST="${2:?--dist needs a value}"; shift 2 ;;
    --abi)              ABI="${2:?--abi needs a value}"; shift 2 ;;
    --exclude)          EXCLUDES+=(--exclude "${2:?--exclude needs a value}"); shift 2 ;;
    --require)          REQUIRES+=(--require "${2:?--require needs a value}"); shift 2 ;;
    --extra-index-url)  EXTRA_INDEXES+=(--extra-index-url "${2:?--extra-index-url needs a value}"); shift 2 ;;
    --no-deps)          NO_DEPS=1; shift ;;
    --work)             WORK="${2:?--work needs a value}"; shift 2 ;;
    -h|--help)          usage 0 ;;
    *)                  usage ;;
  esac
done

resolve() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *)  printf '%s\n' "${REPO_ROOT}/$1" ;;
  esac
}

[ -n "${PROJECT_DIR}" ] || usage
[ -n "${OUT_ZIP}" ] || usage

case "${ABI}" in
  arm64-v8a|x86_64) ;;
  *)
    echo "error: unsupported ABI: ${ABI}" >&2
    exit 2
    ;;
esac

PROJECT_DIR="$(resolve "${PROJECT_DIR}")"
OUT_ZIP="$(resolve "${OUT_ZIP}")"
if [ -n "${REQUIREMENTS}" ]; then
  REQUIREMENTS="$(resolve "${REQUIREMENTS}")"
else
  REQUIREMENTS="${PROJECT_DIR}/requirements.txt"
fi
if [ -n "${DIST}" ]; then
  DIST="$(resolve "${DIST}")"
else
  DIST="$(dirname "${OUT_ZIP}")/$(basename "${PROJECT_DIR}")-agent-dist"
fi
WORK="$(resolve "${WORK:-.cache/maafw/${MAAFW_CORE_REPO}/${MAAFW_CORE_TAG}}")"

if [ ! -d "${PROJECT_DIR}" ]; then
  echo "error: project directory missing: ${PROJECT_DIR}" >&2
  exit 2
fi
if [ ! -f "${REQUIREMENTS}" ]; then
  echo "error: requirements file missing: ${REQUIREMENTS}" >&2
  exit 2
fi

echo "==> Building the Python ${ABI} agent runtime for ${PROJECT_DIR}…"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

NO_DEPS_ARGS=()
if [ "${NO_DEPS}" -eq 1 ]; then
  NO_DEPS_ARGS=(--no-deps)
fi

echo "  1/3  building the Python core + site-packages bundle…"
python3 "${REPO_ROOT}/scripts/build_agent_bundle.py" \
  --out "${DIST}" \
  --abi "${ABI}" \
  --requirements "${REQUIREMENTS}" \
  "${EXCLUDES[@]}" \
  "${REQUIRES[@]}" \
  --extra-index-url https://chaquo.com/pypi-13.1/ \
  "${EXTRA_INDEXES[@]}" \
  "${NO_DEPS_ARGS[@]}" \
  --core-repo "${MAAFW_CORE_REPO}" \
  --core-tag "${MAAFW_CORE_TAG}" \
  --work "${WORK}"

VENDOR_DIR="${REPO_ROOT}/vendor/maa/android/${ABI}"
case "${ABI}" in
  arm64-v8a) MAAFW_ARCH="aarch64" ;;
  x86_64) MAAFW_ARCH="x86_64" ;;
  *)
    echo "error: unsupported ABI: ${ABI}" >&2
    exit 2
    ;;
esac
if [ -f "${VENDOR_DIR}/libMaaAgentClient.so" ]; then
  echo "  2/3  reusing agent libraries from vendor/maa/android/${ABI}/…"
  mkdir -p "${TMP}/agent-libs"
  cp "${VENDOR_DIR}/libMaaAgentClient.so" "${VENDOR_DIR}/libMaaAgentServer.so" "${TMP}/agent-libs/"
else
  echo "  2/3  downloading MaaFW agent libraries…"
  curl -fsSL -o "${TMP}/maafw-android.zip" \
    "https://github.com/MaaXYZ/MaaFramework/releases/download/${MAAFW_VERSION}/MAA-android-${MAAFW_ARCH}-${MAAFW_VERSION}.zip"
  unzip -j -q "${TMP}/maafw-android.zip" \
    "bin/libMaaAgentClient.so" "bin/libMaaAgentServer.so" \
    -d "${TMP}/agent-libs"
fi

echo "  3/3  packing the archive…"
python3 "${REPO_ROOT}/src-tauri/profiles/pack_agent_bundle.py" \
  "${DIST}/${ABI}/bundle" \
  "${TMP}/agent-libs" \
  "${OUT_ZIP}" \
  --abi "${ABI}"

echo "==> Done: ${OUT_ZIP}"

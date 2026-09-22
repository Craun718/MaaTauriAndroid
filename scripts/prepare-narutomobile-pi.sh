#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

echo "==> Preparing the NarutoMobile Project Interface tree…"
python3 "${REPO_ROOT}/resource/narutomobile/tools/prepare_android_pi.py"

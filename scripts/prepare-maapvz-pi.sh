#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

echo "==> Preparing the MAAPVZ Project Interface tree..."
python3 "${REPO_ROOT}/scripts/prepare-maapvz-pi.py"

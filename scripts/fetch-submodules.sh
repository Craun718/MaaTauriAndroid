#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

echo "==> Initializing git submodules (M9A + NarutoMobile + MaaCommonAssets)…"
git submodule update --init --recursive
echo "==> Submodules ready."

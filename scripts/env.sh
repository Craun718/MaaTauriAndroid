#!/usr/bin/env bash
# Shared configuration for MaaTauriAndroid setup scripts.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Keep in sync with .github/workflows/ci.yml and vendor/maa/README.md.
MAAFW_VERSION="${MAAFW_VERSION:-v5.13.0}"
MAAFW_CORE_REPO="${MAAFW_CORE_REPO:-Craun718/MaaAgentCoreAndroid}"
MAAFW_CORE_TAG="${MAAFW_CORE_TAG:-3.13.15-maafw5.13.0}"
MAAFW_SCRIPT_REF="${MAAFW_SCRIPT_REF:-f4f6f220e21e3a1b7b0cf5df4bdbe0ec04c668f7}"

#!/usr/bin/env bash
# Shared configuration for MaaTauriAndroid setup scripts.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The repository pin lives in .maafwversion; callers may override it.
MAAFW_VERSION="${MAAFW_VERSION:-$(cat "${REPO_ROOT}/.maafwversion")}"
MAAFW_CORE_REPO="${MAAFW_CORE_REPO:-Craun718/MaaAgentCoreAndroid}"
MAAFW_CORE_TAG="${MAAFW_CORE_TAG:-agent-core-3.13.15-maafw5.15.0}"

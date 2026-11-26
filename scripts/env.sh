#!/usr/bin/env bash
# Shared configuration for MaaTauriAndroid setup scripts.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Standalone runtime builders may select another release; APK builds verify
# MAAFW_VERSION against the version paired with the pinned Rust binding.
MAAFW_PIN="$(cat "${REPO_ROOT}/.maafwversion")"
MAAFW_VERSION="${MAAFW_VERSION:-${MAAFW_PIN}}"

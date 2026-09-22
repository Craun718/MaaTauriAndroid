import type { MessageKey } from "./i18n";
import type { UpdateFailureCode } from "./types";

/**
 * Backend failure codes map onto catalog keys so the card follows the
 * interface language; the raw English diagnostic stays available through
 * `status.failureDetail` for anyone who needs the original text.
 */
const failureKeys: Record<UpdateFailureCode, MessageKey> = {
  network: "updateFailureNetwork",
  invalidResponse: "updateFailureInvalidResponse",
  cdkRequired: "updateFailureCdkRequired",
  cdkInvalid: "updateFailureCdkInvalid",
  cdkExpired: "updateFailureCdkExpired",
  cdkDisabled: "updateFailureCdkDisabled",
  cdkQuotaExceeded: "updateFailureCdkQuotaExceeded",
  cdkMismatch: "updateFailureCdkMismatch",
  resourceNotFound: "updateFailureResourceNotFound",
  resourceUnavailable: "updateFailureResourceUnavailable",
  invalidDigest: "updateFailureInvalidDigest",
  noMatchingAsset: "updateFailureNoMatchingAsset",
  downloadFailed: "updateFailureDownloadFailed",
  storage: "updateFailureStorage",
  installerNotFound: "updateFailureInstallerNotFound",
  internal: "updateFailureInternal",
};

export function updateFailureKey(failure: UpdateFailureCode): MessageKey {
  return failureKeys[failure];
}

/** Human-readable download size; null means "not known yet" and renders empty. */
export function formatUpdateBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Download progress as a 0-100 integer; without a total the progress is
 * indeterminate and the card shows the transferred size instead.
 */
export function updateProgressPercent(
  downloadedBytes: number | null,
  totalBytes: number | null,
): number | null {
  if (downloadedBytes === null || totalBytes === null || totalBytes <= 0) {
    return null;
  }
  return Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
}

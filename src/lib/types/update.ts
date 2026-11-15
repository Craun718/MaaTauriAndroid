export type UpdatePhase =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "resolving"
  | "downloading"
  | "installPrompted"
  | "installFailed";

/** Backend failure codes; `cancelled` never reaches the frontend. */
export type UpdateFailureCode =
  | "network"
  | "invalidResponse"
  | "cdkRequired"
  | "cdkInvalid"
  | "cdkExpired"
  | "cdkDisabled"
  | "cdkQuotaExceeded"
  | "cdkMismatch"
  | "resourceNotFound"
  | "resourceUnavailable"
  | "invalidDigest"
  | "noMatchingAsset"
  | "downloadFailed"
  | "storage"
  | "installerNotFound"
  | "internal";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  releaseNote: string | null;
  failure: UpdateFailureCode | null;
  /** English backend diagnostic; the interface localizes via the failure code. */
  failureDetail: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  /** Backend-sampled transfer rate; null until enough data is available. */
  bytesPerSecond: number | null;
  /** Present once a verified APK is ready to hand to the installer. */
  apkPath: string | null;
}

export type UpdateSourceSetting = "auto" | "mirrorchyan" | "github";

export type UpdateChannelSetting = "stable" | "beta";

export interface UpdatePrefs {
  source: UpdateSourceSetting;
  channel: UpdateChannelSetting;
  cdk: string;
  githubToken: string;
}

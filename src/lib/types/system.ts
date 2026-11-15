export interface PreparationProgress {
  phase: "copying" | "extracting";
  copiedBytes: number;
  totalArchiveBytes: number;
  extractedEntries: number;
  totalEntries: number;
  currentFile?: string;
}

export interface PreparationState {
  revision: number;
  status: "idle" | "running" | "ready" | "failed";
  stage: string;
  projectReady: boolean;
  uiReady: boolean;
  engineReady: boolean;
  projectRoot?: string;
  progress?: PreparationProgress;
  error?: string;
}

export interface WelcomeState {
  revision: number;
  welcome: string[];
  welcomeFingerprint?: string;
  welcomePending: boolean;
  welcomeErrors?: string[];
}

/** Versions the About and version cards show. */
export interface VersionInfo {
  appVersion: string;
  frameworkVersion: string;
  /** Tag of this checkout, or its short commit hash when HEAD has no tag. */
  appTag: string;
  /** Tag (or short commit hash) supplied for the packaged resource at build time. */
  resourceTag?: string;
  /** Device facts the diagnostic export collects; absent on desktop. */
  environment?: EnvironmentInfo;
}

/** Device facts the shell reads from `android.os.Build`. */
export interface EnvironmentInfo {
  time: string;
  device: string;
  android: string;
  sdkInt: number;
  abi: string;
  versionName: string;
  versionCode: number;
  buildType: string;
}

export interface VirtualDisplayStatus {
  active: boolean;
  displayId: number;
  width: number;
  height: number;
  frameCount: number;
  capabilities?: {
    flagTier: number;
    requestedFlags: number;
    effectiveFlags: number;
    displayGroupId: number;
    compatibilityMode: boolean;
  } | null;
}

/**
 * Advisory display settings detected before a run. `eyeProtectionSource` is
 * the matched vendor settings key and is null when eye-comfort mode is off.
 */
export interface DisplayHazards {
  smartResolution: boolean;
  adbInputRestricted?: boolean;
  eyeProtectionSource?: string | null;
}

export type PrivilegedBackend = "shizuku" | "root";

export type PrivilegedStatus =
  | {
      status: "starting";
      message: string;
      setupRequired: string[];
      backend: PrivilegedBackend;
    }
  | { status: "connected"; message: string; backend: PrivilegedBackend }
  | {
      status: "permissionRequired" | "notInstalled" | "disconnected" | "error";
      message: string;
      setupRequired: string[];
      backend: PrivilegedBackend;
    };

export interface DiagnosticItem {
  name: string;
  present: boolean;
  byteLength?: number;
  sha256?: string;
  reason?: string;
}

export interface DiagnosticManifest {
  schemaVersion: number;
  executionId: string;
  createdAtUnixMs: number;
  status: "complete" | "partial";
  privacyConfirmation: string;
  items: DiagnosticItem[];
  partialReasons: string[];
}

export interface DiagnosticExport {
  path: string;
  manifest: DiagnosticManifest;
}

export interface LogExport {
  path: string;
  /** Display name of the copy saved into the Downloads folder (Android). */
  fileName?: string;
}

export type OptionValue =
  | { type: "single"; case: string }
  | { type: "multiple"; cases: string[] }
  | { type: "inputs"; values: Record<string, string> };

export interface ConfiguredTask {
  instanceId: string;
  taskName: string;
  enabled: boolean;
  optionValues: Record<string, OptionValue>;
  customLabel?: string;
}

export interface RunConfiguration {
  id: string;
  name: string;
  tasks: ConfiguredTask[];
}

/** Points at a generated image in this device's private background directory. */
export interface BackgroundImage {
  fileName: string;
  revision: number;
}

/**
 * Language the app interface is rendered in. "system" follows the device locale:
 * Chinese for `zh*` tags, English for everything else.
 */
export type UiLanguage = "system" | "zh" | "en";

/**
 * What the user configured. There is no controller field: Android can only drive
 * its own native control unit, so the controller is a property of the platform
 * (see `activeController` in `lib/options.ts`), not a per-user choice.
 */
export interface UserConfiguration {
  schemaVersion: number;
  initialized: boolean;
  forceStopTargetApp: boolean;
  closeTargetAppAfterRun: boolean;
  /** Exit the whole Android app after a natural run end. */
  exitAppAfterRun?: boolean;
  /** Stops a run after this many seconds; `0` or absent disables the limit. */
  maxRunDurationSeconds?: number;
  foregroundMode?: boolean;
  /** Foreground-mode floating control panel; needs the overlay permission. */
  foregroundOverlay?: boolean;
  telemetryEnabled: boolean;
  showVirtualDisplayTouches?: boolean;
  showVirtualDisplayFps?: boolean;
  /** Automatically show the virtual display in PiP when returning home. */
  pipOnHome?: boolean;
  debugMode?: boolean;
  uiLanguage?: UiLanguage;
  activeResource?: string;
  pretaskValues: Record<string, import("./project").ConfiguredPretask>;
  globalOptionValues: Record<string, OptionValue>;
  controllerOptionValues: Record<string, Record<string, OptionValue>>;
  resourceOptionValues: Record<string, Record<string, OptionValue>>;
  runConfigurations: RunConfiguration[];
  activeRunConfigurationId?: string;
  /** Interface task groups from the most recently loaded resource. */
  taskGroups?: Record<string, string[]>;
  welcomeFingerprint?: string;
  welcomeAcknowledgedAppVersion?: string;
  skipWelcomeAnnouncement?: boolean;
  /** Latest in-app guide revision seen by this user. */
  guideSeenVersion?: number;
  backgroundImage?: BackgroundImage;
  /** Card fill opacity, as a percentage. */
  backgroundCardOpacity?: number;
}

export type ConfigurationRecoveryKind = "backupRestored" | "resetToDefault";
export type ConfigurationRecoveryReason = "parse" | "secret";

export interface ConfigurationRecovery {
  kind: ConfigurationRecoveryKind;
  reason: ConfigurationRecoveryReason;
}

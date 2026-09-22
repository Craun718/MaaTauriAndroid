export type OptionKind = "select" | "switch" | "checkbox" | "input" | "hotkey";

export interface OptionApplicability {
  controllers: string[];
  resources: string[];
}

export interface ControllerDefinition {
  name: string;
  label: string;
  controllerType: string;
}

export interface ResourceDefinition {
  name: string;
  label: string;
  description?: string;
  paths: string[];
  controllers: string[];
  options: string[];
  hash?: string;
}

export interface GroupDefinition {
  name: string;
  label: string;
  description?: string;
  defaultExpand: boolean;
}

export interface TaskDefinition {
  name: string;
  label: string;
  entry: string;
  description?: string;
  groups: string[];
  controllers: string[];
  resources: string[];
  options: string[];
  defaultCheck: boolean;
}

export interface OptionCase {
  name: string;
  label: string;
  description?: string;
  options: string[];
}

export interface InputFieldDefinition {
  name: string;
  label: string;
  description?: string;
  default?: string;
  pipelineType: "string" | "int" | "bool";
  verify?: string;
  patternMessage?: string;
  password: boolean;
}

export type OptionDefinition =
  | {
      kind: "select";
      name: string;
      label: string;
      description?: string;
      cases: OptionCase[];
      defaultCase?: string;
      applicability: OptionApplicability;
    }
  | {
      kind: "switch";
      name: string;
      label: string;
      description?: string;
      cases: OptionCase[];
      defaultCase?: string;
      applicability: OptionApplicability;
    }
  | {
      kind: "checkbox";
      name: string;
      label: string;
      description?: string;
      cases: OptionCase[];
      defaultCases: string[];
      minCount?: number;
      maxCount?: number;
      applicability: OptionApplicability;
    }
  | {
      kind: "input";
      name: string;
      label: string;
      description?: string;
      inputs: InputFieldDefinition[];
      applicability: OptionApplicability;
    }
  | {
      kind: "hotkey";
      name: string;
      label: string;
      description?: string;
      hotkeys: Array<{ name: string; label: string; default?: string }>;
      applicability: OptionApplicability;
    };

export interface ProjectMetadata {
  title?: string;
  github?: string;
  welcome: string[];
  welcomeFingerprint?: string;
  welcomeErrors?: string[];
  telemetry?: TelemetryConfig;
}

export interface TelemetryConfig {
  dsn?: string;
  tracing: boolean;
  tracesSampleRate: number;
  failureAttachmentsSampleRate: number;
  environment?: string;
}

export interface Project {
  root: string;
  interfaceVersion: number;
  name: string;
  label: string;
  version?: string;
  language: string;
  languages: string[];
  controllers: ControllerDefinition[];
  resources: ResourceDefinition[];
  groups: GroupDefinition[];
  tasks: TaskDefinition[];
  options: Record<string, OptionDefinition>;
  globalOptions: string[];
  presets: ConfigurationTemplate[];
  metadata: ProjectMetadata;
}

export interface ConfigurationTemplate {
  name: string;
  label: string;
  description?: string;
  tasks: TemplateTask[];
}

export interface TemplateTask {
  taskName: string;
  enabled: boolean;
  option: Record<string, OptionValue>;
  label: string;
}

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

export type ScheduleTrigger =
  | { kind: "fixedTime"; days: number[]; times: string[] }
  | {
      kind: "interval";
      startEpochMs: number;
      intervalDays: number;
      intervalHours: number;
    };

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  runConfigurationId: string;
  trigger: ScheduleTrigger;
}

export type ScheduleRuleStatus = ScheduleRule & {
  nextTriggerEpochMs?: number;
};

export type ScheduleTriggerResult =
  | "started"
  | "duplicate"
  | "rejectedActive"
  | "failedValidation"
  | "failedServiceStart"
  | "foregroundServiceDenied";

export interface ScheduleTriggerLogEntry {
  ruleId: string;
  scheduledEpochMs: number;
  actualEpochMs: number;
  result: ScheduleTriggerResult;
  detail?: string | null;
}

export interface ScheduleSummary {
  ruleCount: number;
  enabledCount: number;
  nextTriggerEpochMs?: number;
  lastTrigger?: ScheduleTriggerLogEntry;
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
  telemetryEnabled: boolean;
  showVirtualDisplayTouches?: boolean;
  showVirtualDisplayFps?: boolean;
  uiLanguage?: UiLanguage;
  activeResource?: string;
  globalOptionValues: Record<string, OptionValue>;
  controllerOptionValues: Record<string, Record<string, OptionValue>>;
  resourceOptionValues: Record<string, Record<string, OptionValue>>;
  runConfigurations: RunConfiguration[];
  activeRunConfigurationId?: string;
  welcomeFingerprint?: string;
  welcomeAcknowledgedAppVersion?: string;
  skipWelcomeAnnouncement?: boolean;
}

export interface AppStateSnapshot {
  project?: Project;
  configuration: UserConfiguration;
  projectPath?: string;
  /** Versions for the About card, filled by the shell on bootstrap and project load. */
  versions?: VersionInfo;
}

/** Versions the About and version cards show. */
export interface VersionInfo {
  appVersion: string;
  frameworkVersion: string;
  /** Tag of this checkout, or its short commit hash when HEAD has no tag. */
  appTag: string;
  /** Tag (or short commit hash) of the loaded resource's own checkout. */
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

export interface ResolvedTask {
  task: TaskDefinition;
  configured?: ConfiguredTask;
  enabled: boolean;
  unavailableReason?: string;
  pipelineOverride: Record<string, unknown>;
}

export interface ResolvedRun {
  controller: ControllerDefinition;
  resource: ResourceDefinition;
  tasks: ResolvedTask[];
  basePipeline: Record<string, unknown>;
  pipelineOverride: Record<string, unknown>;
}

export type RunState = "Idle" | "Preparing" | "Running" | "Stopping";

export type RunResultSeverity = "info" | "error";

export type RunEventKind =
  | "started"
  | "preparing"
  | "task"
  | "stopping"
  | "failure"
  | "warning"
  | "focus"
  | "completed"
  | "cancelled"
  | "screenshot";

export interface RunEvent {
  executionId: string;
  sequence: number;
  atUnixMs: number;
  kind: RunEventKind;
  state: RunState;
  message: string;
  taskName?: string;
  data?: Record<string, unknown>;
}

export interface RunResult {
  executionId?: string;
  state: RunState;
  severity?: RunResultSeverity;
  message: string;
}

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
  /** Present once a verified APK is ready to hand to the installer. */
  apkPath: string | null;
}

export type UpdateSourceSetting = "auto" | "mirrorchyan" | "github";

export type UpdateChannelSetting = "stable" | "beta";

export interface UpdatePrefs {
  source: UpdateSourceSetting;
  channel: UpdateChannelSetting;
  cdk: string;
}

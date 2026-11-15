import type {
  ConfigurationRecovery,
  ConfiguredTask,
  UserConfiguration,
} from "./configuration";
import type {
  ControllerDefinition,
  Project,
  ResourceDefinition,
  TaskDefinition,
} from "./project";
import type { VersionInfo } from "./system";

export type TaskRunSelectionMode = "current" | "currentAndFollowing";

export interface TaskRunSelection {
  runConfigurationId: string;
  instanceId: string;
  mode: TaskRunSelectionMode;
}

export interface AppStateSnapshot {
  project?: Project;
  configuration: UserConfiguration;
  projectPath?: string;
  configurationRecovery?: ConfigurationRecovery;
  /** Welcome event revision represented by this snapshot; absent in legacy snapshots. */
  welcomeRevision?: number;
  /** Versions for the About card, filled by the shell on bootstrap and project load. */
  versions?: VersionInfo;
}

export interface ConfigurationExport {
  path: string;
  /** Downloads copy saved by Android; absent when only a temp path is available. */
  fileName?: string;
}

export interface ConfigurationImportResult {
  imported: boolean;
  snapshot?: AppStateSnapshot;
}

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

/** The backend's answer to `start_run`, before any run event arrives. */
export interface StartRunStatus {
  executionId: string;
  message: string;
  taskCount: number;
}

/** One persisted run: metadata read from the JSONL file name, no file content. */
export interface RunHistoryEntry {
  executionId: string;
  fileName: string;
  startedAtUnixMs: number;
  sizeBytes: number;
  taskCount: number;
}

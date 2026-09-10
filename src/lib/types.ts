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

export interface UserConfiguration {
  schemaVersion: number;
  initialized: boolean;
  activeController?: string;
  activeResource?: string;
  globalOptionValues: Record<string, OptionValue>;
  controllerOptionValues: Record<string, Record<string, OptionValue>>;
  resourceOptionValues: Record<string, Record<string, OptionValue>>;
  runConfigurations: RunConfiguration[];
  activeRunConfigurationId?: string;
  welcomeFingerprint?: string;
}

export interface AppStateSnapshot {
  project?: Project;
  configuration: UserConfiguration;
  projectPath?: string;
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

export type RunEventKind =
  | "started"
  | "preparing"
  | "task"
  | "stopping"
  | "failure"
  | "completed"
  | "cancelled";

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

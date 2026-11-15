import type { OptionValue } from "./configuration";

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
  placeholder?: string;
  default?: string;
  pipelineType: "string" | "int" | "bool";
  verify?: string;
  patternMessage?: string;
  password: boolean;
  inputType: "text" | "file" | "directory" | "time";
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
  /** Contact body, materialized from a project file by the loader when the interface references one. */
  contact?: string;
  /** License body, materialized from a project file by the loader when the interface references one. */
  license?: string;
  welcome: string[];
  welcomeFingerprint?: string;
  welcomePending?: boolean;
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
  settingSections: SettingSection[];
  tasks: TaskDefinition[];
  pretasks: PretaskDefinition[];
  options: Record<string, OptionDefinition>;
  globalOptions: string[];
  presets: ConfigurationTemplate[];
  metadata: ProjectMetadata;
}

export interface SettingSection {
  name: string;
  label: string;
  description?: string;
  icon?: string;
  defaultExpand: boolean;
  options: string[];
}

export interface ConfigurationTemplate {
  name: string;
  label: string;
  description?: string;
  tasks: TemplateTask[];
  /** Omitted preserves settings; an empty list disables every pre-task. */
  pretasks?: TemplatePretask[];
}

export interface TemplatePretask {
  name: string;
  enabled: boolean;
  option: Record<string, OptionValue>;
}

export interface TemplateTask {
  taskName: string;
  enabled: boolean;
  option: Record<string, OptionValue>;
  label: string;
}

export interface PretaskDefinition {
  /** Configuration identity; anonymous entries use exec plus declaration index. */
  name: string;
  explicitName?: string;
  label: string;
  description?: string;
  icon?: string;
  exec: string;
  args: string[];
  options: string[];
  controllers: string[];
  resources: string[];
}

export interface ConfiguredPretask {
  enabled: boolean;
  optionValues: Record<string, OptionValue>;
}

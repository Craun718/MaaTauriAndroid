use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub root: String,
    pub interface_version: u8,
    pub name: String,
    pub label: String,
    pub version: Option<String>,
    pub language: String,
    pub languages: Vec<String>,
    pub controllers: Vec<ControllerDefinition>,
    pub resources: Vec<ResourceDefinition>,
    pub groups: Vec<GroupDefinition>,
    pub tasks: Vec<TaskDefinition>,
    pub options: BTreeMap<String, OptionDefinition>,
    pub global_options: Vec<String>,
    pub presets: Vec<ConfigurationTemplate>,
    pub agents: Vec<AgentDefinition>,
    pub metadata: ProjectMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerDefinition {
    pub name: String,
    pub label: String,
    pub controller_type: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDefinition {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub paths: Vec<String>,
    pub controllers: Vec<String>,
    pub options: Vec<String>,
    pub hash: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDefinition {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub default_expand: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDefinition {
    pub name: String,
    pub label: String,
    pub entry: String,
    pub description: Option<String>,
    pub groups: Vec<String>,
    pub controllers: Vec<String>,
    pub resources: Vec<String>,
    pub options: Vec<String>,
    pub pipeline_override: Value,
    pub default_check: bool,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionApplicability {
    pub controllers: Vec<String>,
    pub resources: Vec<String>,
}

impl OptionApplicability {
    pub fn matches(&self, controller: &str, resource: Option<&str>) -> bool {
        (self.controllers.is_empty() || self.controllers.iter().any(|item| item == controller))
            && (self.resources.is_empty()
                || resource
                    .is_some_and(|current| self.resources.iter().any(|item| item == current)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum OptionDefinition {
    Select {
        name: String,
        label: String,
        description: Option<String>,
        cases: Vec<OptionCase>,
        default_case: Option<String>,
        icon: Option<String>,
        applicability: OptionApplicability,
    },
    Switch {
        name: String,
        label: String,
        description: Option<String>,
        cases: Vec<OptionCase>,
        default_case: Option<String>,
        icon: Option<String>,
        applicability: OptionApplicability,
    },
    Checkbox {
        name: String,
        label: String,
        description: Option<String>,
        cases: Vec<OptionCase>,
        default_cases: Vec<String>,
        min_count: Option<u32>,
        max_count: Option<u32>,
        icon: Option<String>,
        applicability: OptionApplicability,
    },
    Input {
        name: String,
        label: String,
        description: Option<String>,
        inputs: Vec<InputFieldDefinition>,
        pipeline_override: Value,
        icon: Option<String>,
        applicability: OptionApplicability,
    },
    Hotkey {
        name: String,
        label: String,
        description: Option<String>,
        hotkeys: Vec<HotkeyFieldDefinition>,
        pipeline_override: Value,
        icon: Option<String>,
        applicability: OptionApplicability,
    },
}

impl OptionDefinition {
    pub fn name(&self) -> &str {
        match self {
            Self::Select { name, .. }
            | Self::Switch { name, .. }
            | Self::Checkbox { name, .. }
            | Self::Input { name, .. }
            | Self::Hotkey { name, .. } => name,
        }
    }

    pub fn label(&self) -> &str {
        match self {
            Self::Select { label, .. }
            | Self::Switch { label, .. }
            | Self::Checkbox { label, .. }
            | Self::Input { label, .. }
            | Self::Hotkey { label, .. } => label,
        }
    }

    pub fn description(&self) -> Option<&str> {
        match self {
            Self::Select { description, .. }
            | Self::Switch { description, .. }
            | Self::Checkbox { description, .. }
            | Self::Input { description, .. }
            | Self::Hotkey { description, .. } => description.as_deref(),
        }
    }

    pub fn icon(&self) -> Option<&str> {
        match self {
            Self::Select { icon, .. }
            | Self::Switch { icon, .. }
            | Self::Checkbox { icon, .. }
            | Self::Input { icon, .. }
            | Self::Hotkey { icon, .. } => icon.as_deref(),
        }
    }

    pub fn applicability(&self) -> &OptionApplicability {
        match self {
            Self::Select { applicability, .. }
            | Self::Switch { applicability, .. }
            | Self::Checkbox { applicability, .. }
            | Self::Input { applicability, .. }
            | Self::Hotkey { applicability, .. } => applicability,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionCase {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub options: Vec<String>,
    pub pipeline_override: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputFieldDefinition {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub default: Option<String>,
    #[serde(alias = "pipeline_type")]
    pub pipeline_type: PipelineType,
    pub verify: Option<String>,
    #[serde(alias = "pattern_msg")]
    pub pattern_message: Option<String>,
    #[serde(default)]
    pub password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyFieldDefinition {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub default: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PipelineType {
    String,
    Int,
    Bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationTemplate {
    pub name: String,
    pub label: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub tasks: Vec<TemplateTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateTask {
    pub task_name: String,
    pub enabled: bool,
    #[serde(default)]
    pub option: BTreeMap<String, OptionValue>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub child_exec: String,
    pub child_args: Vec<String>,
    pub identifier: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub contact: Option<String>,
    pub license: Option<String>,
    pub github: Option<String>,
    pub welcome: Vec<String>,
    pub welcome_fingerprint: Option<String>,
    pub welcome_errors: Vec<String>,
    pub mirrorchyan_rid: Option<String>,
    pub mirrorchyan_multiplatform: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum OptionValue {
    Single {
        case: String,
    },
    Multiple {
        #[serde(default)]
        cases: Vec<String>,
    },
    Inputs {
        #[serde(default)]
        values: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConfiguration {
    pub schema_version: u32,
    pub initialized: bool,
    pub active_controller: Option<String>,
    pub active_resource: Option<String>,
    pub global_option_values: BTreeMap<String, OptionValue>,
    pub controller_option_values: BTreeMap<String, BTreeMap<String, OptionValue>>,
    pub resource_option_values: BTreeMap<String, BTreeMap<String, OptionValue>>,
    pub run_configurations: Vec<RunConfiguration>,
    pub active_run_configuration_id: Option<String>,
    pub welcome_fingerprint: Option<String>,
}

impl Default for UserConfiguration {
    fn default() -> Self {
        Self {
            schema_version: 1,
            initialized: false,
            active_controller: None,
            active_resource: None,
            global_option_values: BTreeMap::new(),
            controller_option_values: BTreeMap::new(),
            resource_option_values: BTreeMap::new(),
            run_configurations: Vec::new(),
            active_run_configuration_id: None,
            welcome_fingerprint: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfiguration {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tasks: Vec<ConfiguredTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredTask {
    pub instance_id: String,
    pub task_name: String,
    pub enabled: bool,
    #[serde(default)]
    pub option_values: BTreeMap<String, OptionValue>,
    pub custom_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTask {
    pub task: TaskDefinition,
    pub configured: Option<ConfiguredTask>,
    pub enabled: bool,
    pub unavailable_reason: Option<String>,
    pub pipeline_override: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRun {
    pub controller: ControllerDefinition,
    pub resource: ResourceDefinition,
    pub tasks: Vec<ResolvedTask>,
    pub base_pipeline: Value,
    pub pipeline_override: Value,
}

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
// `rename_all` renames the variants, which is what the `kind` tag carries;
// `rename_all_fields` only renames the fields inside them. Both are needed: the
// interface compares `option.kind` against "select" / "switch" / "checkbox" /
// "input" / "hotkey", the same spelling loader.rs parses out of interface.json.
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
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
    #[serde(alias = "pipeline_type", default)]
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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PipelineType {
    #[default]
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

/// Anonymous telemetry declared by the resource project (`telemetry.sentry`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryConfig {
    #[serde(default)]
    pub dsn: Option<String>,
    #[serde(default = "default_true")]
    pub tracing: bool,
    #[serde(default = "default_one")]
    pub traces_sample_rate: f64,
    #[serde(default = "default_one")]
    pub failure_attachments_sample_rate: f64,
    #[serde(default)]
    pub environment: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_one() -> f64 {
    1.0
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
    pub telemetry: Option<TelemetryConfig>,
    #[serde(skip_serializing, default)]
    pub translations: BTreeMap<String, String>,
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

/// Language the app interface is rendered in. `System` follows the device locale,
/// which resolves to Chinese for `zh*` tags and English for everything else.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    #[default]
    System,
    Zh,
    En,
}

/// What the user configured, as opposed to what the project declared.
///
/// There is no controller field: Android can only drive its own native control
/// unit, so the controller is a property of the platform (see
/// `loader::android_controller`), not something to remember per user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConfiguration {
    pub schema_version: u32,
    pub initialized: bool,
    #[serde(default)]
    pub force_stop_target_app: bool,
    #[serde(default = "default_true")]
    pub close_target_app_after_run: bool,
    /// Run against the physical primary display instead of a private virtual
    /// display. This only takes effect on the next run.
    #[serde(default)]
    pub foreground_mode: bool,
    #[serde(default)]
    pub telemetry_enabled: bool,
    #[serde(default = "default_true")]
    pub show_virtual_display_touches: bool,
    /// Only gates the on-screen FPS badge; low frame-rate warnings are always
    /// written to the run log regardless of this switch.
    #[serde(default = "default_true")]
    pub show_virtual_display_fps: bool,
    /// User-facing debug switch: unlocks the app's own debug logging and turns
    /// on MaaFramework's debug mode (recognition snapshots and debug draws).
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub ui_language: UiLanguage,
    pub active_resource: Option<String>,
    pub global_option_values: BTreeMap<String, OptionValue>,
    pub controller_option_values: BTreeMap<String, BTreeMap<String, OptionValue>>,
    pub resource_option_values: BTreeMap<String, BTreeMap<String, OptionValue>>,
    pub run_configurations: Vec<RunConfiguration>,
    pub active_run_configuration_id: Option<String>,
    pub welcome_fingerprint: Option<String>,
    pub welcome_acknowledged_app_version: Option<String>,
    #[serde(default)]
    pub skip_welcome_announcement: bool,
}

impl Default for UserConfiguration {
    fn default() -> Self {
        Self {
            schema_version: 1,
            initialized: false,
            force_stop_target_app: false,
            close_target_app_after_run: true,
            foreground_mode: false,
            telemetry_enabled: false,
            show_virtual_display_touches: true,
            show_virtual_display_fps: true,
            debug_mode: false,
            ui_language: UiLanguage::System,
            active_resource: None,
            global_option_values: BTreeMap::new(),
            controller_option_values: BTreeMap::new(),
            resource_option_values: BTreeMap::new(),
            run_configurations: Vec::new(),
            active_run_configuration_id: None,
            welcome_fingerprint: None,
            welcome_acknowledged_app_version: None,
            skip_welcome_announcement: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_configuration_defaults_force_stop_to_false() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy.as_object_mut().unwrap().remove("forceStopTargetApp");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(!parsed.force_stop_target_app);
    }

    #[test]
    fn legacy_configuration_defaults_close_app_after_run_to_true() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("closeTargetAppAfterRun");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(parsed.close_target_app_after_run);
    }

    #[test]
    fn legacy_configuration_defaults_foreground_mode_to_false() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy.as_object_mut().unwrap().remove("foregroundMode");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(!parsed.foreground_mode);
    }

    #[test]
    fn legacy_configuration_defaults_the_fps_badge_to_true() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("showVirtualDisplayFps");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(parsed.show_virtual_display_fps);
    }

    #[test]
    fn legacy_configuration_defaults_debug_mode_to_false() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy.as_object_mut().unwrap().remove("debugMode");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(!parsed.debug_mode);
    }

    #[test]
    fn legacy_configuration_follows_the_system_language() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy.as_object_mut().unwrap().remove("uiLanguage");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert_eq!(parsed.ui_language, UiLanguage::System);
    }

    #[test]
    fn legacy_configuration_defaults_touch_markers_to_true() {
        let current = UserConfiguration::default();
        let mut legacy = serde_json::to_value(&current).unwrap();
        legacy
            .as_object_mut()
            .unwrap()
            .remove("showVirtualDisplayTouches");

        let parsed: UserConfiguration = serde_json::from_value(legacy).unwrap();

        assert!(parsed.show_virtual_display_touches);
    }

    #[test]
    fn touch_markers_round_trip_through_the_configuration() {
        let mut configuration = UserConfiguration::default();
        configuration.show_virtual_display_touches = true;

        let encoded = serde_json::to_value(&configuration).unwrap();
        assert_eq!(
            encoded["showVirtualDisplayTouches"],
            serde_json::json!(true)
        );

        let decoded: UserConfiguration = serde_json::from_value(encoded).unwrap();
        assert!(decoded.show_virtual_display_touches);
    }

    #[test]
    fn ui_language_round_trips_through_the_configuration() {
        let mut configuration = UserConfiguration::default();
        configuration.ui_language = UiLanguage::Zh;

        let encoded = serde_json::to_value(&configuration).unwrap();
        assert_eq!(encoded["uiLanguage"], serde_json::json!("zh"));

        let decoded: UserConfiguration = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded.ui_language, UiLanguage::Zh);
    }

    #[test]
    fn foreground_mode_round_trips_through_the_configuration() {
        let mut configuration = UserConfiguration::default();
        configuration.foreground_mode = true;

        let encoded = serde_json::to_value(&configuration).unwrap();
        assert_eq!(encoded["foregroundMode"], serde_json::json!(true));

        let decoded: UserConfiguration = serde_json::from_value(encoded).unwrap();
        assert!(decoded.foreground_mode);
    }

    #[test]
    fn rejects_an_invalid_foreground_mode() {
        let mut encoded = serde_json::to_value(UserConfiguration::default()).unwrap();
        encoded["foregroundMode"] = serde_json::json!("foreground");

        assert!(serde_json::from_value::<UserConfiguration>(encoded).is_err());
    }

    /// The interface switches on the `kind` tag, so the variant names have to reach
    /// the webview lowercased — the same spelling `loader.rs` reads out of
    /// interface.json. Tagging with `rename_all_fields` alone left them as
    /// "Select" / "Input", every `option.kind === "…"` comparison missed, and
    /// `defaultOptionValue` fell through to `cases[0]` on an input option, which
    /// carries no `cases` at all. That threw during render and blanked the page.
    #[test]
    fn option_definition_kinds_are_tagged_in_lowercase() {
        let applicability = || OptionApplicability {
            controllers: Vec::new(),
            resources: Vec::new(),
        };
        let case = || OptionCase {
            name: "case".into(),
            label: "Case".into(),
            description: None,
            icon: None,
            options: Vec::new(),
            pipeline_override: Value::Null,
        };
        let named = |kind: &str| (kind.to_string(), kind.to_string());

        let options = [
            {
                let (name, label) = named("select");
                OptionDefinition::Select {
                    name,
                    label,
                    description: None,
                    cases: vec![case()],
                    default_case: None,
                    icon: None,
                    applicability: applicability(),
                }
            },
            {
                let (name, label) = named("switch");
                OptionDefinition::Switch {
                    name,
                    label,
                    description: None,
                    cases: vec![case()],
                    default_case: None,
                    icon: None,
                    applicability: applicability(),
                }
            },
            {
                let (name, label) = named("checkbox");
                OptionDefinition::Checkbox {
                    name,
                    label,
                    description: None,
                    cases: vec![case()],
                    default_cases: Vec::new(),
                    min_count: None,
                    max_count: None,
                    icon: None,
                    applicability: applicability(),
                }
            },
            {
                let (name, label) = named("input");
                OptionDefinition::Input {
                    name,
                    label,
                    description: None,
                    inputs: Vec::new(),
                    pipeline_override: Value::Null,
                    icon: None,
                    applicability: applicability(),
                }
            },
            {
                let (name, label) = named("hotkey");
                OptionDefinition::Hotkey {
                    name,
                    label,
                    description: None,
                    hotkeys: Vec::new(),
                    pipeline_override: Value::Null,
                    icon: None,
                    applicability: applicability(),
                }
            },
        ];

        let kinds: Vec<String> = options
            .iter()
            .map(|option| {
                let encoded = serde_json::to_value(option).unwrap();
                encoded["kind"].as_str().unwrap().to_owned()
            })
            .collect();

        assert_eq!(kinds, ["select", "switch", "checkbox", "input", "hotkey"]);
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

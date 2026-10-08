use crate::domain::types::{
    InputFieldDefinition, OptionDefinition, OptionValue, Project, ScheduleRule, UserConfiguration,
};
use crate::schedule;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};

pub const BACKUP_KIND: &str = "maa-tauri-android-configuration";
pub const BACKUP_VERSION: u32 = 1;
pub const MAX_IMPORT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ConfigurationBackupError {
    #[error("unsupported configuration backup kind: {found}")]
    Kind { found: String },
    #[error(
        "unsupported configuration backup version: {found}; the current version is {supported}"
    )]
    Version { found: u32, supported: u32 },
    #[error("the backup belongs to project \"{found}\", not \"{expected}\"")]
    ProjectMismatch { expected: String, found: String },
    #[error(
        "unsupported configuration schema version: {found}; the current version is {supported}"
    )]
    SchemaVersion { found: u32, supported: u32 },
    #[error("the configuration backup exceeds the {} MiB limit", MAX_IMPORT_BYTES / (1024 * 1024))]
    TooLarge,
    #[error("invalid configuration backup: {0}")]
    Validation(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationBackupProject {
    pub name: String,
    pub interface_version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationBackup {
    pub kind: String,
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub app_version: String,
    pub project: ConfigurationBackupProject,
    pub passwords_excluded: bool,
    pub configuration: UserConfiguration,
    #[serde(default)]
    pub schedule_rules: Vec<ScheduleRule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationBackupExport<'a> {
    pub kind: &'static str,
    pub version: u32,
    pub exported_at: DateTime<Utc>,
    pub app_version: String,
    pub project: ConfigurationBackupProject,
    pub passwords_excluded: bool,
    pub configuration: &'a UserConfiguration,
    pub schedule_rules: &'a [ScheduleRule],
}

pub fn export_configuration(
    project: &Project,
    configuration: &UserConfiguration,
    schedule_rules: &[ScheduleRule],
) -> ConfigurationBackupExport<'_> {
    let sanitized = remove_password_values(project, configuration.clone());
    ConfigurationBackupExport {
        kind: BACKUP_KIND,
        version: BACKUP_VERSION,
        exported_at: Utc::now(),
        app_version: crate::version::APP_VERSION.to_string(),
        project: ConfigurationBackupProject {
            name: project.name.clone(),
            interface_version: project.interface_version,
        },
        passwords_excluded: true,
        configuration: &sanitized,
        schedule_rules,
    }
}

pub fn serialize_configuration(
    backup: &ConfigurationBackupExport<'_>,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec_pretty(backup)
}

pub fn parse_configuration(
    bytes: &[u8],
    expected_project: &str,
) -> Result<ConfigurationBackup, ConfigurationBackupError> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(ConfigurationBackupError::TooLarge);
    }
    let backup = serde_json::from_slice::<ConfigurationBackup>(bytes)?;
    if backup.kind != BACKUP_KIND {
        return Err(ConfigurationBackupError::Kind { found: backup.kind });
    }
    if backup.version > BACKUP_VERSION {
        return Err(ConfigurationBackupError::Version {
            found: backup.version,
            supported: BACKUP_VERSION,
        });
    }
    if !backup.passwords_excluded {
        return Err(ConfigurationBackupError::Validation(
            "the backup must state that password values are excluded".to_string(),
        ));
    }
    if backup.project.name != expected_project {
        return Err(ConfigurationBackupError::ProjectMismatch {
            expected: expected_project.to_string(),
            found: backup.project.name,
        });
    }
    if backup.configuration.schema_version > CONFIGURATION_SCHEMA_VERSION {
        return Err(ConfigurationBackupError::SchemaVersion {
            found: backup.configuration.schema_version,
            supported: CONFIGURATION_SCHEMA_VERSION,
        });
    }
    Ok(backup)
}

pub const CONFIGURATION_SCHEMA_VERSION: u32 = 1;

pub fn validate_import(
    project: &Project,
    configuration: &UserConfiguration,
    schedule_rules: &[ScheduleRule],
) -> Result<(), ConfigurationBackupError> {
    validate_configuration(project, configuration)?;
    schedule::validate_rules(schedule_rules).map_err(ConfigurationBackupError::Validation)?;
    for rule in schedule_rules {
        if !configuration
            .run_configurations
            .iter()
            .any(|run| run.id == rule.run_configuration_id)
        {
            return Err(ConfigurationBackupError::Validation(format!(
                "schedule rule {} refers to unknown run configuration {}",
                rule.id, rule.run_configuration_id
            )));
        }
    }
    Ok(())
}

fn validation_error(message: String) -> ConfigurationBackupError {
    ConfigurationBackupError::Validation(message)
}

fn validate_configuration(
    project: &Project,
    configuration: &UserConfiguration,
) -> Result<(), ConfigurationBackupError> {
    let mut run_ids = HashSet::new();
    for run in &configuration.run_configurations {
        if run.id.trim().is_empty() || !run_ids.insert(run.id.as_str()) {
            return Err(validation_error(format!(
                "run configuration ids must be unique and non-empty: {}",
                run.id
            )));
        }
    }
    let active_run_id = configuration
        .active_run_configuration_id
        .as_ref()
        .ok_or_else(|| validation_error("the active run configuration is required".to_string()))?;
    if !run_ids.contains(active_run_id) {
        return Err(validation_error(format!(
            "the active run configuration does not exist: {active_run_id}"
        )));
    }

    let mut instance_ids = HashSet::new();
    for run in &configuration.run_configurations {
        for task in &run.tasks {
            let definition = project
                .tasks
                .iter()
                .find(|item| item.name == task.task_name)
                .ok_or_else(|| {
                    validation_error(format!(
                        "run configuration {} refers to unknown task {}",
                        run.id, task.task_name
                    ))
                })?;
            if task.instance_id.trim().is_empty() || !instance_ids.insert(task.instance_id.as_str())
            {
                return Err(validation_error(format!(
                    "task instance ids must be unique and non-empty: {}",
                    task.instance_id
                )));
            }
            for (name, value) in &task.option_values {
                validate_option_value(project, name, value).map_err(validation_error)?;
                if !definition.options.contains(name) {
                    return Err(validation_error(format!(
                        "task {} does not declare option {}",
                        task.task_name, name
                    )));
                }
            }
        }
    }

    validate_option_map(
        project,
        &project.global_options,
        &configuration.global_option_values,
    )?;
    for (controller, values) in &configuration.controller_option_values {
        if !project
            .controllers
            .iter()
            .any(|item| item.name == *controller)
        {
            return Err(validation_error(format!(
                "unknown controller option scope: {controller}"
            )));
        }
        validate_named_option_map(project, values)?;
    }
    for (resource, values) in &configuration.resource_option_values {
        if !project.resources.iter().any(|item| item.name == *resource) {
            return Err(validation_error(format!(
                "unknown resource option scope: {resource}"
            )));
        }
        validate_named_option_map(project, values)?;
    }
    Ok(())
}

fn validate_option_map(
    project: &Project,
    declared: &[String],
    values: &BTreeMap<String, OptionValue>,
) -> Result<(), ConfigurationBackupError> {
    for (name, value) in values {
        if !declared.contains(name) {
            return Err(validation_error(format!(
                "unknown option in this scope: {name}"
            )));
        }
        validate_option_value(project, name, value).map_err(validation_error)?;
    }
    Ok(())
}

fn validate_named_option_map(
    project: &Project,
    values: &BTreeMap<String, OptionValue>,
) -> Result<(), ConfigurationBackupError> {
    for (name, value) in values {
        validate_option_value(project, name, value).map_err(validation_error)?;
    }
    Ok(())
}

fn validate_option_value(project: &Project, name: &str, value: &OptionValue) -> Result<(), String> {
    let definition = project
        .options
        .get(name)
        .ok_or_else(|| format!("unknown option: {name}"))?;
    match (definition, value) {
        (
            OptionDefinition::Select { cases, .. } | OptionDefinition::Switch { cases, .. },
            OptionValue::Single { case },
        ) => {
            if !cases.iter().any(|item| item.name == *case) {
                return Err(format!("unknown case {case} for option {name}"));
            }
        }
        (
            OptionDefinition::Checkbox {
                cases,
                min_count,
                max_count,
                ..
            },
            OptionValue::Multiple { cases: selected },
        ) => {
            let unique = selected.iter().collect::<BTreeSet<_>>();
            if unique.len() != selected.len()
                || selected
                    .iter()
                    .any(|case| !cases.iter().any(|item| item.name == *case))
            {
                return Err(format!("invalid selected cases for option {name}"));
            }
            if let Some(expected) = min_count {
                if selected.len() < *expected as usize {
                    return Err(format!(
                        "option {name} requires at least {expected} selected cases"
                    ));
                }
            }
            if let Some(expected) = max_count {
                if selected.len() > *expected as usize {
                    return Err(format!(
                        "option {name} allows at most {expected} selected cases"
                    ));
                }
            }
        }
        (
            OptionDefinition::Input { inputs, .. } | OptionDefinition::Hotkey { .. },
            OptionValue::Inputs { values },
        ) => {
            let fields: Vec<&InputFieldDefinition> = match definition {
                OptionDefinition::Input { inputs, .. } => inputs.iter().collect(),
                OptionDefinition::Hotkey { hotkeys, .. } => hotkeys
                    .iter()
                    .map(|field| InputFieldDefinition {
                        name: field.name.clone(),
                        label: field.label.clone(),
                        description: field.description.clone(),
                        placeholder: None,
                        default: field.default.clone(),
                        pipeline_type: Default::default(),
                        verify: None,
                        pattern_message: None,
                        password: false,
                        input_type: Default::default(),
                    })
                    .collect(),
                _ => Vec::new(),
            };
            for field_name in values.keys() {
                if !fields.iter().any(|field| field.name == *field_name) {
                    return Err(format!(
                        "unknown input field {field_name} for option {name}"
                    ));
                }
            }
            validate_input_values(name, &fields, values)?;
        }
        (definition, value) => {
            return Err(format!(
                "option {} has the wrong value shape for {}",
                name,
                option_kind(definition)
            ));
        }
    }
    Ok(())
}

fn validate_input_values(
    option: &str,
    fields: &[&InputFieldDefinition],
    values: &BTreeMap<String, String>,
) -> Result<(), String> {
    for field in fields {
        let Some(raw) = values.get(&field.name) else {
            continue;
        };
        if field.input_type == crate::domain::types::InputType::Time
            && !raw.is_empty()
            && !is_24_hour_time(raw)
        {
            return Err(format!(
                "input {} for option {} is invalid: expected HH:mm",
                field.name, option
            ));
        }
        if let Some(pattern) = &field.verify {
            let regex = regex::Regex::new(pattern).map_err(|error| {
                format!(
                    "input {} for option {} is invalid: {error}",
                    field.name, option
                )
            })?;
            if !regex.is_match(raw) {
                let message = field
                    .pattern_message
                    .clone()
                    .unwrap_or_else(|| "the value does not match the required pattern".to_string());
                return Err(format!(
                    "input {} for option {} is invalid: {message}",
                    field.name, option
                ));
            }
        }
    }
    Ok(())
}

fn is_24_hour_time(value: &str) -> bool {
    let parts = value.split(':').collect::<Vec<_>>();
    parts.len() == 2
        && parts[0].parse::<u8>().is_ok_and(|hour| hour < 24)
        && parts[1].parse::<u8>().is_ok_and(|minute| minute < 60)
}

fn option_kind(definition: &OptionDefinition) -> &'static str {
    match definition {
        OptionDefinition::Select { .. } => "select",
        OptionDefinition::Switch { .. } => "switch",
        OptionDefinition::Checkbox { .. } => "checkbox",
        OptionDefinition::Input { .. } => "input",
        OptionDefinition::Hotkey { .. } => "hotkey",
    }
}

pub fn declared_password_fields(project: &Project) -> BTreeSet<(String, String)> {
    let mut fields = BTreeSet::new();
    for option in project.options.values() {
        if let OptionDefinition::Input { name, inputs, .. } = option {
            for field in inputs.iter().filter(|field| field.password) {
                fields.insert((name.clone(), field.name.clone()));
            }
        }
    }
    fields
}

pub fn remove_password_values(
    project: &Project,
    mut configuration: UserConfiguration,
) -> UserConfiguration {
    let password_fields = declared_password_fields(project);
    remove_password_option_values(&mut configuration.global_option_values, &password_fields);
    for values in configuration.controller_option_values.values_mut() {
        remove_password_option_values(values, &password_fields);
    }
    for values in configuration.resource_option_values.values_mut() {
        remove_password_option_values(values, &password_fields);
    }
    for run in &mut configuration.run_configurations {
        for task in &mut run.tasks {
            remove_password_option_values(&mut task.option_values, &password_fields);
        }
    }
    configuration
}

pub fn remove_password_option_values(
    values: &mut BTreeMap<String, OptionValue>,
    password_fields: &BTreeSet<(String, String)>,
) {
    for (option_name, value) in values.iter_mut() {
        if let OptionValue::Inputs { values } = value {
            values.retain(|field_name, _| {
                !password_fields.contains(&(option_name.clone(), field_name.clone()))
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{
        ConfiguredTask, InputFieldDefinition, InputType, OptionApplicability, OptionCase,
        RunConfiguration, TaskDefinition,
    };
    use crate::schedule::ScheduleTrigger;

    fn input_field(name: &str, password: bool) -> InputFieldDefinition {
        InputFieldDefinition {
            name: name.to_string(),
            label: name.to_string(),
            description: None,
            placeholder: None,
            default: None,
            pipeline_type: crate::domain::types::PipelineType::String,
            verify: None,
            pattern_message: None,
            password,
            input_type: InputType::Text,
        }
    }

    fn project() -> Project {
        let credentials = OptionDefinition::Input {
            name: "credentials".to_string(),
            label: "Credentials".to_string(),
            description: None,
            inputs: vec![
                input_field("password", true),
                input_field("secondary", false),
            ],
            pipeline_override: serde_json::Value::Null,
            icon: None,
            applicability: OptionApplicability {
                controllers: Vec::new(),
                resources: Vec::new(),
            },
        };
        let mode = OptionDefinition::Select {
            name: "mode".to_string(),
            label: "Mode".to_string(),
            description: None,
            cases: vec![OptionCase {
                name: "fast".to_string(),
                label: "Fast".to_string(),
                description: None,
                icon: None,
                options: Vec::new(),
                pipeline_override: serde_json::Value::Null,
            }],
            default_case: None,
            icon: None,
            applicability: OptionApplicability {
                controllers: Vec::new(),
                resources: Vec::new(),
            },
        };
        Project {
            root: "/project".to_string(),
            interface_version: 2,
            name: "minimal".to_string(),
            label: "Minimal".to_string(),
            version: None,
            language: "zh_cn".to_string(),
            languages: vec!["zh_cn".to_string()],
            controllers: Vec::new(),
            resources: Vec::new(),
            groups: Vec::new(),
            setting_sections: Vec::new(),
            tasks: vec![TaskDefinition {
                name: "Login".to_string(),
                label: "Login".to_string(),
                entry: "Login".to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: vec!["credentials".to_string()],
                pipeline_override: serde_json::Value::Null,
                default_check: true,
                icon: None,
            }],
            options: BTreeMap::from([
                ("credentials".to_string(), credentials),
                ("mode".to_string(), mode),
            ]),
            global_options: vec!["mode".to_string()],
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: Default::default(),
        }
    }

    fn configuration() -> UserConfiguration {
        let mut configuration = UserConfiguration::default();
        configuration.active_resource = Some("default".to_string());
        configuration.global_option_values.insert(
            "mode".to_string(),
            OptionValue::Single {
                case: "fast".to_string(),
            },
        );
        configuration.run_configurations.push(RunConfiguration {
            id: "run".to_string(),
            name: "Run".to_string(),
            tasks: vec![ConfiguredTask {
                instance_id: "login".to_string(),
                task_name: "Login".to_string(),
                enabled: true,
                option_values: BTreeMap::from([(
                    "credentials".to_string(),
                    OptionValue::Inputs {
                        values: BTreeMap::from([
                            ("password".to_string(), "secret".to_string()),
                            ("secondary".to_string(), "visible".to_string()),
                        ]),
                    },
                )]),
                custom_label: None,
            }],
        });
        configuration.active_run_configuration_id = Some("run".to_string());
        configuration
    }

    fn schedule_rule() -> ScheduleRule {
        ScheduleRule {
            id: "rule".to_string(),
            name: "Daily".to_string(),
            enabled: true,
            auto_start: true,
            run_configuration_id: "run".to_string(),
            force_start: false,
            trigger: ScheduleTrigger::FixedTime {
                days: vec![1, 2],
                times: vec!["12:00".to_string()],
            },
        }
    }

    fn export_bytes() -> Vec<u8> {
        let backup = export_configuration(&project(), &configuration(), &[schedule_rule()]);
        serialize_configuration(&backup).unwrap()
    }

    #[test]
    fn export_removes_declared_passwords_but_keeps_other_inputs() {
        let encoded: serde_json::Value = serde_json::from_slice(&export_bytes()).unwrap();
        let credentials = &encoded["configuration"]["runConfigurations"][0]["tasks"][0]
            ["optionValues"]["credentials"]["values"];

        assert!(!credentials.get("password").is_some());
        assert_eq!(credentials["secondary"], serde_json::json!("visible"));
        assert!(encoded["passwordsExcluded"].as_bool().unwrap());
    }

    #[test]
    fn backup_round_trips_and_validates() {
        let backup = parse_configuration(&export_bytes(), "minimal").unwrap();

        assert_eq!(backup.version, BACKUP_VERSION);
        assert_eq!(backup.schedule_rules.len(), 1);
        let OptionValue::Inputs { values } =
            &backup.configuration.run_configurations[0].tasks[0].option_values["credentials"]
        else {
            panic!("credentials should be an input option");
        };
        assert!(!values.contains_key("password"));
        assert_eq!(values["secondary"], "visible");
        validate_import(&project(), &backup.configuration, &backup.schedule_rules).unwrap();
    }

    #[test]
    fn rejects_wrong_project_bad_json_and_too_large_files() {
        assert!(matches!(
            parse_configuration(&export_bytes(), "other"),
            Err(ConfigurationBackupError::ProjectMismatch { .. })
        ));
        assert!(matches!(
            parse_configuration(b"{", "minimal"),
            Err(ConfigurationBackupError::Json(_))
        ));
        assert!(matches!(
            parse_configuration(&vec![0; MAX_IMPORT_BYTES + 1], "minimal"),
            Err(ConfigurationBackupError::TooLarge)
        ));
    }

    #[test]
    fn rejects_unknown_kind_future_backup_version_and_future_schema() {
        let mut encoded: serde_json::Value = serde_json::from_slice(&export_bytes()).unwrap();
        encoded["kind"] = serde_json::json!("other");
        assert!(matches!(
            parse_configuration(&serde_json::to_vec(&encoded).unwrap(), "minimal"),
            Err(ConfigurationBackupError::Kind { .. })
        ));

        let mut encoded = serde_json::from_slice::<serde_json::Value>(&export_bytes()).unwrap();
        encoded["version"] = serde_json::json!(BACKUP_VERSION + 1);
        assert!(matches!(
            parse_configuration(&serde_json::to_vec(&encoded).unwrap(), "minimal"),
            Err(ConfigurationBackupError::Version { .. })
        ));

        let mut encoded = serde_json::from_slice::<serde_json::Value>(&export_bytes()).unwrap();
        encoded["configuration"]["schemaVersion"] =
            serde_json::json!(CONFIGURATION_SCHEMA_VERSION + 1);
        assert!(matches!(
            parse_configuration(&serde_json::to_vec(&encoded).unwrap(), "minimal"),
            Err(ConfigurationBackupError::SchemaVersion { .. })
        ));
    }

    #[test]
    fn legacy_backups_fill_missing_fields_with_defaults() {
        let backup: ConfigurationBackup = serde_json::from_slice(&export_bytes()).unwrap();
        let mut encoded = serde_json::to_value(&backup).unwrap();
        encoded
            .as_object_mut()
            .unwrap()
            .remove("configuration")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("schemaVersion");
        let parsed =
            parse_configuration(&serde_json::to_vec(&encoded).unwrap(), "minimal").unwrap();

        assert_eq!(
            parsed.configuration.schema_version,
            CONFIGURATION_SCHEMA_VERSION
        );
        validate_import(&project(), &parsed.configuration, &parsed.schedule_rules).unwrap();
    }

    #[test]
    fn rejects_invalid_tasks_options_and_schedules() {
        let project = project();
        let mut invalid_task = configuration();
        invalid_task.run_configurations[0].tasks[0].task_name = "Missing".to_string();
        assert!(validate_import(&project, &invalid_task, &[]).is_err());

        let mut invalid_option = configuration();
        invalid_option.global_option_values.insert(
            "mode".to_string(),
            OptionValue::Single {
                case: "missing".to_string(),
            },
        );
        assert!(validate_import(&project, &invalid_option, &[]).is_err());

        let mut invalid_schedule = schedule_rule();
        invalid_schedule.trigger = ScheduleTrigger::FixedTime {
            days: Vec::new(),
            times: vec!["12:00".to_string()],
        };
        assert!(validate_import(&project, &configuration(), &[invalid_schedule]).is_err());
    }
}

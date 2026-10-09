use super::loader::{strings, ProjectError};
use super::types::*;
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum ResolverError {
    #[error("the project declares no controller")]
    NoController,
    #[error("resource is not selected")]
    NoResource,
    #[error("unknown run configuration: {0}")]
    UnknownRunConfiguration(String),
    #[error("unknown option: {0}")]
    UnknownOption(String),
    #[error("unknown case {case} for option {option}")]
    UnknownCase { option: String, case: String },
    #[error("unknown input field {field} for option {option}")]
    UnknownInputField { option: String, field: String },
    #[error("input {field} for option {option} is invalid: {message}")]
    InvalidInput {
        option: String,
        field: String,
        message: String,
    },
    #[error("option {option} requires at least {expected} selected cases")]
    TooFewCases { option: String, expected: u32 },
    #[error("option {option} allows at most {expected} selected cases")]
    TooManyCases { option: String, expected: u32 },
    #[error("cyclic option reference: {0}")]
    CyclicOption(String),
    #[error(transparent)]
    Project(#[from] ProjectError),
}

pub fn resolve_run(
    project: &Project,
    configuration: &UserConfiguration,
) -> Result<ResolvedRun, ResolverError> {
    // Android runs exactly one controller — the native one — and the loader always
    // synthesises it, so there is nothing to select and nothing to validate here.
    let controller = project
        .controllers
        .first()
        .ok_or(ResolverError::NoController)?;
    let resource = project
        .resources
        .iter()
        .find(|item| Some(&item.name) == configuration.active_resource.as_ref())
        .or_else(|| project.resources.first())
        .ok_or(ResolverError::NoResource)?;
    let configured_tasks = configuration
        .run_configurations
        .iter()
        .find(|item| Some(&item.id) == configuration.active_run_configuration_id.as_ref())
        .ok_or_else(|| {
            ResolverError::UnknownRunConfiguration(
                configuration
                    .active_run_configuration_id
                    .clone()
                    .unwrap_or_else(|| "default".to_string()),
            )
        })?;

    let mut merger = PipelineMerger {
        project,
        configuration,
        active_controller: &controller.name,
        active_resource: &resource.name,
        active_tasks: &configured_tasks.tasks,
        output: Map::new(),
        active_options: Vec::new(),
    };

    merger.merge_override(resource.raw.get("pipeline_override"));
    for name in &project.global_options {
        let value = configuration.global_option_values.get(name);
        merger.merge_option(name, value)?;
    }
    for name in &resource.options {
        let value = configuration
            .resource_option_values
            .get(&resource.name)
            .and_then(|values| values.get(name));
        merger.merge_option(name, value)?;
    }
    for name in controller
        .raw
        .get("option")
        .and_then(|value| strings(Some(value)))
        .unwrap_or_default()
    {
        let value = configuration
            .controller_option_values
            .get(&controller.name)
            .and_then(|values| values.get(&name));
        merger.merge_option(&name, value)?;
    }
    let global_pipeline = Value::Object(merger.output.clone());
    let base_pipeline = global_pipeline.as_object().cloned().unwrap_or_default();
    let mut combined_pipeline = base_pipeline.clone();

    // The run configuration is the single source of truth for run order: the user
    // reorders tasks in the UI and expects exactly that sequence on device, while
    // `project.tasks` only mirrors the interface `import` order (the task that
    // starts the game can legitimately sit at the very end of it). Tasks the
    // configuration never mentions are appended at the tail so the UI still
    // receives the complete set to pick from.
    let mut ordered: Vec<(&TaskDefinition, Option<&ConfiguredTask>)> = configured_tasks
        .tasks
        .iter()
        .filter_map(|configured| {
            project
                .tasks
                .iter()
                .find(|task| task.name == configured.task_name)
                .map(|task| (task, Some(configured)))
        })
        .collect();
    for task in &project.tasks {
        if !configured_tasks
            .tasks
            .iter()
            .any(|item| item.task_name == task.name)
        {
            ordered.push((task, None));
        }
    }

    let mut tasks = Vec::new();
    for (task, configured) in ordered {
        let unavailable_reason = task_unavailable_reason(task, &controller.name, &resource.name);
        let available = unavailable_reason.is_none();
        if available {
            merger.output = base_pipeline.clone();
            merger.active_options.clear();
            merger.merge_override(Some(&task.pipeline_override));
            if configured.is_some_and(|item| item.enabled) {
                for name in &task.options {
                    let value = configured.and_then(|item| item.option_values.get(name));
                    merger.merge_option(name, value)?;
                }
            }
            merge_pipeline_maps(&mut combined_pipeline, &merger.output);
        }
        let task_output = merger.output.clone();
        tasks.push(ResolvedTask {
            task: task.clone(),
            configured: configured.cloned(),
            enabled: configured.is_some_and(|item| item.enabled),
            unavailable_reason,
            pipeline_override: Value::Object(task_output),
        });
    }

    Ok(ResolvedRun {
        controller: controller.clone(),
        resource: resource.clone(),
        tasks,
        base_pipeline: Value::Object(base_pipeline),
        pipeline_override: Value::Object(combined_pipeline),
    })
}

fn merge_pipeline_maps(target: &mut Map<String, Value>, source: &Map<String, Value>) {
    for (key, value) in source {
        match (target.get_mut(key), value) {
            (Some(Value::Object(existing)), Value::Object(next)) => {
                merge_pipeline_maps(existing, next);
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}

pub(crate) fn task_unavailable_reason(
    task: &TaskDefinition,
    controller: &str,
    resource: &str,
) -> Option<String> {
    if !task.controllers.is_empty() && !task.controllers.iter().any(|item| item == controller) {
        return Some("The selected controller does not support this task".to_string());
    }
    if !task.resources.is_empty() && !task.resources.iter().any(|item| item == resource) {
        return Some("The selected resource does not support this task".to_string());
    }
    None
}

struct PipelineMerger<'a> {
    project: &'a Project,
    configuration: &'a UserConfiguration,
    active_controller: &'a str,
    active_resource: &'a str,
    active_tasks: &'a [ConfiguredTask],
    output: Map<String, Value>,
    active_options: Vec<String>,
}

impl<'a> PipelineMerger<'a> {
    fn merge_option(
        &mut self,
        name: &str,
        configured: Option<&OptionValue>,
    ) -> Result<(), ResolverError> {
        let definition = self
            .project
            .options
            .get(name)
            .ok_or_else(|| ResolverError::UnknownOption(name.to_string()))?;
        if !definition
            .applicability()
            .matches(self.active_controller, Some(self.active_resource))
        {
            return Ok(());
        }
        if self.active_options.iter().any(|item| item == name) {
            return Err(ResolverError::CyclicOption(name.to_string()));
        }
        self.active_options.push(name.to_string());
        let result = self.merge_active_option(name, definition, configured);
        self.active_options.pop();
        result
    }

    fn merge_active_option(
        &mut self,
        name: &str,
        definition: &OptionDefinition,
        configured: Option<&OptionValue>,
    ) -> Result<(), ResolverError> {
        match definition {
            OptionDefinition::Select {
                cases,
                default_case,
                ..
            }
            | OptionDefinition::Switch {
                cases,
                default_case,
                ..
            } => {
                let selected = match configured {
                    Some(OptionValue::Single { case }) => case.clone(),
                    Some(_) => {
                        return Err(ResolverError::UnknownCase {
                            option: name.to_string(),
                            case: "<multiple>".to_string(),
                        })
                    }
                    None => default_case
                        .clone()
                        .or_else(|| cases.first().map(|case| case.name.clone()))
                        .ok_or_else(|| ResolverError::UnknownCase {
                            option: name.to_string(),
                            case: "<empty>".to_string(),
                        })?,
                };
                let case = cases
                    .iter()
                    .find(|item| item.name == selected)
                    .ok_or_else(|| ResolverError::UnknownCase {
                        option: name.to_string(),
                        case: selected,
                    })?;
                self.merge_override(Some(&case.pipeline_override));
                self.merge_child_options(&case.options)
            }
            OptionDefinition::Checkbox {
                cases,
                default_cases,
                min_count,
                max_count,
                ..
            } => {
                let mut selected = match configured {
                    Some(OptionValue::Multiple { cases }) => cases.clone(),
                    Some(_) => {
                        return Err(ResolverError::UnknownCase {
                            option: name.to_string(),
                            case: "<single>".to_string(),
                        })
                    }
                    None => default_cases.clone(),
                };
                if let Some(expected) = min_count {
                    if selected.len() < *expected as usize {
                        return Err(ResolverError::TooFewCases {
                            option: name.to_string(),
                            expected: *expected,
                        });
                    }
                }
                if let Some(expected) = max_count {
                    if selected.len() > *expected as usize {
                        return Err(ResolverError::TooManyCases {
                            option: name.to_string(),
                            expected: *expected,
                        });
                    }
                }
                selected.sort_by_key(|case| {
                    cases
                        .iter()
                        .position(|definition| &definition.name == case)
                        .unwrap_or(usize::MAX)
                });
                let mut child_options = Vec::new();
                for selected_name in selected {
                    let case = cases
                        .iter()
                        .find(|item| item.name == selected_name)
                        .ok_or_else(|| ResolverError::UnknownCase {
                            option: name.to_string(),
                            case: selected_name,
                        })?;
                    self.merge_override(Some(&case.pipeline_override));
                    for child in &case.options {
                        if !child_options.contains(child) {
                            child_options.push(child.clone());
                        }
                    }
                }
                self.merge_child_options(&child_options)
            }
            OptionDefinition::Input {
                inputs,
                pipeline_override,
                ..
            } => {
                let values = match configured {
                    Some(OptionValue::Inputs { values }) => values.clone(),
                    None => BTreeMap::new(),
                    Some(_) => {
                        return Err(ResolverError::UnknownInputField {
                            option: name.to_string(),
                            field: "<scalar>".to_string(),
                        })
                    }
                };
                let values = self.input_values(name, inputs, &values)?;
                let override_value = substitute_inputs(pipeline_override, inputs, &values)?;
                self.merge_override(Some(&override_value));
                Ok(())
            }
            OptionDefinition::Hotkey {
                hotkeys,
                pipeline_override,
                ..
            } => {
                let values = match configured {
                    Some(OptionValue::Inputs { values }) => values.clone(),
                    None => BTreeMap::new(),
                    Some(_) => {
                        return Err(ResolverError::UnknownInputField {
                            option: name.to_string(),
                            field: "<scalar>".to_string(),
                        })
                    }
                };
                let values = hotkey_values(name, hotkeys, &values)?;
                let override_value = substitute_hotkeys(pipeline_override, name, hotkeys, &values)?;
                self.merge_override(Some(&override_value));
                Ok(())
            }
        }
    }

    fn merge_child_options(&mut self, names: &[String]) -> Result<(), ResolverError> {
        for name in names {
            let value: Option<&OptionValue> = None;
            let value = value.or_else(|| {
                self.task_option_value(name)
                    .or_else(|| self.configuration.global_option_values.get(name))
                    .or_else(|| {
                        self.configuration
                            .resource_option_values
                            .get(self.active_resource)
                            .and_then(|values| values.get(name))
                    })
                    .or_else(|| {
                        self.configuration
                            .controller_option_values
                            .get(self.active_controller)
                            .and_then(|values| values.get(name))
                    })
            });
            let value = value.cloned();
            self.merge_option(name, value.as_ref())?;
        }
        Ok(())
    }

    fn task_option_value(&self, name: &str) -> Option<&OptionValue> {
        self.active_tasks
            .iter()
            .filter(|task| task.enabled)
            .find_map(|task| task.option_values.get(name))
    }

    fn input_values(
        &self,
        option: &str,
        inputs: &[InputFieldDefinition],
        values: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>, ResolverError> {
        let mut resolved = BTreeMap::new();
        for field in inputs {
            let raw = values
                .get(&field.name)
                .cloned()
                .or_else(|| field.default.clone());
            let raw = raw.unwrap_or_default();
            if field.input_type == InputType::Time && !raw.is_empty() && !is_24_hour_time(&raw) {
                return Err(ResolverError::InvalidInput {
                    option: option.to_string(),
                    field: field.name.clone(),
                    message: "expected a 24-hour time in HH:mm format".to_string(),
                });
            }
            if let Some(pattern) = &field.verify {
                let regex = Regex::new(pattern).map_err(|error| ResolverError::InvalidInput {
                    option: option.to_string(),
                    field: field.name.clone(),
                    message: error.to_string(),
                })?;
                if !regex.is_match(&raw) {
                    return Err(ResolverError::InvalidInput {
                        option: option.to_string(),
                        field: field.name.clone(),
                        message: field
                            .pattern_message
                            .clone()
                            .unwrap_or_else(|| "value does not match the expected pattern".into()),
                    });
                }
            }
            resolved.insert(field.name.clone(), raw);
        }
        for field in values.keys() {
            if !inputs.iter().any(|definition| &definition.name == field) {
                return Err(ResolverError::UnknownInputField {
                    option: option.to_string(),
                    field: field.clone(),
                });
            }
        }
        Ok(resolved)
    }

    fn merge_override(&mut self, value: Option<&Value>) {
        let Some(value) = value else {
            return;
        };
        merge_json(&mut self.output, value);
    }
}

fn is_24_hour_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || bytes[2] != b':'
        || !bytes[3].is_ascii_digit()
        || !bytes[4].is_ascii_digit()
    {
        return false;
    }
    let hour = (bytes[0] - b'0') * 10 + bytes[1] - b'0';
    let minute = (bytes[3] - b'0') * 10 + bytes[4] - b'0';
    hour <= 23 && minute <= 59
}

fn hotkey_values(
    option: &str,
    hotkeys: &[HotkeyFieldDefinition],
    values: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, ResolverError> {
    let mut resolved = BTreeMap::new();
    for field in hotkeys {
        let raw = values
            .get(&field.name)
            .cloned()
            .or_else(|| field.default.clone())
            .unwrap_or_default();
        if hotkey_code(&raw).is_none() {
            return Err(ResolverError::InvalidInput {
                option: option.to_string(),
                field: field.name.clone(),
                message: format!("invalid key {raw:?}: expected a key name such as F, 1, or F1"),
            });
        }
        resolved.insert(field.name.clone(), raw);
    }
    for field in values.keys() {
        if !hotkeys.iter().any(|definition| &definition.name == field) {
            return Err(ResolverError::UnknownInputField {
                option: option.to_string(),
                field: field.clone(),
            });
        }
    }
    Ok(resolved)
}

fn hotkey_code(value: &str) -> Option<i64> {
    let primary = value
        .rsplit_once('+')
        .map(|(_, key)| key)
        .unwrap_or(value)
        .trim();
    if primary.is_empty() {
        return None;
    }

    let primary = primary.to_ascii_uppercase();
    let code = match primary.as_str() {
        "CTRL" | "CONTROL" => 0x11,
        "SHIFT" => 0x10,
        "ALT" => 0x12,
        "META" | "WIN" => 0x5B,
        "BACKSPACE" => 0x08,
        "TAB" => 0x09,
        "ENTER" => 0x0D,
        "ESCAPE" => 0x1B,
        "SPACE" => 0x20,
        "PAGE_UP" | "PAGEUP" => 0x21,
        "PAGE_DOWN" | "PAGEDOWN" => 0x22,
        "END" => 0x23,
        "HOME" => 0x24,
        "LEFT" => 0x25,
        "UP" => 0x26,
        "RIGHT" => 0x27,
        "DOWN" => 0x28,
        "INSERT" => 0x2D,
        "DELETE" => 0x2E,
        _ => {
            if let Some(function) = primary
                .strip_prefix('F')
                .and_then(|number| number.parse::<u8>().ok())
            {
                (1..=24)
                    .contains(&function)
                    .then_some(0x6F + i64::from(function))?
            } else {
                let mut characters = primary.chars();
                let character = characters.next()?;
                (characters.next().is_none() && character.is_ascii_alphanumeric())
                    .then_some(i64::from(u32::from(character as u8)))?
            }
        }
    };
    Some(code)
}

fn hotkey_placeholder(text: &str) -> Option<(&str, bool)> {
    let name = text.trim().strip_prefix('{')?.strip_suffix('}')?;
    match name.split_once('.') {
        Some((field, "primary")) => Some((field, true)),
        Some(_) => None,
        None => Some((name, false)),
    }
}

fn substitute_hotkeys(
    value: &Value,
    option: &str,
    hotkeys: &[HotkeyFieldDefinition],
    values: &BTreeMap<String, String>,
) -> Result<Value, ResolverError> {
    match value {
        Value::String(text) => {
            if let Some((field_name, _)) = hotkey_placeholder(text) {
                if let Some(field) = hotkeys.iter().find(|field| field.name == field_name) {
                    let raw = values
                        .get(&field.name)
                        .map(String::as_str)
                        .unwrap_or_default();
                    let code = hotkey_code(raw).ok_or_else(|| ResolverError::InvalidInput {
                        option: option.to_string(),
                        field: field.name.clone(),
                        message: format!(
                            "invalid key {raw:?}: expected a key name such as F, 1, or F1"
                        ),
                    })?;
                    return Ok(Value::Number(code.into()));
                }
            }

            let mut output = text.clone();
            for field in hotkeys {
                let raw = values
                    .get(&field.name)
                    .map(String::as_str)
                    .unwrap_or_default();
                let code = hotkey_code(raw).ok_or_else(|| ResolverError::InvalidInput {
                    option: option.to_string(),
                    field: field.name.clone(),
                    message: format!(
                        "invalid key {raw:?}: expected a key name such as F, 1, or F1"
                    ),
                })?;
                let replacement = code.to_string();
                output = output.replace(&format!("{{{}.primary}}", field.name), &replacement);
                output = output.replace(&format!("{{{}}}", field.name), &replacement);
            }
            Ok(Value::String(output))
        }
        Value::Array(items) => Ok(Value::Array(
            items
                .iter()
                .map(|item| substitute_hotkeys(item, option, hotkeys, values))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        Value::Object(items) => {
            let mut output = Map::new();
            for (key, item) in items {
                output.insert(
                    key.clone(),
                    substitute_hotkeys(item, option, hotkeys, values)?,
                );
            }
            Ok(Value::Object(output))
        }
        other => Ok(other.clone()),
    }
}

fn substitute_inputs(
    value: &Value,
    inputs: &[InputFieldDefinition],
    values: &BTreeMap<String, String>,
) -> Result<Value, ResolverError> {
    match value {
        Value::String(text) => {
            let mut output = text.clone();
            for field in inputs {
                let placeholder = format!("{{{}}}", field.name);
                let Some(value) = values.get(&field.name) else {
                    continue;
                };
                let replacement = match field.pipeline_type {
                    PipelineType::Int => value
                        .parse::<i64>()
                        .map(|number| number.to_string())
                        .map_err(|_| ResolverError::InvalidInput {
                            option: "<input>".to_string(),
                            field: field.name.clone(),
                            message: "expected an integer".to_string(),
                        })?,
                    PipelineType::Bool => {
                        if value != "true" && value != "false" {
                            return Err(ResolverError::InvalidInput {
                                option: "<input>".to_string(),
                                field: field.name.clone(),
                                message: "expected true or false".to_string(),
                            });
                        }
                        value.clone()
                    }
                    PipelineType::String => value.clone(),
                };
                output = output.replace(&placeholder, &replacement);
            }
            if input_name(text).is_some_and(|name| inputs.iter().any(|field| field.name == name)) {
                return Ok(typed_input(text, inputs, values)?);
            }
            Ok(Value::String(output))
        }
        Value::Array(items) => Ok(Value::Array(
            items
                .iter()
                .map(|item| substitute_inputs(item, inputs, values))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        Value::Object(items) => {
            let mut output = Map::new();
            for (key, item) in items {
                output.insert(key.clone(), substitute_inputs(item, inputs, values)?);
            }
            Ok(Value::Object(output))
        }
        other => Ok(other.clone()),
    }
}

fn input_name(text: &str) -> Option<&str> {
    let name = text.trim().strip_prefix('{')?.strip_suffix('}')?;
    Some(name)
}

fn typed_input(
    text: &str,
    inputs: &[InputFieldDefinition],
    values: &BTreeMap<String, String>,
) -> Result<Value, ResolverError> {
    let Some(name) = input_name(text) else {
        return Ok(Value::String(text.to_string()));
    };
    let Some(field) = inputs.iter().find(|field| field.name == name) else {
        return Ok(Value::String(text.to_string()));
    };
    let raw = values.get(name).map(String::as_str).unwrap_or_default();
    match field.pipeline_type {
        PipelineType::String => Ok(Value::String(raw.to_string())),
        PipelineType::Int => raw
            .parse::<i64>()
            .map(|value| Value::Number(serde_json::Number::from(value)))
            .map_err(|_| ResolverError::InvalidInput {
                option: field.name.clone(),
                field: field.name.clone(),
                message: "expected an integer".to_string(),
            }),
        PipelineType::Bool => match raw {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(ResolverError::InvalidInput {
                option: field.name.clone(),
                field: field.name.clone(),
                message: "expected true or false".to_string(),
            }),
        },
    }
}

fn merge_json(target: &mut Map<String, Value>, source: &Value) {
    if let Value::Object(source) = source {
        for (key, incoming) in source {
            match target.get_mut(key) {
                Some(Value::Object(existing)) if incoming.is_object() => {
                    merge_json(existing, incoming)
                }
                None => {
                    target.insert(key.clone(), incoming.clone());
                }
                Some(_) => {
                    target.insert(key.clone(), incoming.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::loader::ProjectLoader;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn input_values(value: Option<&str>) -> OptionValue {
        OptionValue::Inputs {
            values: value
                .map(|value| BTreeMap::from([("count".to_string(), value.to_string())]))
                .unwrap_or_default(),
        }
    }

    fn fixture_project() -> Project {
        ProjectLoader::default()
            .load("fixtures/pi/minimal/interface.json", "en_us")
            .expect("fixture should load")
    }

    fn configuration(
        project: &Project,
        start_stage: &str,
        retries: Option<&str>,
        auto_battle: &str,
    ) -> UserConfiguration {
        let mut run = UserConfiguration::default();
        run.active_resource = Some(project.resources[0].name.clone());
        run.global_option_values.insert(
            "logging".to_string(),
            OptionValue::Multiple {
                cases: vec!["events".to_string()],
            },
        );
        run.resource_option_values.insert(
            project.resources[0].name.clone(),
            BTreeMap::from([(
                "resolution".to_string(),
                OptionValue::Single {
                    case: "720p".to_string(),
                },
            )]),
        );
        run.run_configurations.push(RunConfiguration {
            id: "default".to_string(),
            name: "Default".to_string(),
            tasks: vec![
                ConfiguredTask {
                    instance_id: "start".to_string(),
                    task_name: "start".to_string(),
                    enabled: true,
                    option_values: BTreeMap::from([
                        (
                            "stage".to_string(),
                            OptionValue::Single {
                                case: start_stage.to_string(),
                            },
                        ),
                        ("retries".to_string(), input_values(retries)),
                        (
                            "auto_battle".to_string(),
                            OptionValue::Single {
                                case: auto_battle.to_string(),
                            },
                        ),
                    ]),
                    custom_label: None,
                },
                ConfiguredTask {
                    instance_id: "collect".to_string(),
                    task_name: "collect".to_string(),
                    enabled: true,
                    option_values: BTreeMap::new(),
                    custom_label: None,
                },
            ],
        });
        run.active_run_configuration_id = Some("default".to_string());
        run
    }

    #[test]
    fn localizes_and_resolves_default_fixture_plan() {
        let project = fixture_project();
        assert_eq!(project.label, "MaaTauriAndroid Fixture");
        let resolved = resolve_run(&project, &configuration(&project, "normal", None, "Yes"))
            .expect("fixture should resolve");

        assert_eq!(resolved.tasks.len(), 3);
        assert!(resolved.tasks[0].enabled);
        assert!(!resolved.tasks[2].enabled);
        assert!(resolved.tasks[2].unavailable_reason.is_some());
        assert_eq!(
            resolved.pipeline_override.get("__resolution"),
            Some(&json!({ "short_side": 720 }))
        );
        assert_eq!(
            resolved.pipeline_override.get("__logging"),
            Some(&json!({ "events": true }))
        );
        assert_eq!(
            resolved.pipeline_override.get("Start"),
            Some(&json!({ "stage": "normal", "retries": 3 }))
        );
        assert_eq!(
            resolved.pipeline_override.get("AutoBattle"),
            Some(&json!({ "enabled": true }))
        );
    }

    #[test]
    fn resolves_hotkey_primary_placeholders_to_key_codes() {
        let mut project = fixture_project();
        project.global_options.push("hotkeys".to_string());
        project.options.insert(
            "hotkeys".to_string(),
            OptionDefinition::Hotkey {
                name: "hotkeys".to_string(),
                label: "Hotkeys".to_string(),
                description: None,
                hotkeys: vec![
                    HotkeyFieldDefinition {
                        name: "Interact".to_string(),
                        label: "Interact".to_string(),
                        description: None,
                        default: Some("F".to_string()),
                    },
                    HotkeyFieldDefinition {
                        name: "Combo".to_string(),
                        label: "Combo".to_string(),
                        description: None,
                        default: Some("F1".to_string()),
                    },
                ],
                pipeline_override: json!({
                    "Interact": { "key": "{Interact.primary}" },
                    "Combo": {
                        "key": "{Combo.primary}",
                        "description": "combo {Combo.primary}"
                    }
                }),
                icon: None,
                applicability: OptionApplicability {
                    controllers: Vec::new(),
                    resources: Vec::new(),
                },
            },
        );

        let resolved = resolve_run(&project, &configuration(&project, "normal", None, "Yes"))
            .expect("default hotkeys should resolve");
        assert_eq!(
            resolved.pipeline_override.get("Interact"),
            Some(&json!({ "key": 70 }))
        );
        assert_eq!(
            resolved.pipeline_override.get("Combo"),
            Some(&json!({ "key": 112, "description": "combo 112" }))
        );

        let mut config = configuration(&project, "normal", None, "Yes");
        config.global_option_values.insert(
            "hotkeys".to_string(),
            OptionValue::Inputs {
                values: BTreeMap::from([
                    ("Interact".to_string(), "f".to_string()),
                    ("Combo".to_string(), "Ctrl+F1".to_string()),
                ]),
            },
        );
        let resolved = resolve_run(&project, &config).expect("custom hotkeys should resolve");
        assert_eq!(
            resolved.pipeline_override.get("Interact"),
            Some(&json!({ "key": 70 }))
        );
        assert_eq!(
            resolved.pipeline_override.get("Combo"),
            Some(&json!({ "key": 112, "description": "combo 112" }))
        );

        config.global_option_values.insert(
            "hotkeys".to_string(),
            OptionValue::Inputs {
                values: BTreeMap::from([
                    ("Interact".to_string(), "not-a-key".to_string()),
                    ("Combo".to_string(), "F1".to_string()),
                ]),
            },
        );
        let error = resolve_run(&project, &config).expect_err("an invalid hotkey should fail");
        assert!(error.to_string().contains("not-a-key"));
    }

    #[test]
    fn resolves_missing_resource_to_first_resource() {
        let project = fixture_project();
        let mut config = configuration(&project, "normal", None, "Yes");
        config.active_resource = None;

        let resolved = resolve_run(&project, &config).expect("resource should resolve");
        assert_eq!(resolved.resource.name, project.resources[0].name);
    }

    #[test]
    fn resolves_unknown_resource_to_first_resource() {
        let project = fixture_project();
        let mut config = configuration(&project, "normal", None, "Yes");
        config.active_resource = Some("removed-resource".to_string());

        let resolved = resolve_run(&project, &config).expect("resource should resolve");
        assert_eq!(resolved.resource.name, project.resources[0].name);
    }

    #[test]
    fn fails_when_no_resources_are_declared() {
        let mut project = fixture_project();
        let config = configuration(&project, "normal", None, "Yes");
        project.resources.clear();

        let error = resolve_run(&project, &config).expect_err("no resource should fail");
        assert!(matches!(error, ResolverError::NoResource));
    }

    #[test]
    fn resolves_preset_and_validates_input() {
        let project = fixture_project();
        let resolved = resolve_run(&project, &configuration(&project, "hard", None, "No"))
            .expect("preset should resolve");
        assert_eq!(
            resolved.pipeline_override.get("Start"),
            Some(&json!({ "stage": "hard" }))
        );
        assert_eq!(
            resolved.pipeline_override.get("AutoBattle"),
            Some(&json!({ "enabled": false }))
        );

        let error = resolve_run(
            &project,
            &configuration(&project, "normal", Some("bad"), "Yes"),
        )
        .expect_err("invalid input should fail");
        assert!(error.to_string().contains("invalid"));
    }

    #[test]
    fn skips_input_validation_for_disabled_configured_tasks() {
        let project = fixture_project();
        let mut config = configuration(&project, "normal", Some("bad"), "Yes");
        config.run_configurations[0].tasks[0].enabled = false;

        let resolved = resolve_run(&project, &config).expect("disabled task should not validate");

        assert!(!resolved.tasks[0].enabled);
        assert_eq!(resolved.pipeline_override.get("Start"), None);
    }

    #[test]
    fn keeps_run_configuration_order_over_interface_import_order() {
        let project = fixture_project();
        let mut config = configuration(&project, "normal", None, "Yes");
        // The user dragged the second task above the first in the UI. The
        // interface `import` order (start, collect, exclusive) must not win.
        config.run_configurations[0].tasks.reverse();

        let resolved = resolve_run(&project, &config).expect("reordered plan should resolve");

        let names: Vec<&str> = resolved
            .tasks
            .iter()
            .map(|task| task.task.name.as_str())
            .collect();
        // Configured order first, then tasks the configuration never mentions.
        assert_eq!(names, vec!["collect", "start", "exclusive"]);
        assert_eq!(
            resolved.tasks[0]
                .configured
                .as_ref()
                .map(|task| task.instance_id.as_str()),
            Some("collect")
        );
        assert!(resolved.tasks[2].configured.is_none());
    }

    #[test]
    fn validates_time_input_format() {
        let mut project = fixture_project();
        let OptionDefinition::Input { inputs, .. } = project
            .options
            .get_mut("retries")
            .expect("option should load")
        else {
            panic!("retries should be an input option");
        };
        inputs[0].pipeline_type = PipelineType::String;
        inputs[0].verify = None;
        inputs[0].input_type = InputType::Time;

        let resolved = resolve_run(
            &project,
            &configuration(&project, "normal", Some("08:05"), "Yes"),
        )
        .expect("a 24-hour time should resolve");
        assert_eq!(
            resolved.pipeline_override.get("Start"),
            Some(&json!({ "stage": "normal", "retries": "08:05" }))
        );

        let error = resolve_run(
            &project,
            &configuration(&project, "normal", Some("8:05"), "Yes"),
        )
        .expect_err("a time without zero padding should fail");
        assert!(error.to_string().contains("HH:mm"));
    }
}

use super::loader::{strings, ProjectError};
use super::types::*;
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum ResolverError {
    #[error("controller is not selected")]
    NoController,
    #[error("resource is not selected")]
    NoResource,
    #[error("unknown controller: {0}")]
    UnknownController(String),
    #[error("unknown resource: {0}")]
    UnknownResource(String),
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
    let controller_name = configuration
        .active_controller
        .as_ref()
        .ok_or(ResolverError::NoController)?;
    let resource_name = configuration
        .active_resource
        .as_ref()
        .ok_or(ResolverError::NoResource)?;
    let controller = project
        .controllers
        .iter()
        .find(|item| &item.name == controller_name)
        .ok_or_else(|| ResolverError::UnknownController(controller_name.clone()))?;
    let resource = project
        .resources
        .iter()
        .find(|item| &item.name == resource_name)
        .ok_or_else(|| ResolverError::UnknownResource(resource_name.clone()))?;
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

    let mut tasks = Vec::new();
    for task in &project.tasks {
        let configured = configured_tasks
            .tasks
            .iter()
            .find(|item| item.task_name == task.name);
        let unavailable_reason = task_unavailable_reason(task, &controller.name, &resource.name);
        let available = unavailable_reason.is_none();
        if available {
            merger.output = base_pipeline.clone();
            merger.active_options.clear();
            merger.merge_override(Some(&task.pipeline_override));
            for name in &task.options {
                let value = configured.and_then(|item| item.option_values.get(name));
                merger.merge_option(name, value)?;
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

fn task_unavailable_reason(
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
                let inputs = hotkeys
                    .iter()
                    .map(|field| InputFieldDefinition {
                        name: field.name.clone(),
                        label: field.label.clone(),
                        description: field.description.clone(),
                        default: field.default.clone(),
                        pipeline_type: PipelineType::String,
                        verify: None,
                        pattern_message: None,
                        password: false,
                    })
                    .collect::<Vec<_>>();
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
                let values = self.input_values(name, &inputs, &values)?;
                let override_value = substitute_inputs(pipeline_override, &inputs, &values)?;
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
        run.active_controller = Some(project.controllers[0].name.clone());
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
}

//! PI pre-task option resolution. This module never starts processes or merges pipelines.
use super::resolver::{hotkey_values, resolve_input_values, ResolverError};
use super::types::*;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Preserve declaration/import order, skipping disabled and unavailable pre-tasks.
/// The caller must keep arguments out of logs because the JSON can contain secrets.
pub fn resolve_pretasks(
    project: &Project,
    configuration: &UserConfiguration,
) -> Result<Vec<ResolvedPretask>, ResolverError> {
    if project.pretasks.is_empty() {
        return Ok(Vec::new());
    }
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
    let mut resolved = Vec::new();
    for task in &project.pretasks {
        let configured = configuration.pretask_values.get(&task.name);
        if configured.is_some_and(|item| !item.enabled)
            || !(OptionApplicability {
                controllers: task.controllers.clone(),
                resources: task.resources.clone(),
            })
            .matches(&controller.name, Some(&resource.name))
        {
            continue;
        }
        let empty = BTreeMap::new();
        let mut collector = OptionCollector {
            project,
            values: configured.map(|item| &item.option_values).unwrap_or(&empty),
            controller: &controller.name,
            resource: &resource.name,
            stack: Vec::new(),
            output: Map::new(),
        };
        for name in &task.options {
            collector.collect(name)?;
        }
        let mut args = task.args.clone();
        if !task.options.is_empty() {
            // Value serialization cannot fail and produces compact, single-line JSON.
            args.push(Value::Object(collector.output).to_string());
        }
        resolved.push(ResolvedPretask {
            name: task.name.clone(),
            exec: task.exec.clone(),
            args,
        });
    }
    Ok(resolved)
}

struct OptionCollector<'a> {
    project: &'a Project,
    values: &'a BTreeMap<String, OptionValue>,
    controller: &'a str,
    resource: &'a str,
    stack: Vec<String>,
    output: Map<String, Value>,
}

impl OptionCollector<'_> {
    fn collect(&mut self, name: &str) -> Result<(), ResolverError> {
        let definition = self
            .project
            .options
            .get(name)
            .ok_or_else(|| ResolverError::UnknownOption(name.into()))?;
        if !definition
            .applicability()
            .matches(self.controller, Some(self.resource))
        {
            return Ok(());
        }
        if self.stack.iter().any(|item| item == name) {
            return Err(ResolverError::CyclicOption(name.into()));
        }
        if self.output.contains_key(name) {
            return Ok(());
        }
        self.stack.push(name.into());
        let configured = self.values.get(name);
        let mut children = Vec::new();
        let value = match definition {
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
                    None => default_case
                        .clone()
                        .or_else(|| cases.first().map(|case| case.name.clone()))
                        .ok_or_else(|| ResolverError::UnknownCase {
                            option: name.into(),
                            case: "<empty>".into(),
                        })?,
                    Some(_) => {
                        return Err(ResolverError::UnknownCase {
                            option: name.into(),
                            case: "<type>".into(),
                        })
                    }
                };
                let case = cases
                    .iter()
                    .find(|case| case.name == selected)
                    .ok_or_else(|| ResolverError::UnknownCase {
                        option: name.into(),
                        case: selected.clone(),
                    })?;
                children.extend(case.options.clone());
                Value::String(selected)
            }
            OptionDefinition::Checkbox {
                cases,
                default_cases,
                min_count,
                max_count,
                ..
            } => {
                let selected = match configured {
                    Some(OptionValue::Multiple { cases }) => cases.clone(),
                    None => default_cases.clone(),
                    Some(_) => {
                        return Err(ResolverError::UnknownCase {
                            option: name.into(),
                            case: "<type>".into(),
                        })
                    }
                };
                let mut unique = BTreeSet::new();
                for selected in &selected {
                    let case = cases
                        .iter()
                        .find(|case| &case.name == selected)
                        .ok_or_else(|| ResolverError::UnknownCase {
                            option: name.into(),
                            case: selected.clone(),
                        })?;
                    if !unique.insert(selected) {
                        return Err(ResolverError::UnknownCase {
                            option: name.into(),
                            case: "<duplicate>".into(),
                        });
                    }
                    children.extend(case.options.clone());
                }
                if let Some(expected) = min_count {
                    if selected.len() < *expected as usize {
                        return Err(ResolverError::TooFewCases {
                            option: name.into(),
                            expected: *expected,
                        });
                    }
                }
                if let Some(expected) = max_count {
                    if selected.len() > *expected as usize {
                        return Err(ResolverError::TooManyCases {
                            option: name.into(),
                            expected: *expected,
                        });
                    }
                }
                Value::Array(selected.into_iter().map(Value::String).collect())
            }
            OptionDefinition::Input { inputs, .. } => {
                let values = self.input_map(name, configured)?;
                let values = resolve_input_values(name, inputs, &values)?;
                // Validate declared types without substituting/reading pipeline_override.
                for field in inputs {
                    let raw = &values[&field.name];
                    let valid = match field.pipeline_type {
                        PipelineType::String => true,
                        PipelineType::Int => raw.parse::<i64>().is_ok(),
                        PipelineType::Bool => raw == "true" || raw == "false",
                    };
                    if !valid {
                        return Err(ResolverError::InvalidInput {
                            option: name.into(),
                            field: field.name.clone(),
                            message: "value does not match the declared input type".into(),
                        });
                    }
                }
                string_map(values)
            }
            OptionDefinition::Hotkey { hotkeys, .. } => {
                let values = self.input_map(name, configured)?;
                // Do not propagate hotkey errors that include the user's raw value.
                let values =
                    hotkey_values(name, hotkeys, &values).map_err(|error| match error {
                        ResolverError::InvalidInput { option, field, .. } => {
                            ResolverError::InvalidInput {
                                option,
                                field,
                                message: "invalid hotkey".into(),
                            }
                        }
                        other => other,
                    })?;
                string_map(values)
            }
        };
        // Insert after walking children so cycles are detected even if a node has a value.
        for child in children {
            self.collect(&child)?;
        }
        self.output.insert(name.into(), value);
        self.stack.pop();
        Ok(())
    }

    fn input_map(
        &self,
        name: &str,
        configured: Option<&OptionValue>,
    ) -> Result<BTreeMap<String, String>, ResolverError> {
        match configured {
            None => Ok(BTreeMap::new()),
            Some(OptionValue::Inputs { values }) => Ok(values.clone()),
            Some(_) => Err(ResolverError::UnknownInputField {
                option: name.into(),
                field: "<type>".into(),
            }),
        }
    }
}

fn string_map(values: BTreeMap<String, String>) -> Value {
    Value::Object(
        values
            .into_iter()
            .map(|(name, value)| (name, Value::String(value)))
            .collect(),
    )
}

/// All declared descendants, including inactive cases, can be stored for later reuse.
/// This is a schema membership check; active values are validated by resolve_pretasks.
pub fn declared_options(project: &Project, roots: &[String]) -> BTreeSet<String> {
    let mut result = BTreeSet::new();
    let mut pending = roots.to_vec();
    while let Some(name) = pending.pop() {
        if !result.insert(name.clone()) {
            continue;
        }
        match project.options.get(&name) {
            Some(
                OptionDefinition::Select { cases, .. }
                | OptionDefinition::Switch { cases, .. }
                | OptionDefinition::Checkbox { cases, .. },
            ) => {
                for case in cases {
                    pending.extend(case.options.clone());
                }
            }
            _ => {}
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::loader::ProjectLoader;
    use serde_json::json;

    fn project() -> Project {
        ProjectLoader::default().load_value(".", json!({
            "interface_version": 2, "name": "pretask-tests",
            "controller": [{"name": "Android", "type": "Adb"}],
            "resource": [{"name": "main", "path": []}],
            "pretask": [{"name": "prepare", "exec": "python", "args": ["prepare.py"], "option": ["mode", "flags", "key"]}],
            "option": {
                "mode": {"cases": [
                    {"name": "on", "option": ["credentials"], "pipeline_override": {"Never": {"value": "ignored"}}},
                    {"name": "off", "option": ["inactive"]}
                ]},
                "flags": {"type": "checkbox", "default_case": ["fast"], "min_count": 1, "max_count": 1,
                    "cases": [{"name": "fast", "option": ["desktop"]}, {"name": "slow"}]},
                "credentials": {"type": "input", "inputs": [
                    {"name": "token", "password": true, "default": "default-secret"},
                    {"name": "count", "default": "2", "pipeline_type": "int", "verify": "^[0-9]+$"}
                ], "pipeline_override": {"Ignored": {"value": "{unknown}"}}},
                "desktop": {"type": "input", "controller": ["PC"], "inputs": [{"name": "bad", "verify": "["}]},
                "inactive": {"type": "input", "inputs": [{"name": "bad", "verify": "["}]},
                "key": {"type": "hotkey", "hotkeys": [{"name": "attack", "default": "F1"}]}
            }
        }), "en_us").unwrap()
    }

    #[test]
    fn pretask_options_do_not_merge_pipeline_overrides_and_keep_declaration_order() {
        let mut project = project();
        let mut second = project.pretasks[0].clone();
        second.name = "second".into();
        second.explicit_name = Some("second".into());
        second.options.clear();
        project.pretasks.push(second);
        let mut configuration = UserConfiguration::default();
        configuration.run_configurations.push(RunConfiguration {
            id: "run".into(),
            name: "Run".into(),
            tasks: vec![],
        });
        configuration.active_run_configuration_id = Some("run".into());
        let resolved = super::super::resolver::resolve_run(&project, &configuration).unwrap();
        assert_eq!(resolved.pipeline_override, json!({}));
        let commands = resolve_pretasks(&project, &configuration).unwrap();
        assert_eq!(
            commands
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["prepare", "second"]
        );
        assert_eq!(commands[1].args, vec!["prepare.py"]);
    }

    #[test]
    fn resolves_defaults_and_active_children_as_compact_preset_values() {
        let project = project();
        let result = resolve_pretasks(&project, &UserConfiguration::default()).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "prepare");
        assert_eq!(result[0].exec, "python");
        assert_eq!(result[0].args[0], "prepare.py");
        assert!(!result[0].args[1].contains('\n'));
        assert_eq!(
            serde_json::from_str::<Value>(&result[0].args[1]).unwrap(),
            json!({
                "mode": "on", "flags": ["fast"], "credentials": {"token": "default-secret", "count": "2"}, "key": {"attack": "F1"}
            })
        );
        assert!(!format!("{:?}", result[0]).contains("default-secret"));
    }

    #[test]
    fn reads_children_only_from_their_own_pretask_scope() {
        let project = project();
        let mut config = UserConfiguration::default();
        config.global_option_values.insert(
            "credentials".into(),
            OptionValue::Inputs {
                values: BTreeMap::from([("token".into(), "other-scope".into())]),
            },
        );
        config.pretask_values.insert(
            "prepare".into(),
            ConfiguredPretask {
                enabled: true,
                option_values: BTreeMap::from([(
                    "credentials".into(),
                    OptionValue::Inputs {
                        values: BTreeMap::from([("token".into(), "私密\n\"value".into())]),
                    },
                )]),
            },
        );
        let commands = resolve_pretasks(&project, &config).unwrap();
        let values: Value = serde_json::from_str(&commands[0].args[1]).unwrap();
        assert_eq!(values["credentials"]["token"], "私密\n\"value");
        assert_eq!(values["credentials"]["count"], "2");
    }

    #[test]
    fn skips_disabled_or_filtered_pretasks_before_option_validation() {
        let mut project = project();
        project.pretasks[0].options = vec!["unknown".into()];
        let mut config = UserConfiguration::default();
        config.pretask_values.insert(
            "prepare".into(),
            ConfiguredPretask {
                enabled: false,
                ..Default::default()
            },
        );
        assert!(resolve_pretasks(&project, &config).unwrap().is_empty());
        config.pretask_values.clear();
        project.pretasks[0].controllers = vec!["PC".into()];
        assert!(resolve_pretasks(&project, &config).unwrap().is_empty());
        project.pretasks[0].controllers.clear();
        project.pretasks[0].resources = vec!["other".into()];
        assert!(resolve_pretasks(&project, &config).unwrap().is_empty());
    }

    #[test]
    fn filters_parent_options_and_children_and_omits_json_for_empty_declarations() {
        let mut project = project();
        let OptionDefinition::Select { applicability, .. } =
            project.options.get_mut("mode").unwrap()
        else {
            panic!()
        };
        applicability.resources = vec!["other".into()];
        project.pretasks[0].options = vec!["mode".into()];
        let result = resolve_pretasks(&project, &UserConfiguration::default()).unwrap();
        assert_eq!(result[0].args, vec!["prepare.py", "{}"]);
        project.pretasks[0].options.clear();
        let result = resolve_pretasks(&project, &UserConfiguration::default()).unwrap();
        assert_eq!(result[0].args, vec!["prepare.py"]);
    }

    #[test]
    fn rejects_invalid_case_shape_count_input_fields_types_patterns_and_cycles() {
        let project = project();
        let invalid = [
            (
                "mode",
                OptionValue::Single {
                    case: "missing".into(),
                },
            ),
            ("mode", OptionValue::Multiple { cases: vec![] }),
            ("flags", OptionValue::Multiple { cases: vec![] }),
            (
                "flags",
                OptionValue::Multiple {
                    cases: vec!["fast".into(), "slow".into()],
                },
            ),
            (
                "flags",
                OptionValue::Multiple {
                    cases: vec!["fast".into(), "fast".into()],
                },
            ),
            (
                "credentials",
                OptionValue::Inputs {
                    values: BTreeMap::from([("count".into(), "bad".into())]),
                },
            ),
            (
                "credentials",
                OptionValue::Inputs {
                    values: BTreeMap::from([("unknown".into(), "value".into())]),
                },
            ),
            (
                "key",
                OptionValue::Inputs {
                    values: BTreeMap::from([("attack".into(), "secret-invalid-key".into())]),
                },
            ),
        ];
        for (name, value) in invalid {
            let mut config = UserConfiguration::default();
            config.pretask_values.insert(
                "prepare".into(),
                ConfiguredPretask {
                    enabled: true,
                    option_values: BTreeMap::from([(name.into(), value)]),
                },
            );
            let error = resolve_pretasks(&project, &config).unwrap_err();
            assert!(!error.to_string().contains("secret-invalid-key"));
        }
        let mut cyclic = project.clone();
        let OptionDefinition::Select { cases, .. } = cyclic.options.get_mut("mode").unwrap() else {
            panic!()
        };
        cases[0].options.push("mode".into());
        assert!(matches!(
            resolve_pretasks(&cyclic, &UserConfiguration::default()),
            Err(ResolverError::CyclicOption(_))
        ));
        let mut unknown = project.clone();
        unknown.pretasks[0].options.push("unknown".into());
        assert!(matches!(
            resolve_pretasks(&unknown, &UserConfiguration::default()),
            Err(ResolverError::UnknownOption(_))
        ));
    }

    #[test]
    fn resource_fallback_and_missing_platform_requirements() {
        let mut project = project();
        let mut config = UserConfiguration::default();
        config.active_resource = Some("removed".into());
        assert_eq!(resolve_pretasks(&project, &config).unwrap().len(), 1);
        project.resources.clear();
        assert!(matches!(
            resolve_pretasks(&project, &config),
            Err(ResolverError::NoResource)
        ));
        project.controllers.clear();
        assert!(matches!(
            resolve_pretasks(&project, &config),
            Err(ResolverError::NoController)
        ));
        project.pretasks.clear();
        assert!(resolve_pretasks(&project, &config).unwrap().is_empty());
    }
}

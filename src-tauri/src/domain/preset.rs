//! Applying a PI pre-task snapshot is independent of execution and pipeline merging.
use super::pretask::declared_options;
use super::types::*;
use std::collections::BTreeMap;

/// Resource-distributed presets must never supply password values.
/// Also called at application time so programmatically constructed templates are safe.
pub fn remove_password_values(
    definitions: &BTreeMap<String, OptionDefinition>,
    values: &mut BTreeMap<String, OptionValue>,
) {
    for (name, value) in values {
        if let (Some(OptionDefinition::Input { inputs, .. }), OptionValue::Inputs { values }) =
            (definitions.get(name), value)
        {
            values.retain(|name, _| {
                !inputs
                    .iter()
                    .any(|field| &field.name == name && field.password)
            });
        }
    }
}

/// None is a legacy preset and leaves all pre-task state untouched. A present
/// list is a checkbox snapshot, including when empty. Unlisted options remain
/// stored for reuse; listed entries replace non-password values with the snapshot
/// while retaining passwords already stored for that pre-task.
pub fn apply_pretasks(
    project: &Project,
    preset: &ConfigurationTemplate,
    configuration: &mut UserConfiguration,
) {
    let Some(items) = &preset.pretasks else {
        return;
    };
    for task in &project.pretasks {
        let configured = configuration
            .pretask_values
            .entry(task.name.clone())
            .or_default();
        // Match only explicit PI identifiers, never anonymous internal keys.
        let item = task
            .explicit_name
            .as_ref()
            .and_then(|name| items.iter().find(|item| &item.name == name));
        configured.enabled = item.is_some_and(|item| item.enabled);
        if let Some(item) = item {
            let declared = declared_options(project, &task.options);
            let mut snapshot: BTreeMap<_, _> = item
                .option
                .iter()
                .filter(|(name, _)| declared.contains(*name))
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            remove_password_values(&project.options, &mut snapshot);
            for (name, old_value) in &configured.option_values {
                if !declared.contains(name) {
                    continue;
                }
                let (Some(OptionDefinition::Input { inputs, .. }), OptionValue::Inputs { values }) =
                    (project.options.get(name), old_value)
                else {
                    continue;
                };
                for field in inputs.iter().filter(|field| field.password) {
                    if let Some(secret) = values.get(&field.name) {
                        let entry =
                            snapshot
                                .entry(name.clone())
                                .or_insert_with(|| OptionValue::Inputs {
                                    values: BTreeMap::new(),
                                });
                        if !matches!(entry, OptionValue::Inputs { .. }) {
                            *entry = OptionValue::Inputs {
                                values: BTreeMap::new(),
                            };
                        }
                        if let OptionValue::Inputs { values } = entry {
                            values.insert(field.name.clone(), secret.clone());
                        }
                    }
                }
            }
            configured.option_values = snapshot;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{loader::ProjectLoader, pretask::resolve_pretasks};
    use serde_json::{json, Value};

    fn project() -> Project {
        ProjectLoader::default().load_value(".", json!({
            "interface_version": 2, "name": "preset-tests",
            "controller": [{"name": "Android", "type": "Adb"}],
            "resource": [{"name": "main", "path": []}],
            "pretask": [
                {"name": "first", "exec": "tool", "args": ["first"], "option": ["mode"]},
                {"exec": "anonymous"},
                {"name": "second", "exec": "tool", "args": ["second"], "option": ["credentials"]},
                {"name": "filtered", "exec": "tool", "controller": ["PC"]}
            ],
            "option": {
                "mode": {"cases": [{"name": "on", "option": ["credentials"]}, {"name": "off"}]},
                "credentials": {"type": "input", "inputs": [
                    {"name": "username", "default": "default"}, {"name": "password", "password": true}
                ]}
            },
            "preset": [
                {"name": "legacy"}, {"name": "empty", "pretask": []},
                {"name": "snapshot", "task": [{"name": "Task", "option": {"credentials": {"username": "task-safe", "password": "forbidden-task"}}}], "pretask": [
                    {"name": "second", "option": {"credentials": {"username": "preset", "password": "forbidden"}}},
                    {"name": "first", "option": {"mode": "on", "credentials": {"username": "child", "password": "forbidden-child"}}},
                    {"name": "filtered"}, {"name": "anonymous#1"}, {"name": "unknown", "enabled": "ignored"}
                ]}
            ]
        }), "en_us").unwrap()
    }

    fn configuration(project: &Project) -> UserConfiguration {
        let mut configuration = UserConfiguration::default();
        for task in &project.pretasks {
            configuration.pretask_values.insert(
                task.name.clone(),
                ConfiguredPretask {
                    enabled: true,
                    option_values: BTreeMap::from([(
                        "credentials".into(),
                        OptionValue::Inputs {
                            values: BTreeMap::from([
                                ("username".into(), "existing".into()),
                                ("password".into(), "device-secret".into()),
                            ]),
                        },
                    )]),
                },
            );
        }
        configuration
    }

    #[test]
    fn merged_imports_can_supply_referenced_explicit_pretasks() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("child.json"),
            json!({
                "pretask": [{"name": "imported", "exec": "tool"}],
                "preset": [{"name": "imported-preset", "pretask": [{"name": "local"}]}]
            })
            .to_string(),
        )
        .unwrap();
        let project = ProjectLoader::default()
            .load_value(
                directory.path(),
                json!({
                    "interface_version": 2, "name": "test", "import": ["child.json"],
                    "pretask": {"name": "local", "exec": "tool"},
                    "preset": [{"name": "main", "pretask": [{"name": "imported"}]}]
                }),
                "en_us",
            )
            .unwrap();
        assert_eq!(
            project.presets[0].pretasks.as_ref().unwrap()[0].name,
            "imported"
        );
        assert_eq!(
            project.presets[1].pretasks.as_ref().unwrap()[0].name,
            "local"
        );
    }

    #[test]
    fn malformed_snapshot_shapes_and_known_entry_enabled_types_are_rejected() {
        for snapshot in [
            json!(null),
            json!({}),
            json!("bad"),
            json!([{}]),
            json!(["bad"]),
            json!([{"name": "prepare", "enabled": "bad"}]),
        ] {
            assert!(ProjectLoader::default()
                .load_value(
                    ".",
                    json!({
                        "interface_version": 2, "name": "test",
                        "pretask": {"name": "prepare", "exec": "tool"},
                        "preset": [{"name": "bad", "pretask": snapshot}]
                    }),
                    "en_us"
                )
                .is_err());
        }
    }

    #[test]
    fn legacy_model_deserialization_keeps_snapshot_omitted() {
        let template: ConfigurationTemplate = serde_json::from_value(json!({
            "name": "old", "label": "Old", "tasks": []
        }))
        .unwrap();
        assert!(template.pretasks.is_none());
        let template: ConfigurationTemplate = serde_json::from_value(json!({
            "name": "empty", "label": "Empty", "tasks": [], "pretasks": []
        }))
        .unwrap();
        assert!(template.pretasks.unwrap().is_empty());
    }

    #[test]
    fn absent_pretask_preserves_the_entire_configuration() {
        let project = project();
        let mut configuration = configuration(&project);
        let original = configuration.clone();
        apply_pretasks(&project, &project.presets[0], &mut configuration);
        assert_eq!(configuration, original);
        assert!(project.presets[0].pretasks.is_none());
        let serialized = serde_json::to_value(&project.presets[0]).unwrap();
        assert!(serialized.get("pretasks").is_none());
    }

    #[test]
    fn empty_snapshot_disables_all_including_unconfigured_and_anonymous_entries() {
        let project = project();
        let mut configuration = configuration(&project);
        let previous = configuration.clone();
        configuration.pretask_values.remove("first");
        apply_pretasks(&project, &project.presets[1], &mut configuration);
        assert_eq!(configuration.pretask_values.len(), project.pretasks.len());
        assert!(configuration
            .pretask_values
            .values()
            .all(|item| !item.enabled));
        assert_eq!(
            configuration.pretask_values["second"].option_values,
            previous.pretask_values["second"].option_values
        );
        assert!(resolve_pretasks(&project, &configuration)
            .unwrap()
            .is_empty());
        assert_eq!(
            serde_json::to_value(&project.presets[1]).unwrap()["pretasks"],
            json!([])
        );
    }

    #[test]
    fn snapshot_uses_explicit_names_ignores_unknowns_and_keeps_merged_execution_order() {
        let project = project();
        let mut configuration = configuration(&project);
        let preset = &project.presets[2];
        assert_eq!(preset.pretasks.as_ref().unwrap().len(), 3);
        assert!(!serde_json::to_string(preset).unwrap().contains("forbidden"));
        apply_pretasks(&project, preset, &mut configuration);
        assert!(!configuration.pretask_values["anonymous#1"].enabled);
        assert!(!configuration.pretask_values.contains_key("unknown"));
        let commands = resolve_pretasks(&project, &configuration).unwrap();
        assert_eq!(
            commands
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        let first: Value = serde_json::from_str(commands[0].args.last().unwrap()).unwrap();
        assert_eq!(first["credentials"]["username"], "child");
        assert_eq!(first["credentials"]["password"], "device-secret");
        let second: Value = serde_json::from_str(commands[1].args.last().unwrap()).unwrap();
        assert_eq!(second["credentials"]["username"], "preset");
        assert_eq!(second["credentials"]["password"], "device-secret");
    }

    #[test]
    fn application_also_sanitizes_programmatic_templates_and_ignores_anonymous_keys() {
        let project = project();
        let mut configuration = configuration(&project);
        let mut preset = project.presets[2].clone();
        preset.pretasks = Some(vec![
            TemplatePretask {
                name: "first".into(),
                enabled: false,
                option: BTreeMap::from([
                    (
                        "credentials".into(),
                        OptionValue::Inputs {
                            values: BTreeMap::from([
                                ("username".into(), "safe".into()),
                                ("password".into(), "injected".into()),
                            ]),
                        },
                    ),
                    (
                        "unknown".into(),
                        OptionValue::Single {
                            case: "ignored".into(),
                        },
                    ),
                ]),
            },
            TemplatePretask {
                name: "anonymous#1".into(),
                enabled: true,
                option: BTreeMap::new(),
            },
        ]);
        apply_pretasks(&project, &preset, &mut configuration);
        assert!(!configuration.pretask_values["first"].enabled);
        assert!(!configuration.pretask_values["anonymous#1"].enabled);
        let options = &configuration.pretask_values["first"].option_values;
        assert!(!options.contains_key("unknown"));
        let OptionValue::Inputs { values } = &options["credentials"] else {
            panic!()
        };
        assert_eq!(values["username"], "safe");
        assert_eq!(values["password"], "device-secret");
    }

    #[test]
    fn snapshot_omitting_an_option_keeps_only_its_existing_password() {
        let project = project();
        let mut configuration = configuration(&project);
        let mut preset = project.presets[2].clone();
        preset.pretasks = Some(vec![TemplatePretask {
            name: "second".into(),
            enabled: true,
            option: BTreeMap::new(),
        }]);
        apply_pretasks(&project, &preset, &mut configuration);
        let OptionValue::Inputs { values } =
            &configuration.pretask_values["second"].option_values["credentials"]
        else {
            panic!()
        };
        assert_eq!(values.len(), 1);
        assert_eq!(values["password"], "device-secret");
        let commands = resolve_pretasks(&project, &configuration).unwrap();
        let options: Value = serde_json::from_str(commands[0].args.last().unwrap()).unwrap();
        assert_eq!(options["credentials"]["username"], "default");
        assert_eq!(options["credentials"]["password"], "device-secret");
    }

    #[test]
    fn preset_password_is_ignored_when_no_local_password_exists() {
        let project = project();
        let mut configuration = UserConfiguration::default();
        let mut preset = project.presets[2].clone();
        let item = &mut preset.pretasks.as_mut().unwrap()[0];
        item.option.insert(
            "credentials".into(),
            OptionValue::Inputs {
                values: BTreeMap::from([
                    ("username".into(), "preset-user".into()),
                    ("password".into(), "injected".into()),
                ]),
            },
        );
        apply_pretasks(&project, &preset, &mut configuration);
        let OptionValue::Inputs { values } =
            &configuration.pretask_values["second"].option_values["credentials"]
        else {
            panic!()
        };
        assert_eq!(values["username"], "preset-user");
        assert!(!values.contains_key("password"));
    }
}

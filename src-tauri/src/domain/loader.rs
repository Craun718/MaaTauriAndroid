use super::types::*;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("could not read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("could not parse {path}: {source}")]
    Json {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("unsupported Project Interface version: {0}")]
    UnsupportedVersion(i64),
    #[error("missing required field: {0}")]
    MissingField(&'static str),
    #[error("duplicate task name: {0}")]
    DuplicateTask(String),
    #[error("unknown option reference: {0}")]
    UnknownOption(String),
    #[error("could not parse input definition for {option}: {source}")]
    InputDefinition {
        option: String,
        source: serde_json::Error,
    },
    #[error("unsupported controller for Android: {0}")]
    UnsupportedController(String),
}

#[derive(Default)]
pub struct ProjectLoader;

impl ProjectLoader {
    pub fn load(
        &self,
        path: impl AsRef<Path>,
        preferred_language: &str,
    ) -> Result<Project, ProjectError> {
        let path = path.as_ref();
        let root = read_json(path)?;
        self.load_value(
            path.parent().unwrap_or(Path::new("/")),
            root,
            preferred_language,
        )
    }

    pub fn load_embedded(
        &self,
        document: Value,
        translations: BTreeMap<String, String>,
        preferred_language: &str,
    ) -> Result<Project, ProjectError> {
        self.load_document(
            Path::new("embedded"),
            document,
            Some(translations),
            preferred_language,
        )
    }

    pub fn load_value(
        &self,
        root: impl AsRef<Path>,
        document: Value,
        preferred_language: &str,
    ) -> Result<Project, ProjectError> {
        self.load_document(root.as_ref(), document, None, preferred_language)
    }

    fn load_document(
        &self,
        root: &Path,
        mut document: Value,
        embedded_translations: Option<BTreeMap<String, String>>,
        preferred_language: &str,
    ) -> Result<Project, ProjectError> {
        document = merge_imports(root, document)?;
        let version = document
            .get("interface_version")
            .and_then(Value::as_i64)
            .ok_or(ProjectError::MissingField("interface_version"))?;
        if version != 2 {
            return Err(ProjectError::UnsupportedVersion(version));
        }

        let languages: Vec<String> = document
            .get("languages")
            .and_then(Value::as_object)
            .map(|values| values.keys().cloned().collect())
            .unwrap_or_default();
        let language = if languages.iter().any(|item| item == preferred_language) {
            preferred_language.to_string()
        } else {
            languages
                .iter()
                .find(|item| item.as_str() == "zh_cn")
                .cloned()
                .or_else(|| languages.first().cloned())
                .unwrap_or_else(|| "zh_cn".to_string())
        };
        let translations = match embedded_translations {
            Some(translations) => translations,
            None => load_translations(root, &document, &language)?,
        };
        let text = |value: Option<&Value>| -> Option<String> {
            localize(value.and_then(Value::as_str), &translations)
        };

        let name = document
            .get("name")
            .and_then(Value::as_str)
            .ok_or(ProjectError::MissingField("name"))?
            .to_string();
        let label = text(document.get("label")).unwrap_or_else(|| name.clone());
        let controllers = document
            .get("controller")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let controller_type = item.get("type")?.as_str()?.to_string();
                        if !controller_type.eq_ignore_ascii_case("adb") {
                            return None;
                        }
                        let name = item.get("name")?.as_str()?.to_string();
                        let label = text(item.get("label")).unwrap_or_else(|| name.clone());
                        Some(ControllerDefinition {
                            name,
                            label,
                            controller_type: "Adb".to_string(),
                            raw: item.clone(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let resources = array(&document, "resource")
            .into_iter()
            .map(|item| {
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or(ProjectError::MissingField("resource.name"))?
                    .to_string();
                Ok(ResourceDefinition {
                    label: text(item.get("label")).unwrap_or_else(|| name.clone()),
                    description: text(item.get("description")),
                    paths: strings(item.get("path"))
                        .ok_or(ProjectError::MissingField("resource.path"))?,
                    controllers: strings(item.get("controller")).unwrap_or_default(),
                    options: strings(item.get("option")).unwrap_or_default(),
                    hash: item.get("hash").and_then(Value::as_str).map(str::to_string),
                    name,
                    raw: item.clone(),
                })
            })
            .collect::<Result<Vec<_>, ProjectError>>()?;

        let groups = array(&document, "group")
            .into_iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_string();
                Some(GroupDefinition {
                    label: text(item.get("label")).unwrap_or_else(|| name.clone()),
                    description: text(item.get("description")),
                    default_expand: item
                        .get("default_expand")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                    name,
                })
            })
            .collect::<Vec<_>>();

        let mut tasks = Vec::new();
        for item in array(&document, "task") {
            let task_name = item
                .get("name")
                .and_then(Value::as_str)
                .ok_or(ProjectError::MissingField("task.name"))?
                .to_string();
            if tasks
                .iter()
                .any(|task: &TaskDefinition| task.name == task_name)
            {
                return Err(ProjectError::DuplicateTask(task_name));
            }
            tasks.push(TaskDefinition {
                label: text(item.get("label")).unwrap_or_else(|| task_name.clone()),
                description: text(item.get("description")),
                entry: item
                    .get("entry")
                    .and_then(Value::as_str)
                    .unwrap_or(&task_name)
                    .to_string(),
                groups: strings(item.get("group")).unwrap_or_default(),
                controllers: strings(item.get("controller")).unwrap_or_default(),
                resources: strings(item.get("resource")).unwrap_or_default(),
                options: strings(item.get("option")).unwrap_or_default(),
                pipeline_override: item
                    .get("pipeline_override")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
                default_check: item
                    .get("default_check")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                icon: text(item.get("icon")),
                name: task_name,
            });
        }

        let mut options = BTreeMap::new();
        if let Some(raw) = document.get("option").and_then(Value::as_object) {
            for (name, item) in raw {
                options.insert(name.clone(), parse_option(name, item, &text)?);
            }
        }
        let references = ["global_option"];
        for reference in references {
            for name in strings(document.get(reference)).unwrap_or_default() {
                if !options.contains_key(&name) {
                    return Err(ProjectError::UnknownOption(name));
                }
            }
        }
        for task in &tasks {
            for name in &task.options {
                if !options.contains_key(name) {
                    return Err(ProjectError::UnknownOption(name.clone()));
                }
            }
        }

        let presets = array(&document, "preset")
            .into_iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_string();
                let tasks = item
                    .get("task")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|task| {
                                let task_name = task.get("name")?.as_str()?.to_string();
                                let option = task
                                    .get("option")
                                    .and_then(Value::as_object)
                                    .map(parse_option_values)
                                    .unwrap_or_default();
                                Some(TemplateTask {
                                    label: text(task.get("label"))
                                        .unwrap_or_else(|| task_name.clone()),
                                    enabled: task
                                        .get("enabled")
                                        .and_then(Value::as_bool)
                                        .unwrap_or(true),
                                    option,
                                    task_name,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Some(ConfigurationTemplate {
                    label: text(item.get("label")).unwrap_or_else(|| name.clone()),
                    description: text(item.get("description")),
                    icon: text(item.get("icon")),
                    tasks,
                    name,
                })
            })
            .collect();

        let agents = match document.get("agent") {
            Some(Value::Array(items)) => items.iter().filter_map(parse_agent).collect::<Vec<_>>(),
            Some(item) => parse_agent(item).into_iter().collect(),
            None => Vec::new(),
        };

        let (welcome, welcome_fingerprint, welcome_errors) =
            parse_welcome(document.get("welcome"), &translations);

        Ok(Project {
            root: root.to_string_lossy().into_owned(),
            interface_version: 2,
            name,
            label,
            version: document
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_string),
            language,
            languages,
            controllers,
            resources,
            groups,
            tasks,
            options,
            global_options: strings(document.get("global_option")).unwrap_or_default(),
            presets,
            agents,
            metadata: ProjectMetadata {
                title: text(document.get("title")),
                icon: text(document.get("icon")),
                contact: text(document.get("contact")),
                license: text(document.get("license")),
                github: document
                    .get("github")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                welcome,
                welcome_fingerprint: Some(welcome_fingerprint),
                welcome_errors,
                mirrorchyan_rid: document
                    .get("mirrorchyan_rid")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                mirrorchyan_multiplatform: document
                    .get("mirrorchyan_multiplatform")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
        })
    }
}

fn parse_welcome(
    value: Option<&Value>,
    translations: &BTreeMap<String, String>,
) -> (Vec<String>, String, Vec<String>) {
    let mut raw_values = Vec::new();
    let mut errors = Vec::new();
    match value {
        Some(Value::String(value)) => raw_values.push(value.clone()),
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(value) = item.as_str() {
                    raw_values.push(value.to_string());
                } else {
                    errors.push(format!("welcome entry is not a string: {item}"));
                }
            }
        }
        None => {}
        Some(other) => errors.push(format!("welcome is not a string or array: {other}")),
    }
    let welcome = raw_values
        .iter()
        .filter_map(|value| localize(Some(value), translations))
        .collect();
    let canonical =
        serde_json::to_string(&raw_values).unwrap_or_else(|_| format!("{:?}", raw_values));
    let digest = Sha256::digest(canonical.as_bytes());
    errors.sort();
    (welcome, hex::encode(digest), errors)
}

fn parse_agent(item: &Value) -> Option<AgentDefinition> {
    Some(AgentDefinition {
        child_exec: item.get("child_exec")?.as_str()?.to_string(),
        child_args: strings(item.get("child_args")).unwrap_or_default(),
        identifier: item
            .get("identifier")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn parse_option(
    name: &str,
    item: &Value,
    text: &dyn Fn(Option<&Value>) -> Option<String>,
) -> Result<OptionDefinition, ProjectError> {
    let label = text(item.get("label")).unwrap_or_else(|| name.to_string());
    let description = text(item.get("description"));
    let icon = text(item.get("icon"));
    let applicability = OptionApplicability {
        controllers: strings(item.get("controller")).unwrap_or_default(),
        resources: strings(item.get("resource")).unwrap_or_default(),
    };
    let kind = item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("select")
        .to_ascii_lowercase();
    let cases = item
        .get("cases")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|case| OptionCase {
                    label: text(case.get("label")).unwrap_or_else(|| {
                        case.get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    }),
                    description: text(case.get("description")),
                    icon: text(case.get("icon")),
                    options: strings(case.get("option")).unwrap_or_default(),
                    pipeline_override: case
                        .get("pipeline_override")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                    name: case
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let default_case = item.get("default_case").cloned();

    let option = match kind.as_str() {
        "select" => OptionDefinition::Select {
            name: name.to_string(),
            label,
            description,
            cases,
            default_case: default_case.and_then(default_string),
            icon,
            applicability,
        },
        "switch" => OptionDefinition::Switch {
            name: name.to_string(),
            label,
            description,
            cases,
            default_case: default_case.and_then(default_string),
            icon,
            applicability,
        },
        "checkbox" => OptionDefinition::Checkbox {
            name: name.to_string(),
            label,
            description,
            cases,
            default_cases: default_case
                .map(|value| match value {
                    Value::Array(items) => items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect(),
                    Value::String(value) => vec![value],
                    _ => Vec::new(),
                })
                .unwrap_or_default(),
            min_count: item
                .get("min_count")
                .and_then(Value::as_u64)
                .map(|value| value as u32),
            max_count: item
                .get("max_count")
                .and_then(Value::as_u64)
                .map(|value| value as u32),
            icon,
            applicability,
        },
        "input" | "hotkey" => {
            let fields = item
                .get(if kind == "input" { "inputs" } else { "hotkeys" })
                .cloned();
            if kind == "input" {
                let inputs = match fields {
                    Some(fields) => serde_json::from_value::<Vec<InputFieldDefinition>>(fields)
                        .map_err(|source| ProjectError::InputDefinition {
                            option: name.to_string(),
                            source,
                        })?,
                    None => Vec::new(),
                };
                OptionDefinition::Input {
                    name: name.to_string(),
                    label,
                    description,
                    inputs,
                    pipeline_override: item
                        .get("pipeline_override")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                    icon,
                    applicability,
                }
            } else {
                let hotkeys = fields
                    .map(|fields| {
                        serde_json::from_value::<Vec<HotkeyFieldDefinition>>(fields).map_err(
                            |source| ProjectError::InputDefinition {
                                option: name.to_string(),
                                source,
                            },
                        )
                    })
                    .transpose()?
                    .unwrap_or_default();
                OptionDefinition::Hotkey {
                    name: name.to_string(),
                    label,
                    description,
                    hotkeys,
                    pipeline_override: item
                        .get("pipeline_override")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                    icon,
                    applicability,
                }
            }
        }
        other => return Err(ProjectError::UnsupportedController(other.to_string())),
    };
    Ok(option)
}

fn default_string(value: Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value),
        Value::Array(items) => items.first().and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}

fn parse_option_values(values: &Map<String, Value>) -> BTreeMap<String, OptionValue> {
    values
        .iter()
        .filter_map(|(name, value)| {
            let parsed = match value {
                Value::String(case) => OptionValue::Single { case: case.clone() },
                Value::Array(cases) => OptionValue::Multiple {
                    cases: cases
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect(),
                },
                Value::Object(values) => OptionValue::Inputs {
                    values: values
                        .iter()
                        .filter_map(|(key, value)| {
                            value.as_str().map(|value| (key.clone(), value.to_string()))
                        })
                        .collect(),
                },
                _ => return None,
            };
            Some((name.clone(), parsed))
        })
        .collect()
}

fn merge_imports(root: &Path, document: Value) -> Result<Value, ProjectError> {
    merge_document(root, document, &mut Vec::new())
}

fn merge_document(
    root: &Path,
    document: Value,
    stack: &mut Vec<PathBuf>,
) -> Result<Value, ProjectError> {
    let imports = strings(document.get("import")).unwrap_or_default();
    let mut merged = document.clone();
    for import in imports {
        let child_path = normalize_path(root, &import);
        if stack.contains(&child_path) {
            continue;
        }
        let child = read_json(&child_path)?;
        let child = merge_child(root, child, child_path, stack)?;
        merged = merge_fragment(merged, child);
    }
    Ok(merged)
}

fn merge_child(
    root: &Path,
    child: Value,
    child_path: PathBuf,
    stack: &mut Vec<PathBuf>,
) -> Result<Value, ProjectError> {
    stack.push(child_path);
    let imports = strings(child.get("import")).unwrap_or_default();
    let mut result = child;
    for import in imports {
        let import_path = normalize_path(root, &import);
        if stack.contains(&import_path) {
            continue;
        }
        let imported = read_json(&import_path)?;
        let imported = merge_child(root, imported, import_path, stack)?;
        result = merge_fragment(result, imported);
    }
    stack.pop();
    Ok(result)
}

fn merge_fragment(mut base: Value, imported: Value) -> Value {
    const MERGE_ARRAYS: [&str; 6] = [
        "task",
        "preset",
        "group",
        "setting",
        "pretask",
        "global_option",
    ];
    for key in MERGE_ARRAYS {
        if let (Some(existing), Some(incoming)) = (
            base.get_mut(key).and_then(Value::as_array_mut),
            imported.get(key).and_then(Value::as_array),
        ) {
            existing.extend(incoming.clone());
        } else if let Some(incoming) = imported.get(key) {
            if let Some(object) = base.as_object_mut() {
                object.insert(key.to_string(), incoming.clone());
            }
        }
    }
    if let (Some(existing), Some(incoming)) = (
        base.get_mut("option").and_then(Value::as_object_mut),
        imported.get("option").and_then(Value::as_object),
    ) {
        for (key, value) in incoming {
            existing.insert(key.clone(), value.clone());
        }
    }
    base
}

fn read_json(path: &Path) -> Result<Value, ProjectError> {
    let contents = fs::read_to_string(path).map_err(|source| ProjectError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&contents).map_err(|source| ProjectError::Json {
        path: path.to_path_buf(),
        source,
    })
}

fn load_translations(
    root: &Path,
    document: &Value,
    language: &str,
) -> Result<BTreeMap<String, String>, ProjectError> {
    let path = document
        .get("languages")
        .and_then(|languages| languages.get(language))
        .and_then(Value::as_str)
        .map(|relative| normalize_path(root, relative));
    let Some(path) = path else {
        return Ok(BTreeMap::new());
    };
    let value = read_json(&path)?;
    Ok(value
        .as_object()
        .map(|values| {
            values
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default())
}

fn localize(value: Option<&str>, translations: &BTreeMap<String, String>) -> Option<String> {
    let value = value?;
    if let Some(key) = value.strip_prefix('$') {
        translations.get(key).cloned()
    } else {
        Some(value.to_string())
    }
}

fn normalize_path(root: &Path, relative: &str) -> PathBuf {
    let path = Path::new(relative);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

fn array<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

pub(crate) fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    value.and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_interface_and_locale_from_a_filesystem_project_root() {
        let root = std::env::temp_dir().join(format!(
            "maa_tauri_android-project-loader-{}-filesystem",
            std::process::id()
        ));
        fs::create_dir_all(root.join("locale")).expect("temp project locale should be created");
        fs::write(
            root.join("interface.json"),
            r#"{
                "interface_version": 2,
                "name": "profiled",
                "label": "$profiled",
                "languages": {"zh_cn": "locale/zh_cn.json"},
                "resource": [{"name": "base", "path": ["resource/base"]}],
                "task": [{
                    "name": "Start",
                    "entry": "Start",
                    "pipeline_override": {"Start": {"next": ["Login"]}}
                }]
            }"#,
        )
        .expect("interface should be written");
        fs::write(
            root.join("locale/zh_cn.json"),
            r#"{"profiled": "配置项目"}"#,
        )
        .expect("locale should be written");

        let result = ProjectLoader::default().load(root.join("interface.json"), "zh_cn");
        let project = result.expect("filesystem interface should load");

        assert_eq!(project.root, root.to_string_lossy());
        assert_eq!(project.label, "配置项目");
        assert_eq!(project.resources[0].paths, vec!["resource/base"]);
        assert_eq!(
            project.tasks[0].pipeline_override,
            json!({"Start": {"next": ["Login"]}})
        );

        fs::remove_dir_all(&root).ok();
    }
}

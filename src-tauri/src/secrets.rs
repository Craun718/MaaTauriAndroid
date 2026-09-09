use crate::domain::types::{OptionValue, Project, UserConfiguration};
use std::collections::BTreeMap;

pub const ENVELOPE_PREFIX: &str = "enc:v1:";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("Android secret bridge is not initialized")]
    BridgeUnavailable,
    #[error("secret operation failed: {0}")]
    Jni(String),
}

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct SecretManifest(BTreeMap<String, ()>);

impl SecretManifest {
    pub(crate) fn insert(&mut self, key: String) {
        self.0.insert(key, ());
    }

    pub(crate) fn contains(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }
}

pub fn encrypt_configuration_with_manifest(
    project: &Project,
    configuration: &mut UserConfiguration,
) -> Result<SecretManifest, SecretError> {
    #[cfg(target_os = "android")]
    {
        let password_fields = password_fields(project);
        let mut manifest = SecretManifest::default();
        transform_configuration(configuration, &mut |key, value| {
            if value.starts_with(ENVELOPE_PREFIX) {
                manifest.insert(key.to_string());
                return Ok(value.to_string());
            }
            if !is_password_key(key, &password_fields) {
                return Ok(value.to_string());
            }
            manifest.insert(key.to_string());
            call_bridge("encrypt", value)
        })?;
        Ok(manifest)
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(SecretManifest::default())
    }
}

pub fn decrypt_configuration_with_manifest(
    project: &Project,
    configuration: &mut UserConfiguration,
    manifest: Option<&SecretManifest>,
) -> Result<(), SecretError> {
    #[cfg(target_os = "android")]
    {
        if let Some(manifest) = manifest {
            transform_configuration(configuration, &mut |key, value| {
                if manifest.contains(key) && value.starts_with(ENVELOPE_PREFIX) {
                    call_bridge("decrypt", value)
                } else {
                    Ok(value.to_string())
                }
            })
        } else {
            let password_fields = password_fields(project);
            transform_configuration(configuration, &mut |key, value| {
                if is_password_key(key, &password_fields) && value.starts_with(ENVELOPE_PREFIX) {
                    call_bridge("decrypt", value)
                } else {
                    Ok(value.to_string())
                }
            })
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = configuration;
        let _ = manifest;
        Ok(())
    }
}

type ScopedTransform<'a> = dyn FnMut(&str, &str) -> Result<String, SecretError> + 'a;

fn transform_configuration(
    configuration: &mut UserConfiguration,
    transform: &mut ScopedTransform,
) -> Result<(), SecretError> {
    transform_option_values(
        &mut configuration.global_option_values,
        &["global"],
        transform,
    )?;

    for (controller_name, values) in &mut configuration.controller_option_values {
        transform_option_values(values, &["controller", controller_name], transform)?;
    }
    for (resource_name, values) in &mut configuration.resource_option_values {
        transform_option_values(values, &["resource", resource_name], transform)?;
    }
    for run in &mut configuration.run_configurations {
        for task in &mut run.tasks {
            transform_option_values(
                &mut task.option_values,
                &["task", &run.id, &task.instance_id],
                transform,
            )?;
        }
    }
    Ok(())
}

fn is_password_key(key: &str, password_fields: &BTreeMap<&str, BTreeMap<&str, ()>>) -> bool {
    let Ok(parts) = serde_json::from_str::<Vec<String>>(key) else {
        return false;
    };
    match parts.as_slice() {
        [_, option, field] | [_, _, option, field] | [_, _, _, option, field] => password_fields
            .get(option.as_str())
            .is_some_and(|fields| fields.contains_key(field.as_str())),
        _ => false,
    }
}

fn manifest_key(scope: &[&str], option: &str, field: &str) -> String {
    let mut parts = scope.to_vec();
    parts.push(option);
    parts.push(field);
    serde_json::to_string(&parts).expect("manifest key must be JSON serializable")
}

fn password_fields(project: &Project) -> BTreeMap<&str, BTreeMap<&str, ()>> {
    let mut fields = BTreeMap::new();
    for option in project.options.values() {
        let crate::domain::types::OptionDefinition::Input { name, inputs, .. } = option else {
            continue;
        };
        let passwords = inputs
            .iter()
            .filter(|field| field.password)
            .map(|field| (field.name.as_str(), ()))
            .collect::<BTreeMap<_, _>>();
        if !passwords.is_empty() {
            fields.insert(name.as_str(), passwords);
        }
    }
    fields
}

fn transform_option_values(
    values: &mut BTreeMap<String, OptionValue>,
    scope: &[&str],
    transform: &mut ScopedTransform,
) -> Result<(), SecretError> {
    for (option_name, value) in values {
        let OptionValue::Inputs { values } = value else {
            continue;
        };
        for (field_name, field_value) in values {
            let key = manifest_key(scope, option_name, field_name);
            *field_value = transform(&key, field_value)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "android")]
pub(crate) mod android {
    use super::SecretError;
    use jni::{
        objects::{GlobalRef, JString, JValue},
        JNIEnv, JavaVM,
    };
    use std::sync::OnceLock;

    const BRIDGE_CLASS: &str = "top/natsuu/ttflow/SecretBridge";
    const METHOD_SIGNATURE: &str = "(Ljava/lang/String;)Ljava/lang/String;";

    struct SecretBridge {
        vm: JavaVM,
        class: GlobalRef,
    }

    static BRIDGE: OnceLock<SecretBridge> = OnceLock::new();

    pub fn initialize(env: &mut JNIEnv) -> Result<(), SecretError> {
        if BRIDGE.get().is_some() {
            return Ok(());
        }
        let vm = env.get_java_vm().map_err(jni_error)?;
        let class = env.find_class(BRIDGE_CLASS).map_err(jni_error)?;
        let class = env.new_global_ref(class).map_err(jni_error)?;
        BRIDGE
            .set(SecretBridge { vm, class })
            .map_err(|_| SecretError::Jni("secret bridge was already initialized".to_string()))
    }

    pub fn call(method: &str, value: &str) -> Result<String, SecretError> {
        let bridge = BRIDGE.get().ok_or(SecretError::BridgeUnavailable)?;
        let mut env = bridge.vm.attach_current_thread().map_err(jni_error)?;
        let input = env.new_string(value).map_err(jni_error)?;
        let result = env
            .call_static_method(
                &bridge.class,
                method,
                METHOD_SIGNATURE,
                &[JValue::Object(&input)],
            )
            .map_err(|error| {
                if env.exception_check().unwrap_or_default() {
                    let _ = env.exception_clear();
                }
                jni_error(error)
            })?;
        let result = JString::from(result.l().map_err(jni_error)?);
        let result = env.get_string(&result).map_err(jni_error)?;
        Ok(result.to_string_lossy().into_owned())
    }

    fn jni_error(error: jni::errors::Error) -> SecretError {
        SecretError::Jni(error.to_string())
    }
}

#[cfg(target_os = "android")]
fn call_bridge(method: &str, value: &str) -> Result<String, SecretError> {
    android::call(method, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{
        ConfiguredTask, InputFieldDefinition, OptionApplicability, OptionDefinition, PipelineType,
        RunConfiguration, TaskDefinition,
    };

    fn project() -> Project {
        let inputs = vec![InputFieldDefinition {
            name: "token".to_string(),
            label: "Token".to_string(),
            description: None,
            default: None,
            pipeline_type: PipelineType::String,
            verify: None,
            pattern_message: None,
            password: true,
        }];
        let mut options = BTreeMap::new();
        options.insert(
            "Login".to_string(),
            OptionDefinition::Input {
                name: "Login".to_string(),
                label: "Login".to_string(),
                description: None,
                inputs,
                pipeline_override: serde_json::json!({}),
                icon: None,
                applicability: OptionApplicability {
                    controllers: Vec::new(),
                    resources: Vec::new(),
                },
            },
        );
        Project {
            root: String::new(),
            interface_version: 1,
            name: "project".to_string(),
            label: "Project".to_string(),
            version: None,
            language: "zh_cn".to_string(),
            languages: vec!["zh_cn".to_string()],
            controllers: Vec::new(),
            resources: Vec::new(),
            groups: Vec::new(),
            tasks: vec![TaskDefinition {
                name: "Task".to_string(),
                label: "Task".to_string(),
                entry: "Entry".to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: vec!["Login".to_string()],
                pipeline_override: serde_json::json!({}),
                default_check: true,
                icon: None,
            }],
            options,
            global_options: Vec::new(),
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: Default::default(),
        }
    }

    fn configuration() -> UserConfiguration {
        UserConfiguration {
            schema_version: 1,
            initialized: true,
            active_controller: None,
            active_resource: None,
            global_option_values: BTreeMap::new(),
            controller_option_values: BTreeMap::new(),
            resource_option_values: BTreeMap::new(),
            run_configurations: vec![RunConfiguration {
                id: "run".to_string(),
                name: "Run".to_string(),
                tasks: vec![ConfiguredTask {
                    instance_id: "task".to_string(),
                    task_name: "Task".to_string(),
                    enabled: true,
                    option_values: BTreeMap::from([(
                        "Login".to_string(),
                        OptionValue::Inputs {
                            values: BTreeMap::from([
                                ("token".to_string(), "secret".to_string()),
                                ("plain".to_string(), "value".to_string()),
                            ]),
                        },
                    )]),
                    custom_label: None,
                }],
            }],
            active_run_configuration_id: Some("run".to_string()),
            welcome_fingerprint: None,
        }
    }

    #[test]
    fn manifest_round_trips_without_source_schema() {
        let project = project();
        let password_fields = password_fields(&project);
        let mut manifest = SecretManifest::default();
        let mut encrypted = configuration();
        transform_configuration(&mut encrypted, &mut |key, value| {
            if is_password_key(key, &password_fields) {
                manifest.insert(key.to_string());
                Ok(format!("{ENVELOPE_PREFIX}{value}"))
            } else {
                Ok(value.to_string())
            }
        })
        .expect("encryption transformation should succeed");

        let OptionValue::Inputs { values } = encrypted.run_configurations[0].tasks[0]
            .option_values
            .get("Login")
            .expect("login option is present")
        else {
            panic!("expected input values");
        };
        assert_eq!(values["token"], "enc:v1:secret");
        assert_eq!(values["plain"], "value");
        assert!(manifest.contains(r#"["task","run","task","Login","token"]"#));
        assert!(!manifest.contains(r#"["task","run","task","Login","plain"]"#));

        let mut restored = encrypted.clone();
        transform_configuration(&mut restored, &mut |key, value| {
            if manifest.contains(key) && value.starts_with(ENVELOPE_PREFIX) {
                Ok(value.strip_prefix(ENVELOPE_PREFIX).unwrap().to_string())
            } else {
                Ok(value.to_string())
            }
        })
        .expect("decryption transformation should succeed");

        let OptionValue::Inputs { values } = restored.run_configurations[0].tasks[0]
            .option_values
            .get("Login")
            .expect("login option is present")
        else {
            panic!("expected input values");
        };
        assert_eq!(values["token"], "secret");
        assert_eq!(values["plain"], "value");
    }
}

use crate::domain::types::{ResolvedRun, UiLanguage};
use crate::run_log::RunEventKind;
use crate::runtime::RunState;
use maa_framework::agent_client::AgentClient;
use maa_framework::resource::Resource;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;
use std::thread;

const DESCRIPTOR_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("agent descriptor is invalid: {0}")]
    InvalidDescriptor(String),
    #[error("project interface hash does not match the agent descriptor")]
    InterfaceMismatch,
    #[error(
        "project declares {declared} Python agents but the packaged descriptor has {packaged}"
    )]
    RuntimeCountMismatch { declared: usize, packaged: usize },
    #[error("agent server returned an invalid port: {0}")]
    InvalidPort(String),
    #[error("agent host is unavailable: {0}")]
    Host(String),
    #[error("Maa error: {0}")]
    Maa(String),
}

impl From<maa_framework::MaaError> for AgentError {
    fn from(value: maa_framework::MaaError) -> Self {
        Self::Maa(value.to_string())
    }
}

#[cfg(target_os = "android")]
impl From<jni::errors::Error> for AgentError {
    fn from(value: jni::errors::Error) -> Self {
        Self::Host(value.to_string())
    }
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub schema_version: u64,
    pub abi: String,
    pub interface_sha256: String,
    pub pi_sha256: String,
    pub fingerprint: String,
    pub timeout_ms: u64,
    #[serde(default)]
    pub runtimes: Vec<AgentRuntime>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntime {
    pub interface_index: usize,
    pub bundle_sha256: String,
    pub exec: String,
    pub executables: Vec<String>,
    pub args: Vec<String>,
    pub working_dir: String,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct LaunchedAgent {
    pub stdout: File,
    pub stderr: File,
}

pub struct PreparedAgent {
    pub descriptor: AgentDescriptor,
    pub host: Arc<dyn AgentHost>,
}

pub trait AgentHost: Send + Sync {
    fn prepare(&self, descriptor: &AgentDescriptor, index: usize) -> Result<(), AgentError>;
    fn launch(
        &self,
        descriptor: &AgentDescriptor,
        execution_id: &str,
        index: usize,
        port: u16,
        pi_env: &BTreeMap<String, String>,
    ) -> Result<LaunchedAgent, AgentError>;
    fn stop(&self, execution_id: &str) -> Result<(), AgentError>;
}

pub struct AgentSession {
    execution_id: String,
    host: Arc<dyn AgentHost>,
    clients: Vec<AgentClient>,
}

impl AgentSession {
    fn start(
        execution_id: &str,
        resource: &Resource,
        descriptor: &AgentDescriptor,
        host: Arc<dyn AgentHost>,
        pi_env: &BTreeMap<String, String>,
    ) -> Result<Self, AgentError> {
        if descriptor.runtimes.is_empty() {
            return Err(AgentError::InvalidDescriptor(
                "the descriptor has no agent runtime".to_string(),
            ));
        }
        let mut clients = Vec::with_capacity(descriptor.runtimes.len());
        for (index, _runtime) in descriptor.runtimes.iter().enumerate() {
            let mut client = AgentClient::create_tcp(0)?;
            let port_text = client.identifier().ok_or_else(|| {
                AgentError::InvalidPort("MaaFramework did not return a TCP port".to_string())
            })?;
            let port = port_text.parse::<u16>().map_err(|_| {
                AgentError::InvalidPort(format!("invalid MaaFramework TCP port {port_text}"))
            })?;
            client.bind(resource.clone())?;

            let launch = match host.launch(descriptor, execution_id, index, port, pi_env) {
                Ok(launch) => launch,
                Err(error) => {
                    let _ = host.stop(execution_id);
                    return Err(error);
                }
            };
            forward_output(execution_id, launch.stdout, "stdout");
            forward_output(execution_id, launch.stderr, "stderr");

            client.set_timeout(i64::try_from(descriptor.timeout_ms).unwrap_or(15_000))?;
            if let Err(error) = client.connect() {
                let _ = host.stop(execution_id);
                return Err(error.into());
            }
            clients.push(client);
        }

        if clients.is_empty() {
            let _ = host.stop(execution_id);
            return Err(AgentError::InvalidDescriptor(
                "the descriptor has no agent runtime".to_string(),
            ));
        }

        Ok(Self {
            execution_id: execution_id.to_string(),
            host,
            clients,
        })
    }

    pub fn shutdown(&self) {
        for client in &self.clients {
            let _ = client.disconnect();
        }
        let _ = self.host.stop(&self.execution_id);
    }
}

impl Drop for AgentSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub fn validate_descriptor(
    descriptor: &AgentDescriptor,
    interface_path: &Path,
) -> Result<(), AgentError> {
    if descriptor.schema_version != DESCRIPTOR_SCHEMA_VERSION {
        return Err(AgentError::InvalidDescriptor(format!(
            "unsupported schema version {}",
            descriptor.schema_version
        )));
    }
    if is_android() && descriptor.abi != "arm64-v8a" {
        return Err(AgentError::InvalidDescriptor(format!(
            "unsupported Android ABI {}",
            descriptor.abi
        )));
    }
    require_sha256(&descriptor.fingerprint, "fingerprint")?;
    require_sha256(&descriptor.pi_sha256, "PI archive hash")?;

    let bytes = std::fs::read(interface_path).map_err(|error| {
        AgentError::InvalidDescriptor(format!(
            "could not hash {}: {error}",
            interface_path.display()
        ))
    })?;
    let mut digest = Sha256::new();
    digest.update(&bytes);
    let interface_hash = hex::encode(digest.finalize());
    if !constant_eq(
        interface_hash.as_bytes(),
        descriptor.interface_sha256.as_bytes(),
    ) {
        return Err(AgentError::InterfaceMismatch);
    }

    let mut indexes = Vec::new();
    for (index, runtime) in descriptor.runtimes.iter().enumerate() {
        if runtime.interface_index != index {
            return Err(AgentError::InvalidDescriptor(format!(
                "runtime {index} declares interface index {}",
                runtime.interface_index
            )));
        }
        require_sha256(
            &runtime.bundle_sha256,
            &format!("runtime {index} bundle hash"),
        )?;
        validate_relative_path(&runtime.exec, index, "exec")?;
        if runtime.executables.is_empty() {
            return Err(AgentError::InvalidDescriptor(format!(
                "runtime {index} declares no executable files"
            )));
        }
        for executable in &runtime.executables {
            validate_relative_path(executable, index, "executables")?;
        }
        if runtime.args.is_empty() {
            return Err(AgentError::InvalidDescriptor(format!(
                "runtime {index} has an empty command"
            )));
        }
        for argument in &runtime.args {
            if argument.as_bytes().contains(&0) {
                return Err(AgentError::InvalidDescriptor(format!(
                    "runtime {index} argument contains NUL"
                )));
            }
        }
        validate_relative_path(&runtime.working_dir, index, "workingDir")?;
        if runtime.env.contains_key("LD_PRELOAD") {
            return Err(AgentError::InvalidDescriptor(format!(
                "runtime {index} may not override LD_PRELOAD"
            )));
        }
        if runtime.env.keys().any(|key| key.starts_with("PI_")) {
            return Err(AgentError::InvalidDescriptor(format!(
                "runtime {index} may not set reserved PI_* environment variables"
            )));
        }
        indexes.push(runtime.interface_index);
    }
    if indexes.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(AgentError::InvalidDescriptor(
            "runtimes are not ordered by interface index".to_string(),
        ));
    }
    Ok(())
}

pub fn match_agent_count(
    descriptor: Option<&AgentDescriptor>,
    declared_agents: usize,
) -> Result<(), AgentError> {
    let packaged = descriptor.map(|item| item.runtimes.len()).unwrap_or(0);
    if packaged != declared_agents {
        return Err(AgentError::RuntimeCountMismatch {
            declared: declared_agents,
            packaged,
        });
    }
    Ok(())
}

pub fn start_session(
    execution_id: &str,
    resource: &Resource,
    descriptor: &AgentDescriptor,
    host: Arc<dyn AgentHost>,
    pi_env: &BTreeMap<String, String>,
) -> Result<AgentSession, AgentError> {
    AgentSession::start(execution_id, resource, descriptor, host, pi_env)
}

const PI_INTERFACE_VERSION: &str = "v2.6.0";
const PI_CLIENT_NAME: &str = "TTFlow";

/// Maps the UI setting to the Project Interface locale. System follows the
/// language the project was loaded in, which the frontend derives from the OS.
pub fn resolved_locale(ui_language: UiLanguage, fallback: &str) -> String {
    match ui_language {
        UiLanguage::System => fallback.to_string(),
        UiLanguage::Zh => "zh_cn".to_string(),
        UiLanguage::En => "en_us".to_string(),
    }
}

/// Values the Project Interface v2.5.0 convention asks the Client to inject into
/// the agent child process. The controller and resource are single-line JSON with
/// their i18n-resolved labels, matching what the GUI currently shows.
pub fn pi_environment(
    resolved: &ResolvedRun,
    client_language: &str,
    project_version: Option<&str>,
    translations: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut environment = BTreeMap::new();
    environment.insert(
        "PI_INTERFACE_VERSION".to_string(),
        PI_INTERFACE_VERSION.to_string(),
    );
    environment.insert("PI_CLIENT_NAME".to_string(), PI_CLIENT_NAME.to_string());
    environment.insert(
        "PI_CLIENT_VERSION".to_string(),
        env!("CARGO_PKG_VERSION").to_string(),
    );
    environment.insert(
        "PI_CLIENT_LANGUAGE".to_string(),
        client_language.to_string(),
    );
    if let Some(version) = project_version {
        environment.insert("PI_VERSION".to_string(), version.to_string());
    }
    let mut controller = resolved.controller.raw.clone();
    if !controller.is_object() {
        controller = serde_json::json!({
        "name": resolved.controller.name,
        "label": resolved.controller.label,
        "type": resolved.controller.controller_type,
        });
    }
    if let Some(object) = controller.as_object_mut() {
        localize_selection_fields(object, translations);
        object.insert(
            "label".to_string(),
            serde_json::json!(resolved.controller.label),
        );
    }
    if let Ok(controller) = serde_json::to_string(&controller) {
        environment.insert("PI_CONTROLLER".to_string(), controller);
    }
    let mut resource = resolved.resource.raw.clone();
    if let Some(object) = resource.as_object_mut() {
        localize_selection_fields(object, translations);
        object.insert(
            "label".to_string(),
            serde_json::json!(resolved.resource.label),
        );
        if let Some(description) = &resolved.resource.description {
            object.insert("description".to_string(), serde_json::json!(description));
        } else {
            if object
                .get("description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.starts_with('$'))
            {
                object.remove("description");
            }
        }
    }
    if let Ok(resource) = serde_json::to_string(&resource) {
        environment.insert("PI_RESOURCE".to_string(), resource);
    }
    environment
}

/// The framework version is only known after the dynamic library has been
/// loaded, so the runtime injects it immediately before launching an agent.
pub fn set_maa_framework_version(environment: &mut BTreeMap<String, String>, version: &str) {
    environment.insert("PI_CLIENT_MAAFW_VERSION".to_string(), version.to_string());
}

fn localize_selection_fields(
    object: &mut serde_json::Map<String, Value>,
    translations: &BTreeMap<String, String>,
) {
    for field in ["label", "description", "icon"] {
        let Some(value) = object.get(field).and_then(Value::as_str) else {
            continue;
        };
        let Some(key) = value.strip_prefix('$') else {
            continue;
        };
        if let Some(text) = translations.get(key) {
            object.insert(field.to_string(), Value::String(text.clone()));
        }
    }
}

pub fn prepare_android(
    interface_path: &Path,
    declared_agents: usize,
) -> Result<Option<PreparedAgent>, AgentError> {
    if declared_agents == 0 {
        return Ok(None);
    }

    let descriptor = load_android_descriptor()?;
    validate_descriptor(&descriptor, interface_path)?;
    match_agent_count(Some(&descriptor), declared_agents)?;
    if descriptor.runtimes.is_empty() {
        return Ok(None);
    }

    let host = android_host()?;
    for index in 0..descriptor.runtimes.len() {
        host.prepare(&descriptor, index)?;
    }
    Ok(Some(PreparedAgent { descriptor, host }))
}

#[cfg(target_os = "android")]
pub fn android_host() -> Result<Arc<dyn AgentHost>, AgentError> {
    Ok(Arc::new(android::AndroidAgentHost))
}

#[cfg(not(target_os = "android"))]
pub fn android_host() -> Result<Arc<dyn AgentHost>, AgentError> {
    Err(AgentError::Host(
        "the Android agent host is unavailable on this platform".to_string(),
    ))
}

#[cfg(target_os = "android")]
mod android {
    use super::{AgentDescriptor, AgentError, AgentHost, LaunchedAgent};
    use jni::objects::JValue;
    use std::collections::BTreeMap;
    use std::fs::File;
    use std::os::fd::FromRawFd;

    pub struct AndroidAgentHost;

    impl AgentHost for AndroidAgentHost {
        fn prepare(&self, descriptor: &AgentDescriptor, index: usize) -> Result<(), AgentError> {
            super::android_bridge(|env, _bridge, service| {
                let descriptor_json = env.new_string(
                    serde_json::to_string(descriptor)
                        .map_err(|error| AgentError::InvalidDescriptor(error.to_string()))?,
                )?;
                let fingerprint = env.new_string(&descriptor.fingerprint)?;
                let pi = open_asset(env, "pi.zip")?;
                let bundle = open_asset(env, &format!("agent/runtime-{index}.zip"))?;
                env.call_method(
                    service,
                    "prepareAgentRuntime",
                    "(Ljava/lang/String;Ljava/lang/String;ILandroid/os/ParcelFileDescriptor;Landroid/os/ParcelFileDescriptor;)V",
                    &[
                        JValue::Object(&descriptor_json),
                        JValue::Object(&fingerprint),
                        JValue::Int(index as i32),
                        JValue::Object(&pi),
                        JValue::Object(&bundle),
                    ],
                )
                .map_err(jni_error)?;
                Ok(())
            })
        }

        fn launch(
            &self,
            descriptor: &AgentDescriptor,
            execution_id: &str,
            index: usize,
            port: u16,
            pi_env: &BTreeMap<String, String>,
        ) -> Result<LaunchedAgent, AgentError> {
            super::android_bridge(|env, _bridge, service| {
                let fingerprint = env.new_string(&descriptor.fingerprint)?;
                let execution = env.new_string(execution_id)?;
                let native_library_dir = env
                    .call_static_method(
                        "top/natsuu/mta/RuntimeBridge",
                        "agentNativeLibraryDir",
                        "()Ljava/lang/String;",
                        &[],
                    )
                    .and_then(|value| value.l())
                    .map_err(jni_error)?;
                let native_library_dir = jni::objects::JString::from(native_library_dir);
                let native_library_dir_text = env
                    .get_string(&native_library_dir)
                    .map_err(jni_error)?
                    .to_string_lossy()
                    .into_owned();
                let native_library_dir = env.new_string(native_library_dir_text)?;
                let pi_env_json = env.new_string(
                    serde_json::to_string(pi_env)
                        .map_err(|error| AgentError::InvalidDescriptor(error.to_string()))?,
                )?;
                let launch = env
                    .call_method(
                        service,
                        "startAgent",
                        "(Ljava/lang/String;IILjava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ltop/natsuu/mta/AgentLaunch;",
                        &[
                            JValue::Object(&fingerprint),
                            JValue::Int(index as i32),
                            JValue::Int(port as i32),
                            JValue::Object(&native_library_dir),
                            JValue::Object(&execution),
                            JValue::Object(&pi_env_json),
                        ],
                    )
                    .and_then(|value| value.l())
                    .map_err(jni_error)?;
                let stdout = parcel_file(env, &launch, "stdout")?;
                let stderr = parcel_file(env, &launch, "stderr")?;
                Ok(LaunchedAgent { stdout, stderr })
            })
        }

        fn stop(&self, execution_id: &str) -> Result<(), AgentError> {
            super::android_bridge(|env, _bridge, service| {
                let execution = env.new_string(execution_id)?;
                env.call_method(
                    service,
                    "stopAgent",
                    "(Ljava/lang/String;)V",
                    &[JValue::Object(&execution)],
                )
                .map_err(jni_error)?;
                Ok(())
            })
        }
    }

    fn open_asset<'local>(
        env: &mut jni::JNIEnv<'local>,
        name: &str,
    ) -> Result<jni::objects::JObject<'local>, AgentError> {
        let name = env.new_string(name)?;
        env.call_static_method(
            "top/natsuu/mta/RuntimeBridge",
            "openAgentAsset",
            "(Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;",
            &[JValue::Object(&name)],
        )
        .and_then(|value| value.l())
        .map_err(jni_error)
    }

    fn parcel_file(
        env: &mut jni::JNIEnv<'_>,
        object: &jni::objects::JObject<'_>,
        name: &str,
    ) -> Result<File, AgentError> {
        let descriptor = env
            .get_field(object, name, "Landroid/os/ParcelFileDescriptor;")
            .and_then(|value| value.l())
            .map_err(jni_error)?;
        let fd = env
            .call_method(&descriptor, "detachFd", "()I", &[])
            .and_then(|value| value.i())
            .map_err(jni_error)?;
        if fd < 0 {
            return Err(AgentError::Host(
                "agent returned an invalid stream".to_string(),
            ));
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    pub(super) fn jni_error(error: jni::errors::Error) -> AgentError {
        AgentError::Host(error.to_string())
    }
}

#[cfg(target_os = "android")]
fn android_bridge<T>(
    operation: impl for<'local> FnOnce(
        &mut jni::JNIEnv<'local>,
        &jni::objects::JObject<'local>,
        &jni::objects::JObject<'local>,
    ) -> Result<T, AgentError>,
) -> Result<T, AgentError> {
    let vm = crate::runtime::java_vm()
        .ok_or_else(|| AgentError::Host("the Java runtime has not been initialized".to_string()))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AgentError::Host(error.to_string()))?;
    let _ = env.exception_clear();
    let bridge = env
        .call_static_method(
            "top/natsuu/mta/RuntimeBridge",
            "agentBridgeContext",
            "()Ljava/lang/Object;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|error| AgentError::Host(error.to_string()))?;
    if bridge.is_null() {
        return Err(AgentError::Host(
            "the agent bridge context is missing".to_string(),
        ));
    }
    let service = env
        .call_static_method(
            "top/natsuu/mta/control/ControlHost",
            "current",
            "()Ltop/natsuu/mta/IMaaTauriAndroidControlService;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|error| AgentError::Host(error.to_string()))?;
    if service.is_null() {
        return Err(AgentError::Host(
            "the privileged control service is disconnected".to_string(),
        ));
    }
    operation(&mut env, &bridge, &service)
}

pub fn load_android_descriptor() -> Result<AgentDescriptor, AgentError> {
    #[cfg(target_os = "android")]
    {
        android_bridge(|env, _bridge, _service| {
            let descriptor = env
                .call_static_method(
                    "top/natsuu/mta/RuntimeBridge",
                    "agentDescriptor",
                    "()Ljava/lang/String;",
                    &[],
                )
                .and_then(|value| value.l())
                .map_err(android::jni_error)?;
            let fingerprint = env
                .call_static_method(
                    "top/natsuu/mta/RuntimeBridge",
                    "agentFingerprint",
                    "()Ljava/lang/String;",
                    &[],
                )
                .and_then(|value| value.l())
                .map_err(android::jni_error)?;
            if descriptor.is_null() || fingerprint.is_null() {
                return Err(AgentError::InvalidDescriptor(
                    "this build contains no agent descriptor".to_string(),
                ));
            }
            let descriptor = jni::objects::JString::from(descriptor);
            let fingerprint = jni::objects::JString::from(fingerprint);
            let descriptor = env.get_string(&descriptor).map_err(android::jni_error)?;
            let fingerprint = env.get_string(&fingerprint).map_err(android::jni_error)?;
            let mut descriptor: AgentDescriptor =
                serde_json::from_str(&descriptor.to_string_lossy())
                    .map_err(|error| AgentError::InvalidDescriptor(error.to_string()))?;
            descriptor.fingerprint = fingerprint.to_string_lossy().into_owned();
            Ok(descriptor)
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = ();
        Err(AgentError::InvalidDescriptor(
            "this build contains no Android agent descriptor".to_string(),
        ))
    }
}

fn forward_output(execution_id: &str, file: File, stream: &'static str) {
    let execution_id = execution_id.to_string();
    thread::Builder::new()
        .name(format!("agent-{stream}"))
        .spawn(move || {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if let Some(logger) = crate::run_log::latest_global() {
                    if logger.execution_id() == execution_id {
                        let _ = logger.append(
                            RunEventKind::Task,
                            RunState::Running,
                            line,
                            None,
                            Some(serde_json::json!({ "stream": stream, "source": "python-agent" })),
                        );
                    }
                }
            }
        })
        .ok();
}

fn validate_relative_path(value: &str, index: usize, field: &str) -> Result<(), AgentError> {
    if value.is_empty()
        || Path::new(value).is_absolute()
        || value.split(['/', '\\']).any(|part| part == "..")
        || value.contains('\0')
    {
        return Err(AgentError::InvalidDescriptor(format!(
            "runtime {index} {field} is not a safe relative path"
        )));
    }
    Ok(())
}

fn require_sha256(value: &str, label: &str) -> Result<(), AgentError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AgentError::InvalidDescriptor(format!(
            "{label} is not a SHA-256 digest"
        )));
    }
    Ok(())
}

fn constant_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn is_android() -> bool {
    cfg!(target_os = "android")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn descriptor() -> AgentDescriptor {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "abi": "arm64-v8a",
            "interfaceSha256": "0".repeat(64),
            "piSha256": "c".repeat(64),
            "fingerprint": "a".repeat(64),
            "timeoutMs": 15000,
            "runtimes": [{
                "interfaceIndex": 0,
                "bundleSha256": "b".repeat(64),
                "exec": "python/bin/python3",
                "executables": ["python/bin/python3"],
                "args": ["-u", "-m", "maa.agent.agent_server", "{identifier}"],
                "workingDir": "{pi}",
                "env": {"PYTHONHOME": "{bundle}/python"}
            }]
        }))
        .unwrap()
    }

    #[test]
    fn rejects_count_mismatch() {
        let descriptor = descriptor();
        assert!(match_agent_count(None, 1).is_err());
        assert!(match_agent_count(Some(&descriptor), 2).is_err());
        assert!(match_agent_count(Some(&descriptor), 1).is_ok());
    }

    #[test]
    fn rejects_unsafe_paths() {
        let mut descriptor = descriptor();
        descriptor.runtimes[0].exec = "/bin/sh".to_string();
        let interface =
            std::env::temp_dir().join(format!("ttflow-agent-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&interface, b"{}").unwrap();
        descriptor.interface_sha256 = sha256_file(&interface);
        assert!(validate_descriptor(&descriptor, &interface).is_err());
        let _ = std::fs::remove_file(interface);
    }

    #[test]
    fn rejects_invalid_digests() {
        let mut invalid_descriptor = descriptor();
        invalid_descriptor.pi_sha256 = "z".repeat(64);
        assert!(matches!(
            validate_descriptor(&invalid_descriptor, Path::new("/does/not/matter")),
            Err(AgentError::InvalidDescriptor(_))
        ));

        let mut invalid_descriptor = descriptor();
        invalid_descriptor.runtimes[0].bundle_sha256 = "Z".repeat(64);
        assert!(matches!(
            validate_descriptor(&invalid_descriptor, Path::new("/does/not/matter")),
            Err(AgentError::InvalidDescriptor(_))
        ));
    }

    fn sha256_file(path: &Path) -> String {
        use sha2::Digest as _;
        let mut digest = Sha256::new();
        digest.update(std::fs::read(path).unwrap());
        hex::encode(digest.finalize())
    }

    #[derive(Default)]
    struct FakeHost {
        stopped: Mutex<Vec<String>>,
    }

    impl AgentHost for FakeHost {
        fn prepare(&self, _descriptor: &AgentDescriptor, _index: usize) -> Result<(), AgentError> {
            Ok(())
        }

        fn launch(
            &self,
            _descriptor: &AgentDescriptor,
            _execution_id: &str,
            _index: usize,
            _port: u16,
            _pi_env: &BTreeMap<String, String>,
        ) -> Result<LaunchedAgent, AgentError> {
            Err(AgentError::Host("not connected in unit test".to_string()))
        }

        fn stop(&self, execution_id: &str) -> Result<(), AgentError> {
            self.stopped.lock().unwrap().push(execution_id.to_string());
            Ok(())
        }
    }

    #[test]
    fn fake_host_tracks_stop_requests() {
        let host = Arc::new(FakeHost::default());
        assert!(host.stop("run").is_ok());
        assert_eq!(host.stopped.lock().unwrap().as_slice(), ["run"]);
    }

    #[test]
    fn rejects_reserved_pi_environment_keys() {
        let mut descriptor = descriptor();
        descriptor.runtimes[0]
            .env
            .insert("PI_CLIENT_NAME".to_string(), "spoofed".to_string());
        let interface =
            std::env::temp_dir().join(format!("ttflow-agent-pi-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&interface, b"{}").unwrap();
        descriptor.interface_sha256 = sha256_file(&interface);
        assert!(matches!(
            validate_descriptor(&descriptor, &interface),
            Err(AgentError::InvalidDescriptor(_))
        ));
        let _ = std::fs::remove_file(interface);
    }

    #[test]
    fn pi_environment_exposes_client_and_selection() {
        use crate::domain::types::{ControllerDefinition, ResourceDefinition};

        let resolved = crate::domain::types::ResolvedRun {
            controller: ControllerDefinition {
                name: "ADB".to_string(),
                label: "Android".to_string(),
                controller_type: "AndroidNative".to_string(),
                raw: serde_json::json!({
                    "name": "ADB",
                    "label": "$controller",
                    "type": "Adb",
                    "adb": { "serial": "emulator-5554" },
                }),
            },
            resource: ResourceDefinition {
                name: "official".to_string(),
                label: "官服".to_string(),
                description: None,
                paths: vec!["resource/base".to_string()],
                controllers: Vec::new(),
                options: Vec::new(),
                hash: None,
                raw: serde_json::json!({
                    "name": "official",
                    "label": "$resource",
                    "description": "$resource-description",
                    "path": ["resource/base"],
                    "hash": "abc123",
                }),
            },
            tasks: Vec::new(),
            base_pipeline: serde_json::Value::Null,
            pipeline_override: serde_json::Value::Null,
        };

        let environment = pi_environment(
            &resolved,
            "zh_cn",
            Some("0.1.0"),
            &BTreeMap::from([("resource-description".to_string(), "官方资源".to_string())]),
        );
        assert_eq!(environment["PI_INTERFACE_VERSION"], "v2.6.0");
        assert_eq!(environment["PI_CLIENT_NAME"], "TTFlow");
        assert_eq!(environment["PI_CLIENT_VERSION"], env!("CARGO_PKG_VERSION"));
        assert_eq!(environment["PI_CLIENT_LANGUAGE"], "zh_cn");
        assert_eq!(environment["PI_VERSION"], "0.1.0");
        set_maa_framework_version(&mut environment, "1.23.0");
        assert_eq!(environment["PI_CLIENT_MAAFW_VERSION"], "1.23.0");

        let controller: serde_json::Value =
            serde_json::from_str(&environment["PI_CONTROLLER"]).unwrap();
        assert_eq!(controller["label"], "Android");
        assert_eq!(controller["type"], "Adb");
        assert_eq!(controller["adb"]["serial"], "emulator-5554");

        let resource: serde_json::Value =
            serde_json::from_str(&environment["PI_RESOURCE"]).unwrap();
        assert_eq!(resource["name"], "official");
        assert_eq!(resource["path"], serde_json::json!(["resource/base"]));
        assert_eq!(resource["hash"], "abc123");
        assert_eq!(resource["description"], "官方资源");
    }

    #[test]
    fn resolves_ui_locale() {
        use crate::domain::types::UiLanguage;

        assert_eq!(resolved_locale(UiLanguage::System, "zh_cn"), "zh_cn");
        assert_eq!(resolved_locale(UiLanguage::En, "zh_cn"), "en_us");
    }
}

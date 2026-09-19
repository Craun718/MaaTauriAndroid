use crate::agent::AgentSession;
use crate::domain::types::ResolvedTask;
#[cfg(target_os = "android")]
use jni::objects::{GlobalRef, JClass, JString};
use maa_framework::{
    controller::Controller, resource::Resource, tasker::Tasker, AndroidNativeControllerConfig,
    AndroidScreenResolution,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("MaaFramework is unavailable: {0}")]
    LibraryNotLoaded(String),
    #[error("Android JNI bridge is unavailable: {0}")]
    JniBridge(String),
    #[error("the control unit is not connected")]
    ControlDisconnected,
    #[error("screen dimensions are unavailable")]
    ScreenSizeUnavailable,
    #[error("MaaFramework error: {0}")]
    Maa(String),
}

impl From<maa_framework::MaaError> for RuntimeError {
    fn from(value: maa_framework::MaaError) -> Self {
        Self::Maa(value.to_string())
    }
}

pub struct ActiveRun {
    pub execution_id: String,
    pub tasker: Arc<Tasker>,
    pub agent: Option<Arc<AgentSession>>,
}

pub struct MaaSessions {
    lease: Mutex<SessionLease>,
    pending_stop: Mutex<Option<String>>,
    stop_requested: AtomicBool,
}

static MAA_LIBRARY: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();

enum SessionLease {
    Idle,
    Preparing(String),
    Active(ActiveRun),
}

impl Default for MaaSessions {
    fn default() -> Self {
        Self {
            lease: Mutex::new(SessionLease::Idle),
            pending_stop: Mutex::new(None),
            stop_requested: AtomicBool::new(false),
        }
    }
}

impl MaaSessions {
    pub fn begin_preparing(&self, execution_id: &str) -> Result<bool, RuntimeError> {
        let mut lease = self.lease.lock().expect("Maa run lock poisoned");
        match &*lease {
            SessionLease::Preparing(existing) if existing == execution_id => {
                return Err(RuntimeError::Maa(
                    "the run is already preparing".to_string(),
                ));
            }
            SessionLease::Preparing(_) => {
                return Err(RuntimeError::Maa("another run is preparing".to_string()));
            }
            SessionLease::Active(run) => {
                if run.tasker.is_running() || run.tasker.stopping() {
                    return Err(RuntimeError::Maa("a run is already active".to_string()));
                }
            }
            SessionLease::Idle => {}
        }
        *lease = SessionLease::Preparing(execution_id.to_string());
        let stop_requested = self
            .pending_stop
            .lock()
            .expect("pending stop lock poisoned")
            .as_deref()
            == Some(execution_id);
        Ok(stop_requested)
    }

    pub fn request_stop(&self, execution_id: Option<&str>) -> Result<bool, RuntimeError> {
        {
            let lease = self.lease.lock().expect("Maa run lock poisoned");
            let lease_id = lease_id(&*lease);
            if let Some(requested) = execution_id {
                if lease_id.is_some_and(|current| current != requested) {
                    return Err(RuntimeError::Maa(
                        "execution id does not match the active run".to_string(),
                    ));
                }
            }
            let Some(target) = execution_id.or(lease_id) else {
                return Ok(false);
            };
            *self
                .pending_stop
                .lock()
                .expect("pending stop lock poisoned") = Some(target.to_string());
        }
        let active = matches!(
            &*self.lease.lock().expect("Maa run lock poisoned"),
            SessionLease::Active(_)
        );
        if !active {
            return Ok(true);
        }
        self.post_stop()
    }

    pub fn begin(
        &self,
        execution_id: &str,
        tasker: Tasker,
        agent: Option<AgentSession>,
    ) -> Result<Arc<Tasker>, RuntimeError> {
        let mut lease = self.lease.lock().expect("Maa run lock poisoned");
        if let SessionLease::Active(run) = &*lease {
            if run.tasker.is_running() || run.tasker.stopping() {
                return Err(RuntimeError::Maa("a run is already active".to_string()));
            }
        }
        let stop_requested = self
            .pending_stop
            .lock()
            .expect("pending stop lock poisoned")
            .as_deref()
            == Some(execution_id);
        self.stop_requested.store(stop_requested, Ordering::SeqCst);
        let tasker = Arc::new(tasker);
        let agent = agent.map(Arc::new);
        *lease = SessionLease::Active(ActiveRun {
            execution_id: execution_id.to_string(),
            tasker: tasker.clone(),
            agent,
        });
        if stop_requested {
            tasker.post_stop()?;
        }
        Ok(tasker)
    }

    pub fn finish(&self, execution_id: &str) {
        let mut lease = self.lease.lock().expect("Maa run lock poisoned");
        if lease_id(&*lease) == Some(execution_id) {
            if let SessionLease::Active(run) = &*lease {
                if let Some(agent) = &run.agent {
                    agent.shutdown();
                }
            }
            *lease = SessionLease::Idle;
        }
        let mut pending = self
            .pending_stop
            .lock()
            .expect("pending stop lock poisoned");
        if pending.as_deref() == Some(execution_id) {
            *pending = None;
        }
    }

    pub fn status(&self) -> RunState {
        let lease = self.lease.lock().expect("Maa run lock poisoned");
        match &*lease {
            SessionLease::Active(run) if run.tasker.stopping() => RunState::Stopping,
            SessionLease::Active(run) if run.tasker.is_running() => RunState::Running,
            SessionLease::Preparing(_) => RunState::Preparing,
            _ => RunState::Idle,
        }
    }

    fn post_stop(&self) -> Result<bool, RuntimeError> {
        let lease = self.lease.lock().expect("Maa run lock poisoned");
        let Some(run) = (match &*lease {
            SessionLease::Active(run) => Some(run),
            _ => None,
        }) else {
            return Ok(false);
        };
        self.stop_requested.store(true, Ordering::SeqCst);
        run.tasker.post_stop()?;
        Ok(true)
    }
}

fn ensure_maa_library(path: &Path) -> Result<(), RuntimeError> {
    ensure_maa_library_with(&MAA_LIBRARY, path, maa_framework::load_library)
}

fn ensure_maa_library_with(
    state: &std::sync::OnceLock<Result<(), String>>,
    path: &Path,
    load: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), RuntimeError> {
    state.get_or_init(|| load(path)).clone().map_err(set_error)
}

fn lease_id(lease: &SessionLease) -> Option<&str> {
    match lease {
        SessionLease::Preparing(execution_id) => Some(execution_id),
        SessionLease::Active(run) => Some(&run.execution_id),
        SessionLease::Idle => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RunState {
    Idle,
    Preparing,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunResultSeverity {
    Info,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub execution_id: Option<String>,
    pub state: RunState,
    pub severity: RunResultSeverity,
    pub message: String,
}

fn set_error(message: String) -> RuntimeError {
    RuntimeError::Maa(message)
}

fn library_path() -> Result<PathBuf, RuntimeError> {
    if let Ok(path) = std::env::var("MAA_LIBRARY_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    #[cfg(target_os = "android")]
    return android_library_path("MaaFramework");

    #[cfg(not(target_os = "android"))]
    return desktop_maps_library_path();
}

#[cfg(target_os = "android")]
fn android_library_path(name: &str) -> Result<PathBuf, RuntimeError> {
    let map_error = |error: jni::errors::Error| RuntimeError::JniBridge(error.to_string());
    let vm = java_vm().ok_or_else(|| RuntimeError::JniBridge("not initialized".to_string()))?;
    let mut env = vm.attach_current_thread().map_err(map_error)?;
    let library_name = env.new_string(name).map_err(map_error)?;
    let path = env
        .call_static_method(
            runtime_bridge_class()?,
            "nativeLibraryPath",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[jni::objects::JValue::Object(&library_name)],
        )
        .and_then(|value| value.l())
        .map_err(map_error)?;
    let android_path = JString::from(path);
    let java_path = env.get_string(&android_path).map_err(map_error)?;
    let path = java_path.to_string_lossy();
    if path.is_empty() {
        return Err(RuntimeError::LibraryNotLoaded(format!(
            "the Android library path for {name} is empty"
        )));
    }
    Ok(PathBuf::from(path.into_owned()))
}

#[cfg(not(target_os = "android"))]
fn control_library_path(maa_path: &Path) -> Result<PathBuf, RuntimeError> {
    let path = maa_path
        .parent()
        .ok_or_else(|| RuntimeError::LibraryNotLoaded(maa_path.display().to_string()))?
        .join("libMaaAndroidNativeControlUnit.so");
    if path.is_file() {
        Ok(path)
    } else {
        Err(RuntimeError::LibraryNotLoaded(path.display().to_string()))
    }
}

#[cfg(target_os = "android")]
fn control_library_path(_maa_path: &Path) -> Result<PathBuf, RuntimeError> {
    android_library_path("MaaAndroidNativeControlUnit")
}

#[cfg(not(target_os = "android"))]
fn desktop_maps_library_path() -> Result<PathBuf, RuntimeError> {
    let maps = std::fs::read_to_string("/proc/self/maps")
        .map_err(|error| RuntimeError::LibraryNotLoaded(error.to_string()))?;
    maps.lines()
        .rev()
        .find_map(|line| {
            let path = line.split_whitespace().next_back()?;
            Path::new(path)
                .ends_with("libMaaFramework.so")
                .then(|| PathBuf::from(path))
        })
        .ok_or_else(|| {
            RuntimeError::LibraryNotLoaded(
                "libMaaFramework.so was not found in /proc/self/maps".to_string(),
            )
        })
}

fn resource_path(project_root: &str, relative: &str) -> PathBuf {
    let root = PathBuf::from(project_root);
    let path = PathBuf::from(relative);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

pub fn android_controller_config(
    display_id: u32,
    force_stop: bool,
) -> Result<AndroidNativeControllerConfig, RuntimeError> {
    let (width, height) = screen_size().ok_or(RuntimeError::ScreenSizeUnavailable)?;
    let maa_library = library_path()?;
    let control_library = control_library_path(&maa_library)?;
    Ok(AndroidNativeControllerConfig {
        library_path: control_library.to_string_lossy().into_owned(),
        screen_resolution: AndroidScreenResolution { width, height },
        display_id: Some(display_id),
        force_stop: Some(force_stop),
    })
}

pub fn task_pipeline(base: &Value, task: Option<&ResolvedTask>) -> Value {
    let mut output = base.as_object().cloned().unwrap_or_else(Map::new);
    let Some(task) = task else {
        return Value::Object(output);
    };
    merge_value(&mut output, &task.task.pipeline_override);
    merge_value(&mut output, &task.pipeline_override);
    Value::Object(output)
}

fn merge_value(target: &mut Map<String, Value>, source: &Value) {
    let Some(source) = source.as_object() else {
        return;
    };
    for (key, value) in source {
        match (target.get_mut(key), value) {
            (Some(Value::Object(existing)), Value::Object(next)) => {
                merge_value(existing, &Value::Object(next.clone()));
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        };
    }
}

fn screen_size() -> Option<(i32, i32)> {
    let packed = SCREEN_SIZE.load(Ordering::SeqCst);
    if packed == 0 {
        return None;
    }
    let width = (packed & 0xffff_ffff) as u32 as i32;
    let height = ((packed >> 32) & 0xffff_ffff) as u32 as i32;
    (width > 0 && height > 0).then_some((width, height))
}

static SCREEN_SIZE: AtomicI64 = AtomicI64::new(0);
static ACTIVE_DISPLAY_ID: AtomicI32 = AtomicI32::new(0);
static CONTROL_STATE: AtomicI64 = AtomicI64::new(0);
static CONTROL_MESSAGE: Mutex<Option<String>> = Mutex::new(None);
static RUN_RESULT: Mutex<Option<RunResult>> = Mutex::new(None);

#[cfg(any(target_os = "android", test))]
pub fn configure_screen(width: i32, height: i32) {
    if width <= 0 || height <= 0 {
        return;
    }
    let packed = (height as i64) << 32 | (width as i64 & 0xffff_ffff);
    SCREEN_SIZE.store(packed, Ordering::SeqCst);
}

pub fn set_active_display(display_id: i32) {
    if display_id < 0 {
        return;
    }
    ACTIVE_DISPLAY_ID.store(display_id, Ordering::SeqCst);
}

pub fn active_display_id() -> u32 {
    ACTIVE_DISPLAY_ID.load(Ordering::SeqCst).max(0) as u32
}

#[cfg(target_os = "android")]
pub fn set_control_state(state: i64, message: String) {
    CONTROL_STATE.store(state, Ordering::SeqCst);
    *CONTROL_MESSAGE
        .lock()
        .expect("control status lock poisoned") = Some(message);
}

pub fn control_state() -> (i64, String) {
    let message = CONTROL_MESSAGE
        .lock()
        .expect("control status lock poisoned")
        .clone()
        .unwrap_or_else(|| "The privileged control unit is starting".to_string());
    (CONTROL_STATE.load(Ordering::SeqCst), message)
}

pub fn clear_run_result() {
    *RUN_RESULT.lock().expect("run result lock poisoned") = None;
}

pub fn set_execution_result(
    execution_id: Option<&str>,
    state: RunState,
    severity: RunResultSeverity,
    message: String,
) {
    *RUN_RESULT.lock().expect("run result lock poisoned") = Some(RunResult {
        execution_id: execution_id.map(str::to_string),
        state,
        severity,
        message,
    });
}

#[cfg(target_os = "android")]
pub fn initialize_secret_bridge(
    env: &mut jni::JNIEnv,
    runtime_bridge_class: &JClass,
) -> Result<(), crate::secrets::SecretError> {
    if let Err(error) = initialize_jni_bridge(env, runtime_bridge_class) {
        return Err(crate::secrets::SecretError::Jni(error.to_string()));
    }
    crate::secrets::android::initialize(env)
}

#[cfg(target_os = "android")]
fn initialize_jni_bridge(
    env: &mut jni::JNIEnv,
    runtime_bridge_class: &JClass,
) -> Result<(), RuntimeError> {
    let map_error = |error: jni::errors::Error| RuntimeError::JniBridge(error.to_string());
    let vm = env.get_java_vm().map_err(map_error)?;
    let runtime_bridge_class = env
        .new_global_ref(runtime_bridge_class)
        .map_err(map_error)?;
    let control_host_class = env
        .find_class("top/natsuu/mta/control/ControlHost")
        .map_err(map_error)?;
    let control_host_class = env.new_global_ref(control_host_class).map_err(map_error)?;
    if ANDROID_JNI.get().is_some() {
        return Ok(());
    }
    if ANDROID_JNI
        .set(AndroidJni {
            vm,
            runtime_bridge_class,
            control_host_class,
        })
        .is_err()
    {
        return Ok(());
    }
    Ok(())
}

#[cfg(target_os = "android")]
pub fn java_vm() -> Option<&'static jni::JavaVM> {
    ANDROID_JNI.get().map(|jni| &jni.vm)
}

#[cfg(target_os = "android")]
pub fn runtime_bridge_class() -> Result<&'static GlobalRef, RuntimeError> {
    ANDROID_JNI
        .get()
        .map(|jni| &jni.runtime_bridge_class)
        .ok_or_else(|| RuntimeError::JniBridge("not initialized".to_string()))
}

#[cfg(target_os = "android")]
pub fn control_host_class() -> Result<&'static GlobalRef, RuntimeError> {
    ANDROID_JNI
        .get()
        .map(|jni| &jni.control_host_class)
        .ok_or_else(|| RuntimeError::JniBridge("not initialized".to_string()))
}

#[cfg(target_os = "android")]
pub fn ensure_control_service(timeout_ms: u64) -> Result<bool, RuntimeError> {
    let vm = java_vm().ok_or_else(|| RuntimeError::JniBridge("not initialized".to_string()))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| RuntimeError::JniBridge(error.to_string()))?;
    let connected = env
        .call_static_method(
            runtime_bridge_class()?,
            "connectPrivilegedService",
            "(J)Z",
            &[jni::objects::JValue::Long(timeout_ms as jni::sys::jlong)],
        )
        .and_then(|value| value.z())
        .map_err(|error| RuntimeError::JniBridge(error.to_string()))?;
    Ok(connected)
}

#[cfg(target_os = "android")]
struct AndroidJni {
    vm: jni::JavaVM,
    runtime_bridge_class: GlobalRef,
    control_host_class: GlobalRef,
}

#[cfg(target_os = "android")]
static ANDROID_JNI: std::sync::OnceLock<AndroidJni> = std::sync::OnceLock::new();

static MAA_LOG_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Directory MaaFramework writes `maa.log` into; configured from the Tauri
/// setup so the standalone log export knows where to collect it.
pub fn set_maa_log_dir(path: PathBuf) {
    let _ = MAA_LOG_DIR.set(path);
}

pub fn maa_log_dir() -> Option<&'static Path> {
    MAA_LOG_DIR.get().map(PathBuf::as_path)
}

/// Points MaaFramework's file log at the app-owned directory. Best effort:
/// the framework falls back to the process working directory when this fails.
fn configure_framework_logging() {
    let Some(log_dir) = maa_log_dir() else {
        return;
    };
    if let Err(error) = maa_framework::configure_logging(&log_dir.to_string_lossy()) {
        if let Some(logger) = crate::run_log::latest_global() {
            let _ = logger.append(
                crate::run_log::RunEventKind::Warning,
                RunState::Preparing,
                format!("MaaFramework log directory could not be set: {error}"),
                None,
                None,
            );
        }
    }
}

pub fn run_result() -> Option<RunResult> {
    RUN_RESULT.lock().expect("run result lock poisoned").clone()
}

pub fn create_session(
    execution_id: &str,
    project_root: &str,
    resolved: &crate::domain::types::ResolvedRun,
    display_id: u32,
    force_stop: bool,
    agent: Option<&crate::agent::PreparedAgent>,
    pi_env: Option<&std::collections::BTreeMap<String, String>>,
) -> Result<CreatedSession, RuntimeError> {
    let maa_library = library_path()?;
    ensure_maa_library(&maa_library)?;
    configure_framework_logging();
    let mut pi_environment = pi_env.cloned().unwrap_or_default();

    let config = android_controller_config(display_id, force_stop)?;
    let controller = Controller::new_android_native(&config)?;
    let connection_id = controller.post_connection()?;
    if !controller.wait(connection_id).is_success() || !controller.connected() {
        return Err(RuntimeError::ControlDisconnected);
    }

    let resource = Resource::new()?;

    let agent_session = match agent {
        Some(prepared) if !prepared.descriptor.runtimes.is_empty() => {
            crate::agent::set_maa_framework_version(
                &mut pi_environment,
                maa_framework::maa_version(),
            );
            Some(
                crate::agent::start_session(
                    execution_id,
                    &resource,
                    &prepared.descriptor,
                    prepared.host.clone(),
                    &pi_environment,
                )
                .map_err(|error| RuntimeError::Maa(error.to_string()))?,
            )
        }
        _ => None,
    };

    for relative in &resolved.resource.paths {
        let path = resource_path(project_root, relative);
        if !path.is_dir() {
            return Err(RuntimeError::LibraryNotLoaded(format!(
                "resource bundle does not exist: {}",
                path.display()
            )));
        }
        resource
            .post_bundle(&path.to_string_lossy())
            .map_err(RuntimeError::from)?
            .wait();
    }
    if !resource.loaded() {
        return Err(RuntimeError::Maa("resource loading failed".to_string()));
    }

    if let Some(declared_hash) = &resolved.resource.hash {
        match resource.hash() {
            Ok(actual_hash) => {
                if actual_hash != *declared_hash {
                    if let Some(logger) = crate::run_log::latest_global() {
                        let _ = logger.append(
                            crate::run_log::RunEventKind::Warning,
                            RunState::Preparing,
                            format!(
                                "resource hash does not match its declaration; the resource may be incomplete or outdated. Expected {declared_hash}, got {actual_hash}; the run will continue"
                            ),
                            None,
                            Some(serde_json::json!({
                                "expected": declared_hash,
                                "actual": actual_hash
                            })),
                        );
                    }
                }
            }
            Err(error) => {
                if let Some(logger) = crate::run_log::latest_global() {
                    let _ = logger.append(
                        crate::run_log::RunEventKind::Warning,
                        RunState::Preparing,
                        format!("resource hash could not be verified: {error}"),
                        None,
                        Some(serde_json::json!({ "expected": declared_hash })),
                    );
                }
            }
        }
    }

    for relative in attach_resource_paths(resolved) {
        let path = resource_path(project_root, &relative);
        if !path.is_dir() {
            return Err(RuntimeError::LibraryNotLoaded(format!(
                "attached resource bundle does not exist: {}",
                path.display()
            )));
        }
        resource
            .post_bundle(&path.to_string_lossy())
            .map_err(RuntimeError::from)?
            .wait();
    }
    if !resource.loaded() {
        return Err(RuntimeError::Maa(
            "attached resource loading failed".to_string(),
        ));
    }

    let tasker = Tasker::new()?;
    tasker.bind_resource(&resource)?;
    tasker.bind_controller(&controller)?;
    if !tasker.inited() {
        drop(agent_session);
        return Err(RuntimeError::Maa(
            "Maa tasker initialization failed".to_string(),
        ));
    }
    Ok(CreatedSession {
        tasker,
        agent: agent_session,
    })
}

/// `controller.attach_resource_path` extras loaded after the selected resource's
/// own paths (and after the resource hash check, matching the Project Interface).
fn attach_resource_paths(resolved: &crate::domain::types::ResolvedRun) -> Vec<String> {
    resolved
        .controller
        .raw
        .get("attach_resource_path")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub struct CreatedSession {
    pub tasker: Tasker,
    pub agent: Option<AgentSession>,
}

pub enum RunOutcome {
    Completed,
    Stopped,
    Failed { entry: String },
}

pub fn run_tasks(
    tasker: &Arc<Tasker>,
    tasks: &[ResolvedTask],
    base_pipeline: &Value,
    logger: &crate::run_log::RunLogger,
) -> Result<RunOutcome, RuntimeError> {
    for task in tasks.iter().filter(|task| task.enabled) {
        if tasker.stopping() {
            return Ok(RunOutcome::Stopped);
        }
        logger
            .append(
                crate::run_log::RunEventKind::Task,
                RunState::Running,
                format!("Maa task {} started", task.task.entry),
                Some(task.task.name.clone()),
                None,
            )
            .map_err(|error| RuntimeError::Maa(error.to_string()))?;
        let pipeline = task_pipeline(base_pipeline, Some(task));
        let job = tasker
            .post_task(&task.task.entry, &pipeline.to_string())
            .map_err(RuntimeError::from)
            .expect("Maa task could not be posted");
        let status = job.wait();
        if status.is_success() {
            continue;
        }
        if tasker.stopping() {
            return Ok(RunOutcome::Stopped);
        }
        let entry = task.task.entry.clone();
        logger
            .append(
                crate::run_log::RunEventKind::Failure,
                RunState::Running,
                format!("Maa task {entry} failed: {status}"),
                Some(task.task.name.clone()),
                None,
            )
            .map_err(|error| RuntimeError::Maa(error.to_string()))?;
        return Ok(RunOutcome::Failed { entry });
    }
    Ok(RunOutcome::Completed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{
        ConfiguredTask, ControllerDefinition, ResolvedRun, ResolvedTask, ResourceDefinition,
        TaskDefinition,
    };
    use std::collections::BTreeMap;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn task_pipeline_overrides_are_scoped_to_task() {
        let task = ResolvedTask {
            task: TaskDefinition {
                name: "Task".to_string(),
                label: "Task".to_string(),
                entry: "Entry".to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: Vec::new(),
                pipeline_override: serde_json::json!({"Task": {"next": ["A"]}}),
                default_check: true,
                icon: None,
            },
            configured: None,
            enabled: true,
            unavailable_reason: None,
            pipeline_override: serde_json::json!({"Task": {"timeout": 1000}}),
        };

        let pipeline = task_pipeline(
            &serde_json::json!({"Task": {"timeout": 5000}, "Global": true}),
            Some(&task),
        );
        assert_eq!(
            pipeline,
            serde_json::json!({"Task": {"timeout": 1000, "next": ["A"]}, "Global": true})
        );
    }

    #[test]
    fn maa_library_initialization_is_cached() {
        let state = std::sync::OnceLock::new();
        let load_count = std::sync::Arc::new(AtomicUsize::new(0));
        let loader_count = load_count.clone();

        ensure_maa_library_with(&state, Path::new("maa"), move |_path| {
            loader_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .expect("first load should succeed");
        ensure_maa_library_with(&state, Path::new("maa"), |_path| {
            panic!("a cached library must not be loaded again");
        })
        .expect("the cached load should succeed");

        assert_eq!(load_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn maa_library_failure_is_cached() {
        let state = std::sync::OnceLock::new();

        let first = ensure_maa_library_with(&state, Path::new("maa"), |_path| {
            Err("load failed".to_string())
        });
        let second = ensure_maa_library_with(&state, Path::new("maa"), |_path| {
            panic!("a cached failure must not be loaded again");
        });

        assert!(matches!(first, Err(RuntimeError::Maa(message)) if message == "load failed"));
        assert!(matches!(second, Err(RuntimeError::Maa(message)) if message == "load failed"));
    }

    #[test]
    fn configure_screen_stores_a_valid_size() {
        configure_screen(1080, 2400);
        assert!(screen_size().is_some());
        configure_screen(1080, 2400);
        assert_eq!(screen_size(), Some((1080, 2400)));
    }

    #[test]
    fn active_display_id_rejects_negative_values() {
        set_active_display(17);
        assert_eq!(active_display_id(), 17);
        set_active_display(-1);
        assert_eq!(active_display_id(), 17);
        set_active_display(0);
        assert_eq!(active_display_id(), 0);
    }

    #[test]
    fn execution_results_expose_restoration_severity() {
        clear_run_result();
        set_execution_result(
            Some("run-1"),
            RunState::Idle,
            RunResultSeverity::Error,
            "the control unit is not connected".to_string(),
        );
        let failure = run_result().expect("failure result");
        assert_eq!(failure.severity, RunResultSeverity::Error);
        assert_eq!(
            serde_json::to_value(&failure).unwrap()["severity"],
            serde_json::json!("error")
        );

        clear_run_result();
        set_execution_result(
            Some("run-1"),
            RunState::Idle,
            RunResultSeverity::Info,
            "The run completed".to_string(),
        );
        let completed = run_result().expect("completed result");
        assert_eq!(completed.severity, RunResultSeverity::Info);
        assert_eq!(
            serde_json::to_value(&completed).unwrap()["severity"],
            serde_json::json!("info")
        );
        clear_run_result();
    }

    #[test]
    fn attach_resource_paths_come_from_the_controller() {
        let resolved = ResolvedRun {
            controller: ControllerDefinition {
                name: "ADB".to_string(),
                label: "Android".to_string(),
                controller_type: "AndroidNative".to_string(),
                raw: serde_json::json!({
                    "attach_resource_path": ["resource/extra", "resource/shared"]
                }),
            },
            resource: ResourceDefinition {
                name: "base".to_string(),
                label: "Base".to_string(),
                description: None,
                paths: vec!["resource/base".to_string()],
                controllers: Vec::new(),
                options: Vec::new(),
                hash: None,
                raw: serde_json::Value::Null,
            },
            tasks: Vec::new(),
            base_pipeline: serde_json::Value::Null,
            pipeline_override: serde_json::Value::Null,
        };

        assert_eq!(
            attach_resource_paths(&resolved),
            vec!["resource/extra".to_string(), "resource/shared".to_string()]
        );
    }

    #[test]
    fn preparing_lease_rejects_a_second_start() {
        let sessions = MaaSessions::default();
        assert_eq!(sessions.status(), RunState::Idle);
        assert!(!sessions.begin_preparing("run-1").unwrap());
        assert_eq!(sessions.status(), RunState::Preparing);
        assert!(sessions
            .begin_preparing("run-2")
            .unwrap_err()
            .to_string()
            .contains("another run is preparing"));
        sessions.finish("run-1");
        assert_eq!(sessions.status(), RunState::Idle);
    }

    #[test]
    fn pending_stop_is_scoped_to_execution_id() {
        let sessions = MaaSessions::default();
        assert!(sessions.request_stop(Some("run-1")).unwrap());
        assert!(sessions.begin_preparing("run-1").is_ok());
        sessions.finish("run-1");
        assert!(sessions.begin_preparing("run-1").is_ok());
        assert!(sessions.request_stop(Some("run-2")).is_err());
        assert_eq!(sessions.status(), RunState::Preparing);
    }

    #[test]
    fn task_definitions_remain_cloneable_for_runtime_queue() {
        let task = ConfiguredTask {
            instance_id: "test".to_string(),
            task_name: "Task".to_string(),
            enabled: true,
            option_values: BTreeMap::new(),
            custom_label: None,
        };
        let _clone = task.clone();
        let _controller = ControllerDefinition {
            name: "controller".to_string(),
            label: "Controller".to_string(),
            controller_type: "AndroidNative".to_string(),
            raw: serde_json::Value::Null,
        };
        let _resource = ResourceDefinition {
            name: "resource".to_string(),
            label: "Resource".to_string(),
            description: None,
            paths: Vec::new(),
            controllers: Vec::new(),
            options: Vec::new(),
            hash: None,
            raw: serde_json::Value::Null,
        };
    }
}

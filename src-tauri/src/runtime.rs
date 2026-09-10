use crate::agent::AgentSession;
use crate::domain::types::ResolvedTask;
use maa_framework::{
    controller::Controller, resource::Resource, tasker::Tasker, AndroidNativeControllerConfig,
    AndroidScreenResolution,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("MaaFramework is unavailable: {0}")]
    LibraryNotLoaded(String),
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub execution_id: Option<String>,
    pub state: RunState,
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
static CONTROL_STATE: AtomicI64 = AtomicI64::new(0);
static CONTROL_MESSAGE: Mutex<Option<String>> = Mutex::new(None);
static RUN_RESULT: Mutex<Option<RunResult>> = Mutex::new(None);

pub fn configure_screen(width: i32, height: i32) {
    if width <= 0 || height <= 0 {
        return;
    }
    let packed = (height as i64) << 32 | (width as i64 & 0xffff_ffff);
    SCREEN_SIZE.store(packed, Ordering::SeqCst);
}

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

pub fn set_run_result(state: RunState, message: String) {
    set_execution_result(None, state, message)
}

pub fn clear_run_result() {
    *RUN_RESULT.lock().expect("run result lock poisoned") = None;
}

pub fn set_execution_result(execution_id: Option<&str>, state: RunState, message: String) {
    *RUN_RESULT.lock().expect("run result lock poisoned") = Some(RunResult {
        execution_id: execution_id.map(str::to_string),
        state,
        message,
    });
}

#[cfg(target_os = "android")]
pub fn initialize_secret_bridge(env: &mut jni::JNIEnv) -> Result<(), crate::secrets::SecretError> {
    if let Ok(vm) = env.get_java_vm() {
        let _ = DIAGNOSTIC_VM.set(vm);
    }
    crate::secrets::android::initialize(env)
}

#[cfg(target_os = "android")]
pub fn java_vm() -> Option<&'static jni::JavaVM> {
    DIAGNOSTIC_VM.get()
}

#[cfg(target_os = "android")]
static DIAGNOSTIC_VM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();

pub fn run_result() -> Option<RunResult> {
    RUN_RESULT.lock().expect("run result lock poisoned").clone()
}

pub fn create_session(
    execution_id: &str,
    project_root: &str,
    resource_paths: &[String],
    display_id: u32,
    force_stop: bool,
    agent: Option<&crate::agent::PreparedAgent>,
) -> Result<CreatedSession, RuntimeError> {
    let maa_library = library_path()?;
    maa_framework::load_library(&maa_library).map_err(set_error)?;

    let config = android_controller_config(display_id, force_stop)?;
    let controller = Controller::new_android_native(&config)?;
    if !controller.connected() {
        return Err(RuntimeError::ControlDisconnected);
    }

    let resource = Resource::new()?;

    let agent_session = match agent {
        Some(prepared) if !prepared.descriptor.runtimes.is_empty() => Some(
            crate::agent::start_session(
                execution_id,
                &resource,
                &prepared.descriptor,
                prepared.host.clone(),
            )
            .map_err(|error| RuntimeError::Maa(error.to_string()))?,
        ),
        _ => None,
    };

    for relative in resource_paths {
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
        ConfiguredTask, ControllerDefinition, ResolvedTask, ResourceDefinition, TaskDefinition,
    };
    use std::collections::BTreeMap;

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
    fn configure_screen_stores_a_valid_size() {
        configure_screen(1080, 2400);
        assert!(screen_size().is_some());
        configure_screen(1080, 2400);
        assert_eq!(screen_size(), Some((1080, 2400)));
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

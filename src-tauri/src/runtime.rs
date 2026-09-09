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
    pub tasker: Arc<Tasker>,
}

pub struct MaaSessions {
    active: Mutex<Option<ActiveRun>>,
    stop_requested: AtomicBool,
}

impl Default for MaaSessions {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            stop_requested: AtomicBool::new(false),
        }
    }
}

impl MaaSessions {
    pub fn begin(&self, tasker: Tasker) -> Result<Arc<Tasker>, RuntimeError> {
        let mut active = self.active.lock().expect("Maa run lock poisoned");
        if let Some(run) = active.as_ref() {
            if run.tasker.is_running() || run.tasker.stopping() {
                return Err(RuntimeError::Maa("a run is already active".to_string()));
            }
        }
        self.stop_requested.store(false, Ordering::SeqCst);
        let tasker = Arc::new(tasker);
        *active = Some(ActiveRun {
            tasker: tasker.clone(),
        });
        Ok(tasker)
    }

    pub fn finish(&self, tasker: &Tasker) {
        let mut active = self.active.lock().expect("Maa run lock poisoned");
        let _ = tasker;
        *active = None;
    }

    pub fn status(&self) -> RunState {
        let active = self.active.lock().expect("Maa run lock poisoned");
        match active.as_ref() {
            Some(run) if run.tasker.stopping() => RunState::Stopping,
            Some(run) if run.tasker.is_running() => RunState::Running,
            Some(_) => RunState::Idle,
            None => RunState::Idle,
        }
    }

    pub fn request_stop(&self) -> Result<bool, RuntimeError> {
        let active = self.active.lock().expect("Maa run lock poisoned");
        let Some(run) = active.as_ref() else {
            return Ok(false);
        };
        if !run.tasker.is_running() {
            return Ok(false);
        }
        self.stop_requested.store(true, Ordering::SeqCst);
        run.tasker.post_stop()?;
        Ok(true)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum RunState {
    Idle,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
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
    *RUN_RESULT.lock().expect("run result lock poisoned") = Some(RunResult { state, message });
}

#[cfg(target_os = "android")]
pub fn initialize_secret_bridge(env: &mut jni::JNIEnv) -> Result<(), crate::secrets::SecretError> {
    crate::secrets::android::initialize(env)
}

pub fn run_result() -> Option<RunResult> {
    RUN_RESULT.lock().expect("run result lock poisoned").clone()
}

pub fn create_session(
    project_root: &str,
    resource_paths: &[String],
    display_id: u32,
    force_stop: bool,
) -> Result<Tasker, RuntimeError> {
    let maa_library = library_path()?;
    maa_framework::load_library(&maa_library).map_err(set_error)?;

    let config = android_controller_config(display_id, force_stop)?;
    let controller = Controller::new_android_native(&config)?;
    if !controller.connected() {
        return Err(RuntimeError::ControlDisconnected);
    }

    let resource = Resource::new()?;
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
        return Err(RuntimeError::Maa(
            "Maa tasker initialization failed".to_string(),
        ));
    }
    Ok(tasker)
}

pub fn run_tasks(tasker: &Arc<Tasker>, tasks: &[ResolvedTask], base_pipeline: &Value) {
    for task in tasks.iter().filter(|task| task.enabled) {
        if tasker.stopping() {
            return;
        }
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
            set_run_result(RunState::Stopping, "The run was stopped".to_string());
            return;
        }
        set_run_result(
            RunState::Idle,
            format!("Maa task {} failed: {status}", task.task.entry),
        );
        return;
    }
    set_run_result(RunState::Idle, "The run completed".to_string());
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

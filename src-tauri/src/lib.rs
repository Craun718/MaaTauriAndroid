mod domain;
mod persistence;
mod runtime;
mod secrets;

use domain::loader::ProjectLoader;
use domain::resolver::{resolve_run, ResolverError};
use domain::types::{ConfiguredTask, Project, RunConfiguration, UserConfiguration};
use persistence::{PersistenceError, UserConfigurationStore};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStateSnapshot {
    project: Option<Project>,
    configuration: UserConfiguration,
    project_path: Option<String>,
}

#[derive(Default)]
struct AppState {
    project: RwLock<Option<Project>>,
    configuration: RwLock<UserConfiguration>,
    project_path: RwLock<Option<PathBuf>>,
    store: RwLock<Option<UserConfigurationStore>>,
    maa: Arc<runtime::MaaSessions>,
}

impl AppState {
    fn project(&self) -> Result<Project, AppError> {
        self.project
            .read()
            .expect("project lock poisoned")
            .clone()
            .ok_or(AppError::NoProject)
    }

    fn configuration(&self) -> Result<UserConfiguration, AppError> {
        Ok(self
            .configuration
            .read()
            .expect("configuration lock poisoned")
            .clone())
    }

    fn set_project(&self, path: Option<PathBuf>, project: Project) {
        *self.project.write().expect("project lock poisoned") = Some(project);
        *self
            .project_path
            .write()
            .expect("project path lock poisoned") = path;
    }

    fn set_configuration(&self, configuration: UserConfiguration) -> Result<(), PersistenceError> {
        *self
            .configuration
            .write()
            .expect("configuration lock poisoned") = configuration;
        self.persist_configuration()
    }

    fn persist_configuration(&self) -> Result<(), PersistenceError> {
        let store = self.store.read().expect("store lock poisoned");
        match store.as_ref() {
            Some(store) => {
                let project = self.project.read().expect("project lock poisoned");
                let project = project.as_ref().ok_or_else(|| {
                    PersistenceError::Secret(crate::secrets::SecretError::BridgeUnavailable)
                })?;
                store.save(
                    project,
                    &self
                        .configuration
                        .read()
                        .expect("configuration lock poisoned"),
                )
            }
            None => Ok(()),
        }
    }

    fn install(
        &self,
        config_path: PathBuf,
        project_path: Option<PathBuf>,
        project: Project,
        mut configuration: UserConfiguration,
    ) -> Result<UserConfiguration, AppError> {
        normalize_configuration(&project, &mut configuration);
        *self.store.write().expect("store lock poisoned") =
            Some(UserConfigurationStore::new(config_path));
        self.set_project(project_path, project);
        *self
            .configuration
            .write()
            .expect("configuration lock poisoned") = configuration.clone();
        self.persist_configuration()?;
        Ok(configuration)
    }
}

fn normalize_configuration(project: &Project, configuration: &mut UserConfiguration) {
    if !project
        .controllers
        .iter()
        .any(|controller| Some(&controller.name) == configuration.active_controller.as_ref())
    {
        configuration.active_controller = project.controllers.first().map(|item| item.name.clone());
    }
    if !project
        .resources
        .iter()
        .any(|resource| Some(&resource.name) == configuration.active_resource.as_ref())
    {
        configuration.active_resource = project.resources.first().map(|item| item.name.clone());
    }

    if configuration.active_run_configuration_id.is_none()
        || !configuration
            .run_configurations
            .iter()
            .any(|run| Some(&run.id) == configuration.active_run_configuration_id.as_ref())
    {
        let default_run = default_run_configuration(project, "Default");
        configuration.active_run_configuration_id = Some(default_run.id.clone());
        configuration.run_configurations.insert(0, default_run);
    }
    configuration.initialized = true;
}

fn default_run_configuration(project: &Project, name: &str) -> RunConfiguration {
    RunConfiguration {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        tasks: project
            .tasks
            .iter()
            .map(|task| ConfiguredTask {
                instance_id: format!("{}:{}", task.name, Uuid::new_v4()),
                task_name: task.name.clone(),
                enabled: task.default_check,
                option_values: BTreeMap::new(),
                custom_label: None,
            })
            .collect(),
    }
}

fn snapshot(state: &AppState) -> AppStateSnapshot {
    AppStateSnapshot {
        project: state.project.read().expect("project lock poisoned").clone(),
        configuration: state
            .configuration
            .read()
            .expect("configuration lock poisoned")
            .clone(),
        project_path: state
            .project_path
            .read()
            .expect("project path lock poisoned")
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum PrivilegedStatus {
    Connected {
        message: String,
    },
    PermissionRequired {
        message: String,
        setup_required: Vec<String>,
    },
    NotInstalled {
        message: String,
        setup_required: Vec<String>,
    },
    Disconnected {
        message: String,
        setup_required: Vec<String>,
    },
    Error {
        message: String,
        setup_required: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartRunStatus {
    message: String,
    task_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunStatus {
    state: runtime::RunState,
    message: String,
}

#[tauri::command]
fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<AppStateSnapshot, AppError> {
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Path(error.to_string()))?
        .join("configuration.json");
    let fixture = serde_json::from_str(include_str!("../fixtures/pi/minimal/interface.json"))
        .map_err(AppError::ProjectLoad)?;
    let translations = serde_json::from_str::<BTreeMap<String, String>>(include_str!(
        "../fixtures/pi/minimal/locale/zh_cn.json"
    ))?;
    let project = ProjectLoader::default().load_embedded(fixture, translations, "zh_cn")?;
    let stored = UserConfigurationStore::new(config_path.clone()).load(&project)?;
    let configuration = state.install(config_path, None, project, stored)?;
    Ok(AppStateSnapshot {
        project: state.project().ok(),
        configuration,
        project_path: None,
    })
}

#[tauri::command]
fn load_project(
    state: State<'_, AppState>,
    path: String,
    language: Option<String>,
) -> Result<AppStateSnapshot, AppError> {
    let preferred_language = language.unwrap_or_else(|| "zh_cn".to_string());
    let project = ProjectLoader {
        preferred_language: preferred_language.clone(),
    }
    .load(&path, &preferred_language)?;
    let stored = state.configuration()?;
    let config_path = state
        .store
        .read()
        .expect("store lock poisoned")
        .as_ref()
        .map(|store| store.path().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("configuration.json"));
    let configuration = state.install(
        config_path,
        Some(PathBuf::from(path.clone())),
        project,
        stored,
    )?;
    Ok(AppStateSnapshot {
        project: state.project().ok(),
        configuration,
        project_path: Some(path),
    })
}

#[tauri::command]
fn save_configuration(
    state: State<'_, AppState>,
    configuration: UserConfiguration,
) -> Result<UserConfiguration, AppError> {
    let project = state.project()?;
    let mut configuration = configuration;
    normalize_configuration(&project, &mut configuration);
    state.set_configuration(configuration.clone())?;
    Ok(configuration)
}

#[tauri::command]
fn apply_preset(
    state: State<'_, AppState>,
    preset_name: String,
) -> Result<UserConfiguration, AppError> {
    let project = state.project()?;
    let mut configuration = state.configuration()?;
    let preset = project
        .presets
        .iter()
        .find(|preset| preset.name == preset_name)
        .cloned()
        .ok_or_else(|| AppError::Message(format!("Unknown preset: {preset_name}")))?;
    let active_run = configuration
        .active_run_configuration_id
        .clone()
        .ok_or_else(|| AppError::Message("No active run configuration".to_string()))?;
    let run = configuration
        .run_configurations
        .iter_mut()
        .find(|run| run.id == active_run)
        .ok_or_else(|| AppError::Message("Active run configuration disappeared".to_string()))?;
    run.tasks = project
        .tasks
        .iter()
        .map(|task| {
            let configured = preset.tasks.iter().find(|item| item.task_name == task.name);
            ConfiguredTask {
                instance_id: format!("{}:{}", task.name, Uuid::new_v4()),
                task_name: task.name.clone(),
                enabled: configured
                    .map(|item| item.enabled)
                    .unwrap_or(task.default_check),
                option_values: configured
                    .map(|item| item.option.clone())
                    .unwrap_or_default(),
                custom_label: configured.and_then(|item| {
                    if item.label == task.name {
                        None
                    } else {
                        Some(item.label.clone())
                    }
                }),
            }
        })
        .collect();
    state.set_configuration(configuration.clone())?;
    Ok(configuration)
}

#[tauri::command]
fn resolve_current(state: State<'_, AppState>) -> Result<serde_json::Value, AppError> {
    let project = state.project()?;
    let configuration = state.configuration()?;
    serde_json::to_value(resolve_run(&project, &configuration)?)
        .map_err(|error| AppError::Message(error.to_string()))
}

#[tauri::command]
fn privileged_status() -> Result<PrivilegedStatus, AppError> {
    let (state, message) = runtime::control_state();
    match state {
        3 => Ok(PrivilegedStatus::Connected {
            message: "The privileged control unit is connected".to_string(),
        }),
        2 => Ok(PrivilegedStatus::PermissionRequired {
            message,
            setup_required: vec!["Grant TTFlow access in Shizuku".to_string()],
        }),
        1 => Ok(PrivilegedStatus::NotInstalled {
            message,
            setup_required: vec!["Install or start Shizuku".to_string()],
        }),
        4 => Ok(PrivilegedStatus::Disconnected {
            message,
            setup_required: vec!["Restart Shizuku and reopen TTFlow".to_string()],
        }),
        5 => Ok(PrivilegedStatus::Error {
            message,
            setup_required: vec!["Check Shizuku and the Android service logs".to_string()],
        }),
        _ => Ok(PrivilegedStatus::Disconnected {
            message,
            setup_required: vec!["Wait for the control unit to connect".to_string()],
        }),
    }
}

#[tauri::command]
async fn start_run(state: State<'_, AppState>) -> Result<StartRunStatus, AppError> {
    let project = state.project()?;
    let configuration = state.configuration()?;
    let resolved = resolve_run(&project, &configuration)?;
    let tasks = resolved
        .tasks
        .iter()
        .filter(|task| task.enabled && task.unavailable_reason.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let task_count = tasks.len();
    if task_count == 0 {
        return Ok(StartRunStatus {
            message: "There are no enabled tasks to run".to_string(),
            task_count,
        });
    }

    runtime::set_run_result(
        runtime::RunState::Running,
        "The run is being prepared".to_string(),
    );
    let sessions = state.maa.clone();
    let project_root = project.root.clone();
    let resource_paths = resolved.resource.paths.clone();
    let base_pipeline = resolved.base_pipeline.clone();
    tokio::spawn(async move {
        let creation = tokio::task::spawn_blocking(move || {
            runtime::create_session(&project_root, &resource_paths, 0, false)
        })
        .await;

        match creation {
            Ok(Ok(tasker)) => {
                let tasker = match sessions.begin(tasker) {
                    Ok(tasker) => tasker,
                    Err(error) => {
                        runtime::set_run_result(runtime::RunState::Idle, error.to_string());
                        return;
                    }
                };
                let run_tasker = tasker.clone();
                let result = tokio::task::spawn_blocking(move || {
                    runtime::run_tasks(&run_tasker, &tasks, &base_pipeline)
                })
                .await;
                if let Err(error) = result {
                    runtime::set_run_result(runtime::RunState::Idle, error.to_string());
                }
                sessions.finish(&tasker);
            }
            Ok(Err(error)) => runtime::set_run_result(runtime::RunState::Idle, error.to_string()),
            Err(error) => runtime::set_run_result(runtime::RunState::Idle, error.to_string()),
        }
    });

    Ok(StartRunStatus {
        message: "The run is starting".to_string(),
        task_count,
    })
}

#[tauri::command]
fn run_status() -> Result<runtime::RunResult, AppError> {
    runtime::run_result()
        .ok_or_else(|| AppError::Message("No run has been started in this session".to_string()))
}

#[tauri::command]
fn stop_run(state: State<'_, AppState>) -> Result<String, AppError> {
    if state.maa.request_stop()? {
        Ok("The run is stopping".to_string())
    } else {
        Ok("No run is active".to_string())
    }
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("project has not been loaded")]
    NoProject,
    #[error("{0}")]
    Message(String),
    #[error("{0}")]
    ProjectLoad(#[from] serde_json::Error),
    #[error("{0}")]
    Project(#[from] domain::loader::ProjectError),
    #[error("{0}")]
    Resolver(#[from] ResolverError),
    #[error("{0}")]
    Persistence(#[from] PersistenceError),
    #[error("{0}")]
    Path(String),
    #[error("configuration is not valid JSON: {0}")]
    Serialization(String),
    #[error("{0}")]
    Runtime(#[from] runtime::RuntimeError),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_ttflow_RuntimeBridge_initializeSecretBridge(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    if let Ok(mut env) = unsafe { jni::JNIEnv::from_raw(env.cast()) } {
        if let Err(error) = runtime::initialize_secret_bridge(&mut env) {
            eprintln!("Failed to initialize the secret bridge: {error}");
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_ttflow_RuntimeBridge_configureScreen(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    width: std::os::raw::c_int,
    height: std::os::raw::c_int,
) {
    runtime::configure_screen(width, height);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_ttflow_RuntimeBridge_setControlState(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    state: std::os::raw::c_int,
) {
    let message = match state {
        1 => "Shizuku is unavailable".to_string(),
        2 => "Shizuku permission is required".to_string(),
        3 => "The privileged control unit is connected".to_string(),
        4 => "The privileged control unit disconnected".to_string(),
        5 => "The privileged control unit failed to start".to_string(),
        _ => "The privileged control unit is starting".to_string(),
    };
    runtime::set_control_state(state as i64, message);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            load_project,
            save_configuration,
            apply_preset,
            resolve_current,
            privileged_status,
            start_run,
            run_status,
            stop_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

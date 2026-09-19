mod agent;
mod diagnostics;
mod domain;
mod focus;
mod persistence;
mod run_log;
mod runtime;
mod secrets;
mod telemetry;

use domain::loader::ProjectLoader;
use domain::resolver::{resolve_run, ResolverError};
use domain::types::{ConfiguredTask, Project, RunConfiguration, UserConfiguration};
use persistence::{PersistenceError, UserConfigurationStore};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use uuid::Uuid;

#[cfg(target_os = "android")]
static BOOTSTRAP_PROJECT_ROOT: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
fn bootstrap_project_root() -> Option<&'static str> {
    BOOTSTRAP_PROJECT_ROOT.get().map(String::as_str)
}

#[cfg(not(target_os = "android"))]
fn bootstrap_project_root() -> Option<&'static str> {
    None
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStateSnapshot {
    project: Option<Project>,
    configuration: UserConfiguration,
    project_path: Option<String>,
}

struct AppState {
    project: RwLock<Option<Project>>,
    configuration: RwLock<UserConfiguration>,
    project_path: RwLock<Option<PathBuf>>,
    store: RwLock<Option<UserConfigurationStore>>,
    maa: Arc<runtime::MaaSessions>,
    runs_dir: RwLock<Option<PathBuf>>,
    latest_log: RwLock<Option<Arc<run_log::RunLogger>>>,
    run_storage: tokio::sync::Mutex<()>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: RwLock::new(None),
            configuration: RwLock::new(UserConfiguration::default()),
            project_path: RwLock::new(None),
            store: RwLock::new(None),
            maa: Arc::new(runtime::MaaSessions::default()),
            runs_dir: RwLock::new(None),
            latest_log: RwLock::new(None),
            run_storage: tokio::sync::Mutex::new(()),
        }
    }
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

    fn runs_dir(&self) -> Result<PathBuf, AppError> {
        self.runs_dir
            .read()
            .expect("runs directory lock poisoned")
            .clone()
            .ok_or_else(|| AppError::Message("Run storage is not initialized".to_string()))
    }

    fn set_runs_dir(&self, path: PathBuf) {
        *self.runs_dir.write().expect("runs directory lock poisoned") = Some(path);
    }

    fn set_latest_log(&self, logger: Arc<run_log::RunLogger>) {
        *self
            .latest_log
            .write()
            .expect("latest run log lock poisoned") = Some(logger);
    }

    fn clear_latest_log(&self) {
        *self
            .latest_log
            .write()
            .expect("latest run log lock poisoned") = None;
    }

    fn latest_log(&self) -> Result<Arc<run_log::RunLogger>, AppError> {
        self.latest_log
            .read()
            .expect("latest run log lock poisoned")
            .clone()
            .ok_or_else(|| AppError::Message("No run has been started in this session".to_string()))
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
        let project = self.project().expect("the project was just installed");
        configure_telemetry(&project, &configuration);
        Ok(configuration)
    }
}

/// Applies the project's telemetry declaration and the user's consent whenever a
/// project is installed or a configuration is saved.
fn configure_telemetry(project: &Project, configuration: &UserConfiguration) {
    telemetry::configure(
        project.metadata.telemetry.as_ref(),
        configuration.telemetry_enabled,
    );
    telemetry::tag_project(Some(&project.name), project.version.as_deref());
}

fn normalize_configuration(project: &Project, configuration: &mut UserConfiguration) {
    let first_install = !configuration.initialized;
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
    // Telemetry ships opted-in for the first install (Project Interface v2.9
    // recommends default-on, revocable); persisted choices always win afterwards.
    if first_install {
        configuration.telemetry_enabled = true;
    }

    let next_fingerprint = project.metadata.welcome_fingerprint.clone();
    if configuration.welcome_fingerprint.as_ref() != next_fingerprint.as_ref() {
        configuration.welcome_fingerprint = next_fingerprint;
    }
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

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum PrivilegedStatus {
    Starting {
        message: String,
        setup_required: Vec<String>,
    },
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
    execution_id: String,
    message: String,
    task_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManualScreenshot {
    execution_id: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearedDiagnostics {
    deleted_run_count: usize,
    runs_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VirtualDisplayStatus {
    active: bool,
    display_id: i32,
    width: i32,
    height: i32,
    frame_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VirtualDisplayStream {
    url: Option<String>,
}

#[tauri::command]
fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<AppStateSnapshot, AppError> {
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Path(error.to_string()))?
        .join("configuration.json");
    let bundled_root = bootstrap_project_root();
    let project = match bundled_root {
        Some(root) => {
            ProjectLoader::default().load(PathBuf::from(root).join("interface.json"), "zh_cn")?
        }
        None => {
            let fixture =
                serde_json::from_str(include_str!("../fixtures/pi/minimal/interface.json"))
                    .map_err(AppError::ProjectLoad)?;
            let translations = serde_json::from_str::<BTreeMap<String, String>>(include_str!(
                "../fixtures/pi/minimal/locale/zh_cn.json"
            ))?;
            ProjectLoader::default().load_embedded(fixture, translations, "zh_cn")?
        }
    };
    let stored = UserConfigurationStore::new(config_path.clone()).load(&project)?;
    let configuration = state.install(config_path, None, project, stored)?;
    Ok(AppStateSnapshot {
        project: state.project().ok(),
        configuration,
        project_path: bundled_root.map(str::to_string),
    })
}

#[tauri::command]
fn read_project_image(
    state: State<'_, AppState>,
    path: String,
) -> Result<tauri::ipc::Response, AppError> {
    let project = state.project()?;
    let asset = project_asset_path(Path::new(&project.root), &path)?;
    if std::fs::metadata(&asset)?.len() > MAX_PROJECT_IMAGE_BYTES as u64 {
        return Err(AppError::Message(
            "The Project Interface image exceeds the size limit".to_string(),
        ));
    }

    let bytes = std::fs::read(asset)?;
    Ok(tauri::ipc::Response::new(bytes))
}

const MAX_PROJECT_IMAGE_BYTES: usize = 16 * 1024 * 1024;

fn project_asset_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    if image_mime(relative).is_none() {
        return Err(AppError::Message(
            "Only image assets can be loaded from the Project Interface".to_string(),
        ));
    }

    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(AppError::Message(
            "Project Interface assets must use a safe relative path".to_string(),
        ));
    }

    let root = root.canonicalize()?;
    let asset = root.join(relative_path).canonicalize()?;
    if !asset.starts_with(&root) {
        return Err(AppError::Message(
            "Project Interface assets must stay inside the project".to_string(),
        ));
    }
    Ok(asset)
}

fn image_mime(path: &str) -> Option<&'static str> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

#[tauri::command]
fn load_project(
    state: State<'_, AppState>,
    path: String,
    language: Option<String>,
) -> Result<AppStateSnapshot, AppError> {
    let preferred_language = language.unwrap_or_else(|| "zh_cn".to_string());
    let project = ProjectLoader::default().load(&path, &preferred_language)?;
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
    configure_telemetry(&project, &configuration);
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
    let existing_tasks = run.tasks.clone();
    run.tasks = project
        .tasks
        .iter()
        .map(|task| {
            let configured = preset.tasks.iter().find(|item| item.task_name == task.name);
            let existing = existing_tasks
                .iter()
                .find(|item| item.task_name == task.name);
            ConfiguredTask {
                instance_id: existing
                    .map(|item| item.instance_id.clone())
                    .unwrap_or_else(|| format!("{}:{}", task.name, Uuid::new_v4())),
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
fn reset_task_parameters(state: State<'_, AppState>) -> Result<UserConfiguration, AppError> {
    let mut configuration = state.configuration()?;
    let active_run = configuration
        .active_run_configuration_id
        .clone()
        .ok_or_else(|| AppError::Message("No active run configuration".to_string()))?;
    let run = configuration
        .run_configurations
        .iter_mut()
        .find(|run| run.id == active_run)
        .ok_or_else(|| AppError::Message("Active run configuration disappeared".to_string()))?;
    for task in &mut run.tasks {
        task.option_values.clear();
    }
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
            setup_required: vec!["Grant MaaTauriAndroid access in Shizuku".to_string()],
        }),
        1 => Ok(PrivilegedStatus::NotInstalled {
            message,
            setup_required: vec!["Install or start Shizuku".to_string()],
        }),
        4 => Ok(PrivilegedStatus::Disconnected {
            message,
            setup_required: vec!["Restart Shizuku and reopen MaaTauriAndroid".to_string()],
        }),
        5 => Ok(PrivilegedStatus::Error {
            message,
            setup_required: vec!["Check Shizuku and the Android service logs".to_string()],
        }),
        _ => Ok(PrivilegedStatus::Starting {
            message,
            setup_required: vec!["Wait for the control unit to connect".to_string()],
        }),
    }
}

#[tauri::command]
fn request_privileged_access() -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        if call_runtime_bridge_boolean("requestPrivilegedAccess")? {
            Ok(())
        } else {
            Err(AppError::Message(
                "The Shizuku permission request failed, was denied, or timed out".to_string(),
            ))
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        Err(AppError::Message(
            "Privileged access can only be requested on Android".to_string(),
        ))
    }
}

#[tauri::command]
fn open_shizuku() -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        if call_runtime_bridge_boolean("openShizuku")? {
            Ok(())
        } else {
            Err(AppError::Message(
                "Shizuku is not installed or cannot be opened".to_string(),
            ))
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        Err(AppError::Message(
            "Shizuku can only be opened on Android".to_string(),
        ))
    }
}

#[tauri::command]
fn start_virtual_display(
    width: Option<i32>,
    height: Option<i32>,
    dpi: Option<i32>,
) -> Result<VirtualDisplayStatus, AppError> {
    let width = width.unwrap_or(1280);
    let height = height.unwrap_or(720);
    let dpi = dpi.unwrap_or(160);
    if width <= 0 || height <= 0 || dpi <= 0 {
        return Err(AppError::Message(
            "Virtual display dimensions and density must be positive".to_string(),
        ));
    }

    #[cfg(target_os = "android")]
    {
        call_runtime_bridge_start_virtual_display(width, height, dpi)?;
        virtual_display_status()
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (width, height, dpi);
        Err(AppError::Message(
            "The virtual display can only be started on Android".to_string(),
        ))
    }
}

#[tauri::command]
fn stop_virtual_display() -> Result<VirtualDisplayStatus, AppError> {
    #[cfg(target_os = "android")]
    {
        call_runtime_bridge_boolean("stopVirtualDisplay")?;
        virtual_display_status()
    }

    #[cfg(not(target_os = "android"))]
    {
        Err(AppError::Message(
            "The virtual display can only be stopped on Android".to_string(),
        ))
    }
}

#[tauri::command]
fn virtual_display_status() -> Result<VirtualDisplayStatus, AppError> {
    #[cfg(target_os = "android")]
    {
        let values = call_runtime_bridge_int_array("virtualDisplayStatus")?;
        if values.len() < 5 {
            return Err(AppError::Message(
                "The virtual display status is incomplete".to_string(),
            ));
        }
        Ok(VirtualDisplayStatus {
            active: values[0] != 0,
            display_id: values[1],
            width: values[2],
            height: values[3],
            frame_count: i64::from(values[4]),
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(VirtualDisplayStatus {
            active: false,
            display_id: -1,
            width: 0,
            height: 0,
            frame_count: 0,
        })
    }
}

#[tauri::command]
fn virtual_display_stream() -> Result<VirtualDisplayStream, AppError> {
    #[cfg(target_os = "android")]
    {
        Ok(VirtualDisplayStream {
            url: call_runtime_bridge_optional_string("virtualDisplayStreamUrl")?,
        })
    }

    #[cfg(not(target_os = "android"))]
    {
        Ok(VirtualDisplayStream { url: None })
    }
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_boolean(method: &'static str) -> Result<bool, AppError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        AppError::Message("the Java runtime has not been initialized".to_string())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let _ = env.exception_clear();
    let result = env
        .call_static_method(bridge_class, method, "()Z", &[])
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .z()
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_start_virtual_display(
    width: i32,
    height: i32,
    dpi: i32,
) -> Result<(), AppError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        AppError::Message("the Java runtime has not been initialized".to_string())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let _ = env.exception_clear();
    let result = env
        .call_static_method(
            bridge_class,
            "startVirtualDisplay",
            "(III)Z",
            &[
                jni::objects::JValue::Int(width),
                jni::objects::JValue::Int(height),
                jni::objects::JValue::Int(dpi),
            ],
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    let started = result
        .z()
        .map_err(|error| AppError::Message(error.to_string()))?;
    if started {
        Ok(())
    } else {
        // The bridge only reports a boolean, so the live control service
        // state is the closest cause: while Shizuku is unavailable or has
        // not granted permission yet, that missing precondition is the
        // whole reason the display could not start.
        let (state, status) = runtime::control_state();
        Err(AppError::Message(virtual_display_rejection_message(
            state, &status,
        )))
    }
}

/// Maps a failed virtual display start to the most actionable message. The
/// JNI bridge returns a bare boolean, so the reported control service state
/// is the only available explanation; a connected service keeps the generic
/// rejection wording.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn virtual_display_rejection_message(state: i64, status: &str) -> String {
    match state {
        1 => "Shizuku is unavailable; install or start Shizuku, then try again".to_string(),
        2 => "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again"
            .to_string(),
        // The service is connected, so the refusal happened on its side.
        3 => "The privileged control service rejected the virtual display".to_string(),
        4 => "The privileged control service disconnected; restart Shizuku and reopen the app, then try again"
            .to_string(),
        5 => format!("{status}; check Shizuku and the app logs, then try again"),
        _ => format!("{status}; try again shortly"),
    }
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_int_array(method: &'static str) -> Result<Vec<i32>, AppError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        AppError::Message("the Java runtime has not been initialized".to_string())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let _ = env.exception_clear();
    let result = env
        .call_static_method(bridge_class, method, "()[I", &[])
        .map_err(|error| AppError::Message(error.to_string()))?;
    let object = result
        .l()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let array: &jni::objects::JIntArray = (&object).into();
    let length = env
        .get_array_length(array)
        .map_err(|error| AppError::Message(error.to_string()))?;
    let mut values = vec![0_i32; length as usize];
    env.get_int_array_region(array, 0, &mut values)
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(values)
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_optional_string(method: &'static str) -> Result<Option<String>, AppError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        AppError::Message("the Java runtime has not been initialized".to_string())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let _ = env.exception_clear();
    let result = env
        .call_static_method(bridge_class, method, "()Ljava/lang/String;", &[])
        .map_err(|error| AppError::Message(error.to_string()))?;
    let object = result
        .l()
        .map_err(|error| AppError::Message(error.to_string()))?;
    if object.is_null() {
        return Ok(None);
    }
    let value = jni::objects::JString::from(object);
    let value = env
        .get_string(&value)
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(Some(value.to_string_lossy().into_owned()))
}

/// Terminates a run that is still inside `begin_preparing`: appends the
/// terminal Failure event, resets the execution result to Idle, and reports
/// telemetry. Must be called from within `MaaSessions::finish_with` so the
/// preparing lease returns to Idle; otherwise every later start and stop
/// stays wedged on the preparing lease and the run controls never recover.
fn abort_preparing_run(app: &AppHandle, logger: &run_log::RunLogger, message: String) {
    if let Ok(event) = logger.append(
        run_log::RunEventKind::Failure,
        runtime::RunState::Idle,
        message.clone(),
        None,
        None,
    ) {
        let _ = app.emit("run-event", &event);
    }
    runtime::set_execution_result(
        Some(logger.execution_id()),
        runtime::RunState::Idle,
        runtime::RunResultSeverity::Error,
        message.clone(),
    );
    telemetry::run_event("failed", &message, None);
    telemetry::run_finished("failed");
}

#[tauri::command]
async fn start_run(app: AppHandle, state: State<'_, AppState>) -> Result<StartRunStatus, AppError> {
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
            execution_id: String::new(),
            message: "There are no enabled tasks to run".to_string(),
            task_count,
        });
    }

    let execution_id = Uuid::new_v4().to_string();
    let runs_dir = state.runs_dir()?;
    let _lifecycle_guard = state.run_storage.lock().await;
    let logger = Arc::new(run_log::RunLogger::create(&runs_dir, &execution_id)?);
    let initial_event = logger.append(
        run_log::RunEventKind::Preparing,
        runtime::RunState::Preparing,
        "The run is being prepared",
        None,
        None,
    )?;
    app.emit("run-event", &initial_event)
        .map_err(|error| AppError::Message(error.to_string()))?;
    runtime::set_execution_result(
        Some(&execution_id),
        runtime::RunState::Preparing,
        runtime::RunResultSeverity::Info,
        "The run is being prepared".to_string(),
    );
    let ui_app = app.clone();
    logger.set_ui_sink(Arc::new(move |event| {
        let _ = ui_app.emit("run-event", event);
    }));
    let stopped_before_start = state.maa.begin_preparing(&execution_id)?;
    state.set_latest_log(logger.clone());
    run_log::set_latest_global(logger.clone());
    telemetry::run_started(&execution_id);
    if stopped_before_start {
        state.maa.finish_with(&execution_id, || {
            if let Ok(event) = logger.append(
                run_log::RunEventKind::Cancelled,
                runtime::RunState::Idle,
                "The run was cancelled before Maa started",
                None,
                None,
            ) {
                let _ = app.emit("run-event", &event);
            }
            runtime::set_execution_result(
                Some(&execution_id),
                runtime::RunState::Idle,
                runtime::RunResultSeverity::Info,
                "The run was cancelled".to_string(),
            );
            telemetry::run_event("stopped", "The run was cancelled before Maa started", None);
            telemetry::run_finished("stopped");
        });
        return Ok(StartRunStatus {
            execution_id,
            message: "The run was cancelled".to_string(),
            task_count,
        });
    }

    // Any failure after `begin_preparing` must finish the lease before this
    // command returns, or every later start and stop stays wedged on the
    // preparing lease and the run controls never return to Idle.
    let fail_preparing = |message: String| -> AppError {
        state.maa.finish_with(&execution_id, || {
            abort_preparing_run(&app, &logger, message.clone());
        });
        AppError::Message(message)
    };

    // MaaFramework caches the display ID on its controller, so the virtual
    // display must exist before session creation and before any StartApp task.
    #[cfg(target_os = "android")]
    {
        if let Err(error) = call_runtime_bridge_start_virtual_display(1280, 720, 160) {
            return Err(fail_preparing(error.to_string()));
        }
        let _ = app.emit("virtual-display-changed", ());
    }

    let sessions = state.maa.clone();
    let run_execution_id = execution_id.clone();
    let logger_for_run = logger.clone();
    let project_root = project.root.clone();
    let client_language = agent::resolved_locale(configuration.ui_language, &project.language);
    let project_version = project.version.clone();
    let attachment_rate = project
        .metadata
        .telemetry
        .as_ref()
        .map(|item| item.failure_attachments_sample_rate)
        .unwrap_or(1.0);
    let focus_translations = project.metadata.translations.clone();
    let agent_count = project.agents.len();
    let creation_execution_id = run_execution_id.clone();
    let controller_display_id = runtime::active_display_id();
    if controller_display_id == 0 {
        return Err(fail_preparing(
            "The virtual display is not active".to_string(),
        ));
    }
    if let Err(error) = logger.append(
        run_log::RunEventKind::Preparing,
        runtime::RunState::Preparing,
        format!("Controller bound to display {controller_display_id}"),
        None,
        None,
    ) {
        return Err(fail_preparing(error.to_string()));
    }
    let resolved_for_run = resolved.clone();
    let base_pipeline = resolved.base_pipeline.clone();
    let force_stop_target_app = configuration.force_stop_target_app;
    let pi_env = if agent_count > 0 {
        Some(agent::pi_environment(
            &resolved,
            &client_language,
            project_version.as_deref(),
            &focus_translations,
        ))
    } else {
        None
    };
    drop(_lifecycle_guard);
    tokio::spawn(async move {
        let fail = abort_preparing_run;
        let creation = tokio::task::spawn_blocking(move || {
            let agent = agent::prepare_android(agent_count)
                .map_err(|error| crate::runtime::RuntimeError::Maa(error.to_string()))?;
            runtime::create_session(
                &creation_execution_id,
                &project_root,
                &resolved_for_run,
                controller_display_id,
                force_stop_target_app,
                agent.as_ref(),
                pi_env.as_ref(),
            )
        })
        .await;

        match creation {
            Ok(Ok(created)) => {
                let tasker = match sessions.begin(&run_execution_id, created.tasker, created.agent)
                {
                    Ok(tasker) => tasker,
                    Err(error) => {
                        sessions.finish_with(&run_execution_id, || {
                            fail(&app, &logger_for_run, error.to_string());
                        });
                        return;
                    }
                };
                if let Err(error) = tasker.add_event_sink(Box::new(focus::FocusSink::new(
                    app.clone(),
                    focus_translations.clone(),
                ))) {
                    if let Ok(event) = logger_for_run.append(
                        run_log::RunEventKind::Warning,
                        runtime::RunState::Running,
                        format!("focus notifications could not be registered: {error}"),
                        None,
                        None,
                    ) {
                        let _ = app.emit("run-event", &event);
                    }
                }
                if let Ok(event) = logger_for_run.append(
                    run_log::RunEventKind::Started,
                    runtime::RunState::Running,
                    "The run started".to_string(),
                    None,
                    None,
                ) {
                    let _ = app.emit("run-event", &event);
                }
                runtime::set_execution_result(
                    Some(logger_for_run.execution_id()),
                    runtime::RunState::Running,
                    runtime::RunResultSeverity::Info,
                    String::new(),
                );
                let run_tasker = tasker.clone();
                let task_logger = logger_for_run.clone();
                let result = tokio::task::spawn_blocking(move || {
                    runtime::run_tasks(&run_tasker, &tasks, &base_pipeline, &task_logger)
                })
                .await;
                let outcome = match result {
                    Ok(Ok(outcome)) => outcome,
                    Ok(Err(error)) => {
                        sessions.finish_with(&run_execution_id, || {
                            fail(&app, &logger_for_run, error.to_string());
                        });
                        return;
                    }
                    Err(error) => {
                        sessions.finish_with(&run_execution_id, || {
                            fail(&app, &logger_for_run, error.to_string());
                        });
                        return;
                    }
                };
                let task_name = if let runtime::RunOutcome::Failed { task_name, .. } = &outcome {
                    Some(task_name.clone())
                } else {
                    None
                };
                let (kind, state, message, outcome_label, attachment_path) = match outcome {
                    runtime::RunOutcome::Completed => (
                        run_log::RunEventKind::Completed,
                        runtime::RunState::Idle,
                        "The run completed".to_string(),
                        "completed",
                        None,
                    ),
                    runtime::RunOutcome::Stopped => (
                        run_log::RunEventKind::Cancelled,
                        runtime::RunState::Idle,
                        "The run was stopped".to_string(),
                        "stopped",
                        None,
                    ),
                    runtime::RunOutcome::Failed {
                        entry,
                        task_name: _,
                        status,
                    } => {
                        let mut attachment_path = None;
                        match diagnostics::capture_failure_screenshot(
                            logger_for_run.run_dir(),
                            &entry,
                        ) {
                            Err(error) => {
                                let _ = logger_for_run.append(
                                    run_log::RunEventKind::Failure,
                                    runtime::RunState::Running,
                                    format!("failure screenshot could not be captured: {error}"),
                                    None,
                                    Some(serde_json::json!({ "taskEntry": entry })),
                                );
                            }
                            Ok(path) => {
                                if telemetry::sample(attachment_rate) {
                                    attachment_path = Some(path);
                                }
                            }
                        }
                        (
                            run_log::RunEventKind::Failure,
                            runtime::RunState::Idle,
                            format!("Maa task {entry} failed: {status}"),
                            "failed",
                            attachment_path,
                        )
                    }
                };
                sessions.finish_with(&run_execution_id, || {
                    if let Ok(event) =
                        logger_for_run.append(kind, state, message.clone(), task_name, None)
                    {
                        let _ = app.emit("run-event", &event);
                    }
                    telemetry::run_event(
                        outcome_label,
                        &message,
                        attachment_path
                            .and_then(|path| path.to_str().map(str::to_string))
                            .as_deref(),
                    );
                    telemetry::run_finished(outcome_label);
                    let severity = if kind == run_log::RunEventKind::Failure {
                        runtime::RunResultSeverity::Error
                    } else {
                        runtime::RunResultSeverity::Info
                    };
                    runtime::set_execution_result(
                        Some(logger_for_run.execution_id()),
                        state,
                        severity,
                        message,
                    );
                });
            }
            Ok(Err(error)) => {
                sessions.finish_with(&run_execution_id, || {
                    fail(&app, &logger_for_run, error.to_string());
                });
            }
            Err(error) => {
                sessions.finish_with(&run_execution_id, || {
                    fail(&app, &logger_for_run, error.to_string());
                });
            }
        }
    });

    Ok(StartRunStatus {
        execution_id: execution_id.clone(),
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
fn stop_run(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: Option<String>,
) -> Result<String, AppError> {
    let requested_id = execution_id.or_else(|| {
        state
            .latest_log()
            .ok()
            .map(|logger| logger.execution_id().to_string())
    });
    if let (Some(requested), Ok(logger)) = (requested_id.as_deref(), state.latest_log()) {
        if requested != logger.execution_id() {
            return Err(AppError::Message(
                "execution id does not match the latest run".to_string(),
            ));
        }
    }
    let stopping_requested = requested_id.clone();
    if state.maa.request_stop_with(requested_id.as_deref(), || {
        if let Ok(logger) = state.latest_log() {
            if stopping_requested
                .as_deref()
                .is_none_or(|id| id == logger.execution_id())
            {
                if let Ok(event) = logger.append(
                    run_log::RunEventKind::Stopping,
                    runtime::RunState::Stopping,
                    "Stop was requested",
                    None,
                    None,
                ) {
                    let _ = app.emit("run-event", &event);
                }
            }
        }
        runtime::set_execution_result(
            stopping_requested.as_deref(),
            runtime::RunState::Stopping,
            runtime::RunResultSeverity::Info,
            "The run is stopping".to_string(),
        );
    })? {
        Ok("The run is stopping".to_string())
    } else {
        Ok("No run is active".to_string())
    }
}

#[tauri::command]
async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: Option<String>,
) -> Result<diagnostics::DiagnosticExport, AppError> {
    let _storage_guard = state.run_storage.lock().await;
    let logger = state.latest_log()?;
    let requested = execution_id.unwrap_or_else(|| logger.execution_id().to_string());
    if requested != logger.execution_id() {
        return Err(AppError::Message(
            "Only the latest diagnostic run can be exported in this session".to_string(),
        ));
    }
    let run_dir = logger.run_dir().to_path_buf();
    let output = run_dir.join(format!(
        "maa_tauri_android-diagnostics-{}.zip",
        run_log::sanitize(&requested)
    ));
    let source = diagnostics::platform_source();
    let collector_run_dir = run_dir.clone();
    let collection_gaps = tokio::task::spawn_blocking(move || {
        diagnostics::collect_artifacts(&source, &collector_run_dir)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;
    let export = diagnostics::export_bundle(&run_dir, output, &requested, collection_gaps)?;
    if let Ok(event) = logger.append(
        run_log::RunEventKind::Completed,
        runtime::run_result()
            .map(|result| result.state)
            .unwrap_or(runtime::RunState::Idle),
        format!("Diagnostic export written: {}", export.path),
        None,
        Some(serde_json::json!({
            "status": export.manifest.status,
            "path": export.path,
            "partialReasons": export.manifest.partial_reasons,
        })),
    ) {
        let _ = app.emit("run-event", &event);
    }
    Ok(export)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogExport {
    path: String,
    /// Display name of the copy the Android shell saved into the Downloads
    /// folder; absent when only a local archive path is available (desktop).
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

/// The Android shell copies the archive into the system Downloads collection
/// (no storage permission needed on API 29+) and opens the system share sheet,
/// mirroring the MaaFwApp log export: save locally or share, one tap each.
#[cfg(target_os = "android")]
fn export_log_archive_via_bridge(path: &str) -> Result<String, AppError> {
    let bridge_class =
        runtime::runtime_bridge_class().map_err(|error| AppError::Message(error.to_string()))?;
    let vm = runtime::java_vm()
        .ok_or_else(|| AppError::Message("Java runtime is not initialized".to_string()))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let java_path = env
        .new_string(path)
        .map_err(|error| AppError::Message(error.to_string()))?;
    let java_object: jni::objects::JObject = java_path.into();
    let name = env
        .call_static_method(
            bridge_class,
            "exportLogs",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[jni::objects::JValue::Object(&java_object)],
        )
        .map_err(|error| {
            let _ = env.exception_clear();
            AppError::Message(error.to_string())
        })?
        .l()
        .map_err(|error| AppError::Message(error.to_string()))?;
    if name.is_null() {
        return Err(AppError::Message(
            "could not export the log archive on this device".to_string(),
        ));
    }
    let name = jni::objects::JString::from(name);
    let name = env
        .get_string(&name)
        .map_err(|error| AppError::Message(error.to_string()))?
        .to_string_lossy()
        .into_owned();
    Ok(name)
}

#[tauri::command]
async fn export_logs(app: AppHandle) -> Result<LogExport, AppError> {
    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|error| AppError::Path(error.to_string()))?;
    let exports_dir = cache_dir.join("log-exports");
    let app_log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Path(error.to_string()))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Path(error.to_string()))?;
    let roots = vec![
        diagnostics::LogExportRoot {
            entry: "logs/app".to_string(),
            path: app_log_dir,
        },
        diagnostics::LogExportRoot {
            entry: "logs/maa".to_string(),
            path: data_dir.join("maa-logs"),
        },
    ];
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let output = exports_dir.join(format!("maa_tauri_android-logs-{timestamp}.zip"));
    let archive = tokio::task::spawn_blocking(move || {
        let source = diagnostics::log_export_source();
        diagnostics::export_log_archive(&source, &roots, output)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;
    let path = archive.to_string_lossy().into_owned();
    #[cfg(target_os = "android")]
    let file_name = {
        let bridge_path = path.clone();
        Some(
            tokio::task::spawn_blocking(move || export_log_archive_via_bridge(&bridge_path))
                .await
                .map_err(|error| AppError::Message(error.to_string()))??,
        )
    };
    #[cfg(not(target_os = "android"))]
    let file_name: Option<String> = None;
    Ok(LogExport { path, file_name })
}

#[tauri::command]
async fn capture_manual_screenshot(
    app: AppHandle,
    state: State<'_, AppState>,
    execution_id: Option<String>,
) -> Result<ManualScreenshot, AppError> {
    let _storage_guard = state.run_storage.lock().await;
    let logger = state.latest_log()?;
    let requested = execution_id.unwrap_or_else(|| logger.execution_id().to_string());
    if requested != logger.execution_id() {
        return Err(AppError::Message(
            "Only the latest run can be captured in this session".to_string(),
        ));
    }
    let run_dir = logger.run_dir().to_path_buf();
    let path = tokio::task::spawn_blocking(move || {
        let source = diagnostics::platform_source();
        diagnostics::capture_manual_screenshot(&source, &run_dir)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;
    if let Ok(event) = logger.append(
        run_log::RunEventKind::Screenshot,
        runtime::run_result()
            .map(|result| result.state)
            .unwrap_or(runtime::RunState::Idle),
        format!("Manual screenshot saved: {}", path.display()),
        None,
        Some(serde_json::json!({ "path": path.to_string_lossy() })),
    ) {
        let _ = app.emit("run-event", &event);
    }
    Ok(ManualScreenshot {
        execution_id: logger.execution_id().to_string(),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
async fn clear_diagnostic_data(state: State<'_, AppState>) -> Result<ClearedDiagnostics, AppError> {
    let _storage_guard = state.run_storage.lock().await;
    if state.maa.status() != runtime::RunState::Idle {
        return Err(AppError::Message(
            "Diagnostics cannot be cleared while a run is active".to_string(),
        ));
    }
    let runs_dir = state.runs_dir()?;
    let cleanup_runs_dir = runs_dir.clone();
    let deleted_run_count =
        tokio::task::spawn_blocking(move || diagnostics::clear_run_directories(&cleanup_runs_dir))
            .await
            .map_err(|error| AppError::Message(error.to_string()))??;
    state.clear_latest_log();
    runtime::clear_run_result();
    Ok(ClearedDiagnostics {
        deleted_run_count,
        runs_dir: runs_dir.to_string_lossy().into_owned(),
    })
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
    #[error("{0}")]
    Runtime(#[from] runtime::RuntimeError),
    #[error("{0}")]
    RunLog(#[from] run_log::RunLogError),
    #[error("{0}")]
    Diagnostic(#[from] diagnostics::DiagnosticError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::ProjectMetadata;

    fn project() -> Project {
        Project {
            root: "/fixtures".to_string(),
            interface_version: 2,
            name: "fixture".to_string(),
            label: "Fixture".to_string(),
            version: None,
            language: "zh_cn".to_string(),
            languages: Vec::new(),
            controllers: Vec::new(),
            resources: Vec::new(),
            groups: Vec::new(),
            tasks: Vec::new(),
            options: BTreeMap::new(),
            global_options: Vec::new(),
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: ProjectMetadata::default(),
        }
    }

    #[test]
    fn project_asset_path_allows_images_inside_the_project() {
        let root = std::env::temp_dir().join(format!("ttflow-asset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::write(root.join("images/example.png"), b"png").unwrap();

        let asset = project_asset_path(&root, "images/example.png").unwrap();
        assert!(asset.ends_with("images/example.png"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_asset_path_rejects_unsafe_and_non_image_paths() {
        let root = std::env::temp_dir().join(format!("ttflow-asset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::write(root.join("images/example.png"), b"png").unwrap();

        assert!(project_asset_path(&root, "images/example.txt").is_err());
        assert!(project_asset_path(&root, "/images/example.png").is_err());
        assert!(project_asset_path(&root, "../images/example.png").is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn telemetry_defaults_on_for_first_install_only() {
        let project = project();
        let mut first_install = UserConfiguration::default();
        normalize_configuration(&project, &mut first_install);
        assert!(first_install.telemetry_enabled);

        let mut persisted = UserConfiguration::default();
        persisted.initialized = true;
        persisted.telemetry_enabled = false;
        normalize_configuration(&project, &mut persisted);
        assert!(!persisted.telemetry_enabled);
    }

    #[test]
    #[cfg(not(target_os = "android"))]
    fn privileged_actions_are_unsupported_off_android() {
        assert!(matches!(
            request_privileged_access(),
            Err(AppError::Message(message)) if message.contains("only be requested on Android")
        ));
        assert!(matches!(
            open_shizuku(),
            Err(AppError::Message(message)) if message.contains("only be opened on Android")
        ));
    }

    #[test]
    #[cfg(not(target_os = "android"))]
    fn virtual_display_actions_are_unsupported_off_android() {
        assert!(matches!(
            start_virtual_display(None, None, None),
            Err(AppError::Message(message)) if message.contains("only be started on Android")
        ));
        assert!(matches!(
            stop_virtual_display(),
            Err(AppError::Message(message)) if message.contains("only be stopped on Android")
        ));
    }

    #[test]
    #[cfg(not(target_os = "android"))]
    fn virtual_display_status_is_inactive_off_android() {
        let status = virtual_display_status().expect("the desktop status is available");
        assert!(!status.active);
        assert_eq!(status.display_id, -1);
        assert_eq!(status.width, 0);
        assert_eq!(status.height, 0);
        assert_eq!(status.frame_count, 0);
    }

    #[test]
    fn virtual_display_rejection_names_the_missing_precondition() {
        assert_eq!(
            virtual_display_rejection_message(2, "Shizuku permission is required"),
            "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(1, "Shizuku is unavailable"),
            "Shizuku is unavailable; install or start Shizuku, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(4, "The privileged control unit disconnected"),
            "The privileged control service disconnected; restart Shizuku and reopen the app, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(5, "The privileged control unit failed to start"),
            "The privileged control unit failed to start; check Shizuku and the app logs, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(3, "The privileged control unit is connected"),
            "The privileged control service rejected the virtual display"
        );
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_initializeSecretBridge(
    env: *mut std::ffi::c_void,
    class: *mut std::ffi::c_void,
) {
    if let Ok(mut env) = unsafe { jni::JNIEnv::from_raw(env.cast()) } {
        let runtime_bridge_class = unsafe { jni::objects::JClass::from_raw(class.cast()) };
        if let Err(error) = runtime::initialize_secret_bridge(&mut env, &runtime_bridge_class) {
            eprintln!("Failed to initialize the secret bridge: {error}");
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_setBootstrapProjectRoot(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    project_root: *mut std::ffi::c_void,
) {
    if let Ok(mut env) = unsafe { jni::JNIEnv::from_raw(env.cast()) } {
        let raw_project_root = unsafe { jni::objects::JObject::from_raw(project_root.cast()) };
        let project_root = jni::objects::JString::from(raw_project_root);
        match env.get_string(&project_root) {
            Ok(project_root) => {
                if BOOTSTRAP_PROJECT_ROOT
                    .set(project_root.to_string_lossy().into_owned())
                    .is_err()
                {
                    eprintln!("The bootstrap project root was already initialized");
                }
            }
            Err(error) => eprintln!("Failed to read the bootstrap project root: {error}"),
        };
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_configureScreen(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    width: std::os::raw::c_int,
    height: std::os::raw::c_int,
) {
    runtime::configure_screen(width, height);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_setActiveDisplay(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    display_id: std::os::raw::c_int,
) {
    runtime::set_active_display(display_id);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_setControlState(
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(run_log::APPLICATION_LOG_FILE_STEM.to_string()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            load_project,
            read_project_image,
            save_configuration,
            apply_preset,
            resolve_current,
            reset_task_parameters,
            privileged_status,
            request_privileged_access,
            open_shizuku,
            start_virtual_display,
            stop_virtual_display,
            virtual_display_status,
            virtual_display_stream,
            start_run,
            run_status,
            stop_run,
            export_diagnostics,
            export_logs,
            capture_manual_screenshot,
            clear_diagnostic_data
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| AppError::Path(error.to_string()))?;
            state.set_runs_dir(root.join("runs"));
            let maa_log_dir = root.join("maa-logs");
            let _ = std::fs::create_dir_all(&maa_log_dir);
            runtime::set_maa_log_dir(maa_log_dir);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

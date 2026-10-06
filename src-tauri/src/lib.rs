mod agent;
mod atomic_io;
mod diagnostics;
mod domain;
mod focus;
mod persistence;
mod run_diagnosis;
mod run_history;
mod run_log;
mod run_progress;
mod run_supervisor;
mod runtime;
mod schedule;
mod secrets;
mod telemetry;
mod update;
mod version;

use domain::loader::ProjectLoader;
use domain::resolver::{resolve_run, ResolverError};
use domain::types::{
    ConfigurationTemplate, ConfiguredTask, Project, RunConfiguration, UserConfiguration,
};
use domain::welcome;
use persistence::{PersistenceError, UserConfigurationStore};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Condvar, Mutex, RwLock,
};

#[cfg(target_os = "android")]
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use uuid::Uuid;

#[cfg(target_os = "android")]
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "android")]
pub fn android_app_handle() -> Option<&'static AppHandle> {
    APP_HANDLE.get()
}

#[cfg(not(target_os = "android"))]
fn android_app_handle() -> Option<&'static AppHandle> {
    None
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStateSnapshot {
    project: Option<Project>,
    configuration: UserConfiguration,
    project_path: Option<String>,
    welcome_revision: u64,
    /// Rides along with the snapshot so the About card reflects the project that
    /// was just loaded, without a second IPC round trip.
    versions: version::VersionInfo,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PreparationProgress {
    phase: String,
    copied_bytes: u64,
    total_archive_bytes: u64,
    extracted_entries: u32,
    total_entries: u32,
    current_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PreparationState {
    revision: u64,
    status: String,
    stage: String,
    project_ready: bool,
    ui_ready: bool,
    engine_ready: bool,
    project_root: Option<String>,
    progress: Option<PreparationProgress>,
    error: Option<String>,
}

impl Default for PreparationState {
    fn default() -> Self {
        Self {
            revision: 0,
            status: "idle".to_string(),
            stage: "idle".to_string(),
            project_ready: false,
            ui_ready: false,
            engine_ready: false,
            project_root: None,
            progress: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct WelcomeState {
    revision: u64,
    welcome: Vec<String>,
    welcome_fingerprint: Option<String>,
    welcome_pending: bool,
    welcome_errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePreparationUpdate {
    status: String,
    stage: String,
    #[serde(default)]
    project_ready: bool,
    #[serde(default)]
    engine_ready: bool,
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    progress: Option<PreparationProgress>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Default)]
struct PreparationStore {
    state: Mutex<PreparationState>,
    project_ready: Condvar,
}

static PREPARATION_STORE: std::sync::OnceLock<PreparationStore> = std::sync::OnceLock::new();

fn preparation_store() -> &'static PreparationStore {
    PREPARATION_STORE.get_or_init(PreparationStore::default)
}

fn preparation_state() -> PreparationState {
    preparation_store()
        .state
        .lock()
        .expect("preparation state lock poisoned")
        .clone()
}

fn set_preparation_stage(stage: &str) {
    let app = android_app_handle().cloned();
    let state = {
        let mut guard = preparation_store()
            .state
            .lock()
            .expect("preparation state lock poisoned");
        guard.revision += 1;
        guard.status = "running".to_string();
        guard.stage = stage.to_string();
        guard.progress = None;
        guard.error = None;
        guard.clone()
    };
    if let Some(app) = app {
        let _ = app.emit("preparation-state", state);
    }
}

fn mark_preparation_ui_ready() -> Result<(), String> {
    let app = android_app_handle().cloned();
    let state = {
        let mut guard = preparation_store()
            .state
            .lock()
            .expect("preparation state lock poisoned");
        if let Some(error) = guard.error.clone() {
            return Err(error);
        }
        guard.revision += 1;
        guard.status = "running".to_string();
        guard.stage = "uiReady".to_string();
        guard.ui_ready = true;
        #[cfg(not(target_os = "android"))]
        {
            guard.engine_ready = true;
        }
        if guard.engine_ready {
            guard.status = "ready".to_string();
            guard.stage = "engineReady".to_string();
        }
        guard.error = None;
        guard.clone()
    };
    if let Some(app) = app {
        let _ = app.emit("preparation-state", state);
    }
    Ok(())
}

fn mark_preparation_failed(error: String) {
    let app = android_app_handle().cloned();
    let state = {
        let mut guard = preparation_store()
            .state
            .lock()
            .expect("preparation state lock poisoned");
        guard.revision += 1;
        guard.status = "failed".to_string();
        guard.stage = "failed".to_string();
        guard.project_ready = false;
        guard.engine_ready = false;
        guard.error = Some(error);
        guard.clone()
    };
    if let Some(app) = app {
        let _ = app.emit("preparation-state", state);
    }
}

#[cfg(target_os = "android")]
fn report_native_preparation(update: NativePreparationUpdate) {
    let app = android_app_handle().cloned();
    let state = {
        let mut guard = preparation_store()
            .state
            .lock()
            .expect("preparation state lock poisoned");
        apply_native_preparation(&mut guard, update);
        let state = guard.clone();
        preparation_store().project_ready.notify_all();
        state
    };
    if let Some(app) = app {
        let _ = app.emit("preparation-state", state);
    }
}

fn apply_native_preparation(current: &mut PreparationState, update: NativePreparationUpdate) {
    current.revision += 1;
    current.status = if update.engine_ready {
        "ready".to_string()
    } else {
        update.status
    };
    current.stage = update.stage;
    current.project_ready = update.project_ready;
    current.engine_ready = update.engine_ready;
    if let Some(project_root) = update.project_root {
        current.project_root = Some(project_root);
    }
    current.progress = update.progress;
    current.error = update.error;
}

fn reset_preparation_for_retry(current: &mut PreparationState) {
    current.revision += 1;
    current.status = "running".to_string();
    current.stage = "retrying".to_string();
    current.project_ready = false;
    current.ui_ready = false;
    current.engine_ready = false;
    current.project_root = None;
    current.progress = None;
    current.error = None;
}

#[cfg(target_os = "android")]
fn wait_for_native_project(timeout: std::time::Duration) -> Result<String, AppError> {
    let deadline = std::time::Instant::now() + timeout;
    let mut guard = preparation_store()
        .state
        .lock()
        .expect("preparation state lock poisoned");
    loop {
        if let Some(error) = guard.error.clone() {
            return Err(AppError::Message(error));
        }
        if guard.project_ready {
            return Ok(guard.project_root.clone().ok_or_else(|| {
                AppError::Message("The prepared project root is missing".to_string())
            })?);
        }
        let now = std::time::Instant::now();
        if now >= deadline {
            return Err(AppError::Message(
                "App preparation timed out before the project was ready".to_string(),
            ));
        }
        let (updated, timeout_result) = preparation_store()
            .project_ready
            .wait_timeout(guard, deadline - now)
            .expect("preparation state lock poisoned");
        if timeout_result.timed_out() && !updated.project_ready {
            return Err(AppError::Message(
                "App preparation timed out before the project was ready".to_string(),
            ));
        }
        guard = updated;
    }
}

struct AppState {
    project: RwLock<Option<Project>>,
    configuration: RwLock<UserConfiguration>,
    persistence: Mutex<()>,
    project_path: RwLock<Option<PathBuf>>,
    store: RwLock<Option<UserConfigurationStore>>,
    maa: Arc<runtime::MaaSessions>,
    runs_dir: RwLock<Option<PathBuf>>,
    latest_log: RwLock<Option<Arc<run_log::RunLogger>>>,
    run_storage: tokio::sync::Mutex<()>,
    preparation_task: Arc<tokio::sync::Mutex<()>>,
    welcome_revision: AtomicU64,
    schedule_store: RwLock<Option<Arc<schedule::ScheduleStore>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: RwLock::new(None),
            configuration: RwLock::new(UserConfiguration::default()),
            persistence: Mutex::new(()),
            project_path: RwLock::new(None),
            store: RwLock::new(None),
            maa: Arc::new(runtime::MaaSessions::default()),
            runs_dir: RwLock::new(None),
            latest_log: RwLock::new(None),
            run_storage: tokio::sync::Mutex::new(()),
            preparation_task: Arc::new(tokio::sync::Mutex::new(())),
            welcome_revision: AtomicU64::new(0),
            schedule_store: RwLock::new(None),
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

    fn project_and_configuration(&self) -> Result<(Project, UserConfiguration), AppError> {
        let project = self.project.read().expect("project lock poisoned");
        let configuration = self
            .configuration
            .read()
            .expect("configuration lock poisoned");
        project
            .as_ref()
            .map(|project| (project.clone(), configuration.clone()))
            .ok_or(AppError::NoProject)
    }

    fn set_project(&self, path: Option<PathBuf>, project: Project) {
        *self.project.write().expect("project lock poisoned") = Some(project);
        *self
            .project_path
            .write()
            .expect("project path lock poisoned") = path;
    }

    fn current_welcome_revision(&self) -> u64 {
        self.welcome_revision.load(Ordering::SeqCst)
    }

    fn apply_welcome_state(&self, revision: u64, state: WelcomeState) -> bool {
        if self.current_welcome_revision() != revision {
            return false;
        }
        let mut project = self.project.write().expect("project lock poisoned");
        let Some(project) = project.as_mut() else {
            return false;
        };
        project.metadata.welcome = state.welcome;
        project.metadata.welcome_fingerprint = state.welcome_fingerprint;
        project.metadata.welcome_pending = state.welcome_pending;
        project.metadata.welcome_errors = state.welcome_errors;
        true
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

    fn schedule_store(&self) -> Result<Arc<schedule::ScheduleStore>, AppError> {
        self.schedule_store
            .read()
            .expect("schedule store lock poisoned")
            .as_ref()
            .ok_or_else(|| AppError::Message("Schedule storage is not initialized".to_string()))
            .cloned()
    }

    fn set_schedule_data_dir(&self, path: PathBuf) {
        *self
            .schedule_store
            .write()
            .expect("schedule store lock poisoned") =
            Some(Arc::new(schedule::ScheduleStore::new(path)));
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
        // Keep the guard across publication so two overlapping saves cannot
        // finish in one order and publish their snapshots in the other order.
        let _persistence = self.persistence.lock().expect("persistence lock poisoned");
        self.persist_configuration_locked(&configuration)?;
        *self
            .configuration
            .write()
            .expect("configuration lock poisoned") = configuration;
        Ok(())
    }

    fn persist_configuration_locked(
        &self,
        configuration: &UserConfiguration,
    ) -> Result<(), PersistenceError> {
        let store_path = self
            .store
            .read()
            .expect("store lock poisoned")
            .as_ref()
            .map(|store| store.path().to_path_buf());
        let Some(store_path) = store_path else {
            return Ok(());
        };
        let project = self
            .project
            .read()
            .expect("project lock poisoned")
            .clone()
            .ok_or_else(|| {
                PersistenceError::Secret(crate::secrets::SecretError::BridgeUnavailable)
            })?;
        UserConfigurationStore::new(store_path).save(&project, configuration)
    }

    fn install(
        &self,
        config_path: PathBuf,
        project_path: Option<PathBuf>,
        project: Project,
        mut configuration: UserConfiguration,
    ) -> Result<UserConfiguration, AppError> {
        let _welcome_revision = self.welcome_revision.fetch_add(1, Ordering::SeqCst);
        normalize_configuration(&project, &mut configuration);
        let _persistence = self.persistence.lock().expect("persistence lock poisoned");
        *self.store.write().expect("store lock poisoned") =
            Some(UserConfigurationStore::new(config_path));
        self.set_project(project_path, project);
        self.persist_configuration_locked(&configuration)?;
        *self
            .configuration
            .write()
            .expect("configuration lock poisoned") = configuration.clone();
        let project = self.project().expect("the project was just installed");
        configure_telemetry(&project, &configuration);
        log_loaded_project(&project, &configuration);
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

/// Names the loaded Project Interface, its version, and the resource this run will
/// use. Logged from `install`, the one funnel both `bootstrap` and `load_project`
/// pass through, so every project load appears exactly once.
fn log_loaded_project(project: &Project, configuration: &UserConfiguration) {
    log::info!(
        "{}",
        version::project_line(
            &project.name,
            project.version.as_deref(),
            project.interface_version,
            configuration.active_resource.as_deref(),
        )
    );
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum PrivilegedBackend {
    Shizuku,
    Root,
}

impl PrivilegedBackend {
    fn as_str(self) -> &'static str {
        match self {
            Self::Shizuku => "shizuku",
            Self::Root => "root",
        }
    }

    fn parse(value: &str) -> Self {
        if value == "root" {
            Self::Root
        } else {
            Self::Shizuku
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum PrivilegedStatus {
    Starting {
        message: String,
        setup_required: Vec<String>,
        backend: PrivilegedBackend,
    },
    Connected {
        message: String,
        backend: PrivilegedBackend,
    },
    PermissionRequired {
        message: String,
        setup_required: Vec<String>,
        backend: PrivilegedBackend,
    },
    NotInstalled {
        message: String,
        setup_required: Vec<String>,
        backend: PrivilegedBackend,
    },
    Disconnected {
        message: String,
        setup_required: Vec<String>,
        backend: PrivilegedBackend,
    },
    Error {
        message: String,
        setup_required: Vec<String>,
        backend: PrivilegedBackend,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartRunStatus {
    execution_id: String,
    message: String,
    task_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TaskRunSelectionMode {
    Current,
    CurrentAndFollowing,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRunSelection {
    run_configuration_id: String,
    instance_id: String,
    mode: TaskRunSelectionMode,
}

/// Chooses the tasks for one run without changing the persisted configuration.
/// A selected anchor must itself be runnable; later tasks still honor their
/// enabled flags and resource availability.
fn startup_tasks(
    tasks: &[crate::domain::types::ResolvedTask],
    selection: Option<&TaskRunSelection>,
) -> Result<Vec<crate::domain::types::ResolvedTask>, AppError> {
    let Some(selection) = selection else {
        return Ok(tasks
            .iter()
            .filter(|task| task.enabled && task.unavailable_reason.is_none())
            .cloned()
            .collect());
    };

    let anchor_index = tasks
        .iter()
        .position(|task| {
            task.configured
                .as_ref()
                .is_some_and(|configured| configured.instance_id == selection.instance_id)
        })
        .ok_or_else(|| {
            AppError::Message(
                "The selected task is no longer in the active run configuration".to_string(),
            )
        })?;
    let anchor = &tasks[anchor_index];
    if !anchor.enabled || anchor.unavailable_reason.is_some() {
        return Err(AppError::Message(
            "The selected task is not available for this run".to_string(),
        ));
    }

    let end = match selection.mode {
        TaskRunSelectionMode::Current => anchor_index + 1,
        TaskRunSelectionMode::CurrentAndFollowing => tasks.len(),
    };
    Ok(tasks
        .iter()
        .enumerate()
        .filter(|(index, task)| {
            *index >= anchor_index
                && *index < end
                && task.enabled
                && task.unavailable_reason.is_none()
        })
        .map(|(_, task)| task.clone())
        .collect())
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct VirtualDisplayTouchResult {
    accepted: bool,
    code: i32,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VirtualDisplayTouchMarker {
    id: i32,
    x: i32,
    y: i32,
    action: i32,
    contact: i32,
}

/// Physical-pixel insets the web layer must keep clear of. `None` lets the
/// frontend fall back to its CSS `env()` defaults (desktop, or no activity).
#[tauri::command]
fn window_insets() -> Option<runtime::WindowInsets> {
    runtime::window_insets()
}

#[tauri::command]
async fn bootstrap(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppStateSnapshot, AppError> {
    prepare_app(app, state).await
}

#[tauri::command]
async fn prepare_app(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppStateSnapshot, AppError> {
    let _preparation_guard = state.preparation_task.lock().await;
    let current = preparation_state();
    if current.ui_ready && state.project().is_ok() {
        return Ok(current_snapshot(&state));
    }

    #[cfg(target_os = "android")]
    let bundled_root = {
        if let Some(error) = preparation_state().error {
            let error = AppError::Message(error);
            return Err(error);
        }
        set_preparation_stage("waitingForNativePreparation");
        let root = tauri::async_runtime::spawn_blocking(|| {
            wait_for_native_project(std::time::Duration::from_secs(120))
        })
        .await
        .map_err(|error| AppError::Message(error.to_string()))??;
        set_preparation_stage("loadingProject");
        Some(PathBuf::from(root))
    };

    #[cfg(not(target_os = "android"))]
    let bundled_root = {
        set_preparation_stage("loadingProject");
        Option::<PathBuf>::None
    };

    let project_root = bundled_root.as_deref().and_then(std::path::Path::to_str);

    let result = bootstrap_snapshot(&app, &state, project_root).await;
    match result {
        Ok(snapshot) => {
            mark_preparation_ui_ready().map_err(AppError::Message)?;
            Ok(snapshot)
        }
        Err(error) => {
            mark_preparation_failed(error.to_string());
            Err(error)
        }
    }
}

#[tauri::command]
fn get_preparation_status() -> Result<PreparationState, AppError> {
    Ok(preparation_state())
}

#[tauri::command]
async fn retry_preparation() -> Result<PreparationState, AppError> {
    let app = android_app_handle().cloned();
    let state = {
        let mut guard = preparation_store()
            .state
            .lock()
            .expect("preparation state lock poisoned");
        reset_preparation_for_retry(&mut guard);
        guard.clone()
    };
    if let Some(app) = app {
        let _ = app.emit("preparation-state", state.clone());
    }

    #[cfg(target_os = "android")]
    {
        let result = match crate::diagnostics::bridge_string("retryPreparation") {
            Ok(result) => result,
            Err(error) => {
                let message = error.to_string();
                mark_preparation_failed(message.clone());
                return Err(AppError::Message(message));
            }
        };
        if result != "started" {
            let message = format!("App preparation retry was not started: {result}");
            mark_preparation_failed(message.clone());
            return Err(AppError::Message(message));
        }
    }

    Ok(state)
}

async fn bootstrap_snapshot(
    app: &AppHandle,
    state: &AppState,
    bundled_root: Option<&str>,
) -> Result<AppStateSnapshot, AppError> {
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Path(error.to_string()))?
        .join("configuration.json");
    let mut project = match bundled_root {
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
    welcome::defer_remote_announcements(&mut project.metadata);
    #[cfg(target_os = "android")]
    runtime::validate_ocr_models(&project.root, &project.resources)?;
    let stored = UserConfigurationStore::new(config_path.clone()).load(&project)?;
    let configuration = state.install(config_path, None, project, stored)?;
    let welcome_revision = state.current_welcome_revision();
    spawn_welcome_resolution(app.clone(), welcome_revision);
    runtime::apply_debug_mode(configuration.debug_mode);
    let environment = version::environment();
    Ok(AppStateSnapshot {
        versions: version::VersionInfo::new(environment),
        project: state.project().ok(),
        configuration,
        project_path: bundled_root.map(str::to_string),
        welcome_revision,
    })
}

fn spawn_welcome_resolution(app: AppHandle, revision: u64) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let Some(mut project) = state.project().ok() else {
            return;
        };
        if !project.metadata.welcome_pending {
            return;
        }

        welcome::resolve_project(&mut project).await;
        let payload = WelcomeState {
            revision,
            welcome: project.metadata.welcome.clone(),
            welcome_fingerprint: project.metadata.welcome_fingerprint.clone(),
            welcome_pending: project.metadata.welcome_pending,
            welcome_errors: project.metadata.welcome_errors.clone(),
        };
        if state.apply_welcome_state(revision, payload.clone()) {
            let _ = app.emit("welcome-state", payload);
        }
    });
}

fn current_snapshot(state: &AppState) -> AppStateSnapshot {
    AppStateSnapshot {
        versions: version::VersionInfo::new(version::environment()),
        project: state.project().ok(),
        configuration: state.configuration().unwrap_or_default(),
        project_path: state
            .project_path
            .read()
            .expect("project path lock poisoned")
            .as_deref()
            .map(|path| path.to_string_lossy().into_owned()),
        welcome_revision: state.current_welcome_revision(),
    }
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
const MAX_PROJECT_TEXT_BYTES: usize = 8 * 1024 * 1024;

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
fn read_project_text(state: State<'_, AppState>, path: String) -> Result<String, AppError> {
    let project = state.project()?;
    read_scoped_project_text(Path::new(&project.root), &path)
}

fn read_scoped_project_text(root: &Path, relative: &str) -> Result<String, AppError> {
    let text_path = project_text_path(root, relative)?;
    if std::fs::metadata(&text_path)?.len() > MAX_PROJECT_TEXT_BYTES as u64 {
        return Err(AppError::Message(
            "The Project Interface text file exceeds the size limit".to_string(),
        ));
    }

    let bytes = std::fs::read(&text_path)?;
    String::from_utf8(bytes)
        .map_err(|_| AppError::Message("Project Interface text files must be UTF-8".to_string()))
}

fn project_text_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    if relative.is_empty() {
        return Err(AppError::Message(
            "Project Interface text paths cannot be empty".to_string(),
        ));
    }

    let relative_path = Path::new(relative);
    let mut depth = 0usize;
    let mut safe_components = true;
    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(_) => depth += 1,
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if depth == 0 {
                    safe_components = false;
                } else {
                    depth -= 1;
                }
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                safe_components = false;
            }
        }
    }
    if !safe_components {
        return Err(AppError::Message(
            "Project Interface text paths must use a safe relative path".to_string(),
        ));
    }

    let root = root.canonicalize()?;
    let text_path = root.join(relative_path).canonicalize()?;
    if !text_path.starts_with(&root) {
        return Err(AppError::Message(
            "Project Interface text paths must stay inside the project".to_string(),
        ));
    }
    Ok(text_path)
}

#[tauri::command]
async fn load_project(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    language: Option<String>,
) -> Result<AppStateSnapshot, AppError> {
    let _preparation_guard = state.preparation_task.lock().await;
    let preferred_language = language.unwrap_or_else(|| "zh_cn".to_string());
    let mut project = ProjectLoader::default().load(&path, &preferred_language)?;
    welcome::defer_remote_announcements(&mut project.metadata);
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
    let welcome_revision = state.current_welcome_revision();
    spawn_welcome_resolution(app, welcome_revision);
    let environment = version::environment();
    Ok(AppStateSnapshot {
        versions: version::VersionInfo::new(environment),
        project: state.project().ok(),
        configuration,
        project_path: Some(path),
        welcome_revision,
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
    #[cfg(target_os = "android")]
    let _ = set_virtual_display_touch_markers(configuration.show_virtual_display_touches);
    configure_telemetry(&project, &configuration);
    runtime::apply_debug_mode(configuration.debug_mode);
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
    run.tasks = configuration_tasks_from_preset(&project, &preset, &existing_tasks);
    state.set_configuration(configuration.clone())?;
    Ok(configuration)
}

/// Rebuilds one run configuration from a preset.
///
/// MXU semantics: the preset's `task` array is the run order the profile author
/// intended ("start the game, then …"), so it becomes the configuration order.
/// Tasks the preset never mentions keep their place afterwards, and existing
/// instance ids are reused so per-task UI state survives applying a preset.
fn configuration_tasks_from_preset(
    project: &Project,
    preset: &ConfigurationTemplate,
    existing: &[ConfiguredTask],
) -> Vec<ConfiguredTask> {
    let instance_id = |task_name: &str| {
        existing
            .iter()
            .find(|item| item.task_name == task_name)
            .map(|item| item.instance_id.clone())
            .unwrap_or_else(|| format!("{task_name}:{}", Uuid::new_v4()))
    };

    let mut tasks: Vec<ConfiguredTask> = preset
        .tasks
        .iter()
        .filter_map(|item| {
            let task = project
                .tasks
                .iter()
                .find(|task| task.name == item.task_name)?;
            Some(ConfiguredTask {
                instance_id: instance_id(&task.name),
                task_name: task.name.clone(),
                enabled: item.enabled,
                option_values: item.option.clone(),
                custom_label: (item.label != task.name).then(|| item.label.clone()),
            })
        })
        .collect();
    for task in &project.tasks {
        if tasks.iter().any(|item| item.task_name == task.name) {
            continue;
        }
        tasks.push(ConfiguredTask {
            instance_id: instance_id(&task.name),
            task_name: task.name.clone(),
            enabled: task.default_check,
            option_values: BTreeMap::new(),
            custom_label: None,
        });
    }
    tasks
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
    let backend = PrivilegedBackend::parse(runtime::privileged_backend());
    match state {
        3 => Ok(PrivilegedStatus::Connected {
            message: "The privileged control unit is connected".to_string(),
            backend,
        }),
        2 => Ok(PrivilegedStatus::PermissionRequired {
            message,
            setup_required: privileged_setup_steps(backend, 2),
            backend,
        }),
        1 => Ok(PrivilegedStatus::NotInstalled {
            message,
            setup_required: privileged_setup_steps(backend, 1),
            backend,
        }),
        4 => Ok(PrivilegedStatus::Disconnected {
            message,
            setup_required: privileged_setup_steps(backend, 4),
            backend,
        }),
        5 => Ok(PrivilegedStatus::Error {
            message,
            setup_required: privileged_setup_steps(backend, 5),
            backend,
        }),
        _ => Ok(PrivilegedStatus::Starting {
            message,
            setup_required: privileged_setup_steps(backend, 0),
            backend,
        }),
    }
}

fn privileged_setup_steps(backend: PrivilegedBackend, state: i64) -> Vec<String> {
    if backend == PrivilegedBackend::Root {
        return vec![match state {
            0 => "Wait for the root control unit to connect".to_string(),
            4 => "Request root access again".to_string(),
            5 => "Check the root prompt and the Android service logs".to_string(),
            _ => "Grant root access in the su prompt".to_string(),
        }];
    }
    vec![match state {
        0 => "Wait for the control unit to connect".to_string(),
        1 => "Install or start Shizuku".to_string(),
        4 => "Restart Shizuku and reopen MaaTauriAndroid".to_string(),
        5 => "Check Shizuku and the Android service logs".to_string(),
        _ => "Grant MaaTauriAndroid access in Shizuku".to_string(),
    }]
}

#[tauri::command]
fn get_privileged_backend() -> Result<PrivilegedBackend, AppError> {
    Ok(PrivilegedBackend::parse(runtime::privileged_backend()))
}

#[tauri::command]
fn set_privileged_backend(backend: PrivilegedBackend) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        if call_runtime_bridge_string_with_string("switchPrivilegedBackend", backend.as_str())? {
            runtime::set_privileged_backend(backend.as_str());
            Ok(())
        } else {
            Err(AppError::Message(match backend {
                PrivilegedBackend::Root => "Root access was denied or timed out".to_string(),
                PrivilegedBackend::Shizuku => {
                    "The Shizuku control unit could not be connected".to_string()
                }
            }))
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        Err(AppError::Message(
            "The privileged backend can only be switched on Android".to_string(),
        ))
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

#[cfg(target_os = "android")]
fn cleanup_virtual_display_on_exit() {
    if let Err(error) = stop_virtual_display() {
        log::warn!("Could not stop the virtual display on exit: {error}");
    }
}

#[cfg(not(target_os = "android"))]
fn cleanup_virtual_display_on_exit() {}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn virtual_display_dimensions(portrait: bool) -> (i32, i32) {
    if portrait {
        (720, 1280)
    } else {
        (1280, 720)
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

#[tauri::command]
fn set_virtual_display_landscape(enabled: bool) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        if call_runtime_bridge_boolean_with_bool("setVirtualDisplayLandscape", enabled)? {
            Ok(())
        } else {
            Err(AppError::Message(
                "The host activity is unavailable for fullscreen orientation".to_string(),
            ))
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
fn virtual_display_touch(
    display_id: i32,
    action: i32,
    x: i32,
    y: i32,
    contact: i32,
) -> Result<VirtualDisplayTouchResult, AppError> {
    let status = virtual_display_status()?;
    validate_virtual_display_touch(&status, action, x, y, contact)?;

    #[cfg(target_os = "android")]
    {
        let code = call_runtime_bridge_touch(display_id, action, x, y, contact)?;
        if code == 0 {
            Ok(VirtualDisplayTouchResult {
                accepted: true,
                code,
                message: "Input accepted".to_string(),
            })
        } else {
            Err(AppError::Message(virtual_display_touch_rejection_message(
                code,
            )))
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (display_id, action, x, y, contact);
        Err(AppError::Message(
            "The virtual display can only be touched on Android".to_string(),
        ))
    }
}

#[tauri::command]
fn virtual_display_back() -> Result<(), AppError> {
    let status = virtual_display_status()?;
    validate_virtual_display_back(&status)?;

    #[cfg(target_os = "android")]
    {
        const KEYCODE_BACK: i32 = 4;
        const METHOD_KEY_DOWN: i32 = 9;
        const METHOD_KEY_UP: i32 = 10;
        for method in [METHOD_KEY_DOWN, METHOD_KEY_UP] {
            let code = call_runtime_bridge_key(status.display_id, KEYCODE_BACK, method)?;
            if code != 0 {
                return Err(AppError::Message(virtual_display_key_rejection_message(
                    code,
                )));
            }
        }
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    Err(AppError::Message(
        "The virtual display can only be controlled on Android".to_string(),
    ))
}

fn validate_virtual_display_back(status: &VirtualDisplayStatus) -> Result<(), AppError> {
    if !status.active {
        return Err(AppError::Message(
            "The virtual display is not active".to_string(),
        ));
    }
    Ok(())
}

fn validate_virtual_display_touch(
    status: &VirtualDisplayStatus,
    action: i32,
    x: i32,
    y: i32,
    contact: i32,
) -> Result<(), AppError> {
    if !status.active {
        return Err(AppError::Message(
            "The virtual display is not active".to_string(),
        ));
    }
    if !matches!(action, 6 | 7 | 8) {
        return Err(AppError::Message(
            "Only virtual display touch down, move, and up are supported".to_string(),
        ));
    }
    if !(0..=15).contains(&contact) {
        return Err(AppError::Message(
            "The virtual display touch contact must be between 0 and 15".to_string(),
        ));
    }
    if x < 0 || y < 0 || x >= status.width || y >= status.height {
        return Err(AppError::Message(
            "The virtual display touch coordinates are outside the display".to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
fn set_virtual_display_touch_markers(
    enabled: bool,
) -> Result<Vec<VirtualDisplayTouchMarker>, AppError> {
    #[cfg(target_os = "android")]
    {
        let values =
            call_runtime_bridge_method_with_boolean("setVirtualDisplayTouchMarkers", enabled)?;
        return parse_virtual_display_touch_markers(&values);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = enabled;
        Ok(Vec::new())
    }
}

fn parse_virtual_display_touch_markers(
    values: &[i32],
) -> Result<Vec<VirtualDisplayTouchMarker>, AppError> {
    if values.len() % 5 != 0 {
        return Err(AppError::Message(
            "The virtual display touch marker data is incomplete".to_string(),
        ));
    }

    Ok(values
        .chunks_exact(5)
        .map(|marker| VirtualDisplayTouchMarker {
            id: marker[0],
            x: marker[1],
            y: marker[2],
            action: marker[3],
            contact: marker[4],
        })
        .collect())
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_method_with_boolean(
    method: &'static str,
    enabled: bool,
) -> Result<Vec<i32>, AppError> {
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
            method,
            "(Z)[I",
            &[jni::objects::JValue::Bool(enabled as u8)],
        )
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

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn virtual_display_key_rejection_message(code: i32) -> String {
    match code {
        -4 => "Android rejected the virtual display back-key injection".to_string(),
        -7 => "The privileged control service is unavailable for the virtual display back key"
            .to_string(),
        _ => format!("The virtual display back-key command failed with result {code}"),
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn virtual_display_touch_rejection_message(code: i32) -> String {
    match code {
        -1 => "The virtual display touch contact is invalid".to_string(),
        -2 => "The virtual display touch contact is not part of the active gesture".to_string(),
        -3 => "The virtual display touch gesture has no active contacts".to_string(),
        -4 => "Android rejected the virtual display touch injection".to_string(),
        -5 => "The virtual display touch method is not supported".to_string(),
        -6 => "The privileged shell command for the virtual display touch failed".to_string(),
        -7 => "The privileged control service is unavailable for virtual display touch".to_string(),
        _ => format!("The virtual display touch command failed with result {code}"),
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
pub(crate) fn call_runtime_bridge_float(method: &'static str) -> Result<f32, AppError> {
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
        .call_static_method(bridge_class, method, "()F", &[])
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .f()
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_string_with_string(
    method: &'static str,
    value: &str,
) -> Result<bool, AppError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        AppError::Message("the Java runtime has not been initialized".to_string())
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let _ = env.exception_clear();
    let java_value = env
        .new_string(value)
        .map_err(|error| AppError::Message(error.to_string()))?;
    let result = env
        .call_static_method(
            bridge_class,
            method,
            "(Ljava/lang/String;)Z",
            &[jni::objects::JValue::Object(&java_value)],
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .z()
        .map_err(|error| AppError::Message(error.to_string()))
}

fn stop_run_foreground_service() {
    #[cfg(target_os = "android")]
    {
        let _ = call_runtime_bridge_boolean("stopRunForegroundService");
    }
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn sync_schedule_alarms() -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        if call_runtime_bridge_boolean("syncScheduleAlarms")? {
            Ok(())
        } else {
            Err(AppError::Message(
                "The Android alarm service rejected the schedule update".to_string(),
            ))
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn list_schedule_rules(
    state: State<'_, AppState>,
) -> Result<Vec<schedule::ScheduleRuleStatus>, AppError> {
    state.schedule_store()?.list().map_err(AppError::from)
}

#[tauri::command]
fn save_schedule_rule(
    state: State<'_, AppState>,
    rule: schedule::ScheduleRule,
) -> Result<schedule::ScheduleRule, AppError> {
    let saved = state.schedule_store()?.save(rule).map_err(AppError::from)?;
    sync_schedule_alarms()?;
    Ok(saved)
}

#[tauri::command]
fn delete_schedule_rule(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state
        .schedule_store()?
        .delete(&id)
        .map_err(AppError::from)?;
    sync_schedule_alarms()
}

#[tauri::command]
fn set_schedule_rule_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<schedule::ScheduleRule, AppError> {
    let saved = state
        .schedule_store()?
        .set_enabled(&id, enabled)
        .map_err(AppError::from)?;
    sync_schedule_alarms()?;
    Ok(saved)
}

#[tauri::command]
fn get_schedule_status(state: State<'_, AppState>) -> Result<schedule::ScheduleSummary, AppError> {
    state.schedule_store()?.summary().map_err(AppError::from)
}

#[cfg(target_os = "android")]
fn preempt_running_run(state: &AppState) -> Result<bool, AppError> {
    if state.maa.status() == runtime::RunState::Idle {
        return Ok(true);
    }
    state.maa.request_stop(None).map_err(AppError::from)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        if state.maa.status() == runtime::RunState::Idle {
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(false)
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_boolean_with_bool(
    method: &'static str,
    value: bool,
) -> Result<bool, AppError> {
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
            method,
            "(Z)Z",
            &[jni::objects::JValue::Bool(u8::from(value))],
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .z()
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_touch(
    display_id: i32,
    action: i32,
    x: i32,
    y: i32,
    contact: i32,
) -> Result<i32, AppError> {
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
            "dispatchVirtualDisplayTouch",
            "(IIIII)I",
            &[
                jni::objects::JValue::Int(display_id),
                jni::objects::JValue::Int(action),
                jni::objects::JValue::Int(x),
                jni::objects::JValue::Int(y),
                jni::objects::JValue::Int(contact),
            ],
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .i()
        .map_err(|error| AppError::Message(error.to_string()))
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_key(display_id: i32, key_code: i32, method: i32) -> Result<i32, AppError> {
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
            "dispatchVirtualDisplayKey",
            "(III)I",
            &[
                jni::objects::JValue::Int(display_id),
                jni::objects::JValue::Int(key_code),
                jni::objects::JValue::Int(method),
            ],
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    result
        .i()
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
        let backend = PrivilegedBackend::parse(runtime::privileged_backend());
        Err(AppError::Message(virtual_display_rejection_message(
            state, &status, backend,
        )))
    }
}

/// Maps a failed virtual display start to the most actionable message. The
/// JNI bridge returns a bare boolean, so the reported control service state
/// is the only available explanation; a connected service keeps the generic
/// rejection wording.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn virtual_display_rejection_message(
    state: i64,
    status: &str,
    backend: PrivilegedBackend,
) -> String {
    if backend == PrivilegedBackend::Root {
        return match state {
            // The service is connected, so the refusal happened on its side.
            3 => "The privileged control service rejected the virtual display".to_string(),
            4 => "The root control service disconnected; request root access again, then try again"
                .to_string(),
            5 => format!("{status}; check the root prompt and the app logs, then try again"),
            _ => format!("{status}; try again shortly"),
        };
    }

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
pub(crate) fn call_runtime_bridge_int_array(method: &'static str) -> Result<Vec<i32>, AppError> {
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

#[cfg(target_os = "android")]
async fn reinstall_project_interface(app: &AppHandle) -> Result<AppStateSnapshot, AppError> {
    let state: State<'_, AppState> = app.state();
    if state.maa.status() != runtime::RunState::Idle {
        return Err(AppError::Message(
            "a run is active; stop it before reinstalling resources".to_string(),
        ));
    }
    let _storage_guard = state.run_storage.lock().await;
    let _preparation_guard = state.preparation_task.lock().await;
    set_preparation_stage("reinstallingResources");
    let root =
        call_runtime_bridge_optional_string("reinstallProjectInterface")?.ok_or_else(|| {
            AppError::Message(
                "the packaged Project Interface resources are unavailable".to_string(),
            )
        })?;
    let result = reload_project(&root, "zh_cn", app).await;
    match result {
        Ok(snapshot) => {
            mark_preparation_ui_ready().map_err(AppError::Message)?;
            Ok(snapshot)
        }
        Err(error) => {
            mark_preparation_failed(error.to_string());
            Err(error)
        }
    }
}

#[cfg(target_os = "android")]
async fn reload_project(
    root: &str,
    language: &str,
    app: &AppHandle,
) -> Result<AppStateSnapshot, AppError> {
    let state: State<'_, AppState> = app.state();
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Path(error.to_string()))?
        .join("configuration.json");
    let mut project =
        ProjectLoader::default().load(PathBuf::from(root).join("interface.json"), language)?;
    welcome::defer_remote_announcements(&mut project.metadata);
    runtime::validate_ocr_models(&project.root, &project.resources)?;
    let stored = UserConfigurationStore::new(config_path.clone()).load(&project)?;
    let configuration = state.install(config_path, None, project, stored)?;
    let welcome_revision = state.current_welcome_revision();
    spawn_welcome_resolution(app.clone(), welcome_revision);
    runtime::apply_debug_mode(configuration.debug_mode);
    Ok(AppStateSnapshot {
        versions: version::VersionInfo::new(version::environment()),
        project: state.project().ok(),
        configuration,
        project_path: Some(root.to_string()),
        welcome_revision,
    })
}

#[cfg(not(target_os = "android"))]
async fn reinstall_project_interface(_app: &AppHandle) -> Result<AppStateSnapshot, AppError> {
    Err(AppError::Message(
        "resource reinstall is only available on Android".to_string(),
    ))
}

#[tauri::command]
async fn reinstall_resources(app: AppHandle) -> Result<AppStateSnapshot, AppError> {
    reinstall_project_interface(&app).await
}

#[cfg(target_os = "android")]
fn call_runtime_bridge_optional_string_with_int(
    method: &'static str,
    value: i32,
) -> Result<Option<String>, AppError> {
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
            method,
            "(I)Ljava/lang/String;",
            &[jni::objects::JValue::Int(value)],
        )
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

/// One display-state snapshot for run diagnostics, or `None` when the
/// privileged service cannot be asked (a binder failure) — the diagnosis then
/// stays silent.
#[cfg(target_os = "android")]
pub(crate) fn probe_target_app_state() -> Option<run_diagnosis::TargetAppState> {
    let raw = call_runtime_bridge_optional_string_with_int(
        "targetAppState",
        runtime::active_display_id() as i32,
    )
    .ok()
    .flatten()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(not(target_os = "android"))]
pub(crate) fn probe_target_app_state() -> Option<run_diagnosis::TargetAppState> {
    None
}

/// Terminates a run that is still inside `begin_preparing`: appends the
/// terminal Failure event, resets the execution result to Idle, and reports
/// telemetry. Must be called from within `MaaSessions::finish_with` so the
/// preparing lease returns to Idle; otherwise every later start and stop
/// stays wedged on the preparing lease and the run controls never recover.
fn abort_preparing_run(app: &AppHandle, logger: &run_log::RunLogger, message: String) {
    stop_run_foreground_service();
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
async fn start_run_core(
    app: AppHandle,
    state: &AppState,
    run_configuration_id: Option<String>,
    scheduled_trigger: Option<(String, i64)>,
    task_selection: Option<TaskRunSelection>,
) -> Result<StartRunStatus, AppError> {
    #[cfg(target_os = "android")]
    {
        let preparation = preparation_state();
        if !preparation.ui_ready || !preparation.engine_ready {
            return Err(AppError::Message(
                "The app engine is still preparing; try again when preparation finishes"
                    .to_string(),
            ));
        }
    }
    if let Some((rule_id, scheduled_epoch_ms)) = scheduled_trigger.clone() {
        if state.maa.status() != runtime::RunState::Idle {
            state
                .schedule_store()?
                .record_trigger(schedule::ScheduleTriggerLogEntry {
                    rule_id,
                    scheduled_epoch_ms,
                    actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                    result: schedule::ScheduleTriggerResult::RejectedActive,
                    detail: Some("Another run is active or finishing".to_string()),
                })?;
            return Err(AppError::Message("Another run is active".to_string()));
        }
    }
    let project = state.project()?;
    let mut configuration = state.configuration()?;
    let run_configuration_id = task_selection
        .as_ref()
        .map(|selection| selection.run_configuration_id.clone())
        .or(run_configuration_id);
    if let Some(requested_id) = run_configuration_id.as_deref() {
        if !configuration
            .run_configurations
            .iter()
            .any(|run| run.id == requested_id)
        {
            return Err(AppError::Message(
                "The scheduled run configuration no longer exists".to_string(),
            ));
        }
        configuration.active_run_configuration_id = Some(requested_id.to_string());
    }
    let resolved = resolve_run(&project, &configuration)?;
    let tasks = startup_tasks(&resolved.tasks, task_selection.as_ref())?;
    let task_count = tasks.len();
    if task_count == 0 {
        if let Some((rule_id, scheduled_epoch_ms)) = scheduled_trigger {
            state
                .schedule_store()?
                .record_trigger(schedule::ScheduleTriggerLogEntry {
                    rule_id,
                    scheduled_epoch_ms,
                    actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                    result: schedule::ScheduleTriggerResult::FailedValidation,
                    detail: Some("There are no enabled tasks to run".to_string()),
                })?;
        }
        return Ok(StartRunStatus {
            execution_id: String::new(),
            message: "There are no enabled tasks to run".to_string(),
            task_count,
        });
    }

    let execution_id = Uuid::new_v4().to_string();
    let runs_dir = state.runs_dir()?;
    let _lifecycle_guard = state.run_storage.lock().await;
    let logger = Arc::new(run_log::RunLogger::create(
        &runs_dir,
        &execution_id,
        task_count,
    )?);
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
        if let Some((rule_id, scheduled_epoch_ms)) = scheduled_trigger.as_ref() {
            if let Ok(store) = state.schedule_store() {
                let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
                    rule_id: rule_id.clone(),
                    scheduled_epoch_ms: *scheduled_epoch_ms,
                    actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                    result: schedule::ScheduleTriggerResult::FailedServiceStart,
                    detail: Some(message.clone()),
                });
            }
        }
        state.maa.finish_with(&execution_id, || {
            abort_preparing_run(&app, &logger, message.clone());
        });
        AppError::Message(message)
    };

    // MaaFramework caches the display ID on its controller, so the virtual
    // display must exist before session creation and before any StartApp task.
    #[cfg(target_os = "android")]
    {
        if configuration.foreground_mode {
            // The bridge resets the native control context and screen metrics to
            // the physical primary display, so display 0 becomes a valid target.
            if let Err(error) = call_runtime_bridge_boolean("stopVirtualDisplay") {
                return Err(fail_preparing(error.to_string()));
            }
        } else {
            let portrait = match call_runtime_bridge_boolean("isVirtualDisplayPortrait") {
                Ok(portrait) => portrait,
                Err(error) => return Err(fail_preparing(error.to_string())),
            };
            let (width, height) = virtual_display_dimensions(portrait);
            if let Err(error) = call_runtime_bridge_start_virtual_display(width, height, 160) {
                return Err(fail_preparing(error.to_string()));
            }
        }
        if !call_runtime_bridge_boolean("startRunForegroundService")? {
            if let Some((rule_id, scheduled_epoch_ms)) = scheduled_trigger.as_ref() {
                if let Ok(store) = state.schedule_store() {
                    let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
                        rule_id: rule_id.clone(),
                        scheduled_epoch_ms: *scheduled_epoch_ms,
                        actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                        result: schedule::ScheduleTriggerResult::ForegroundServiceDenied,
                        detail: Some("Android rejected the run foreground service".to_string()),
                    });
                }
            }
            let _ = logger.append(
                run_log::RunEventKind::Warning,
                runtime::RunState::Preparing,
                "The run foreground service could not be started".to_string(),
                None,
                None,
            );
        }
        // Best-effort: without POST_NOTIFICATIONS the FGS still runs, the
        // progress notification just stays hidden until the user grants it.
        let _ = call_runtime_bridge_boolean("ensureNotificationPermission");
        if !configuration.foreground_mode && configuration.show_virtual_display_touches {
            let _ = set_virtual_display_touch_markers(true);
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
    if controller_display_id == 0 && !configuration.foreground_mode {
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
    let selected_instance_ids: BTreeSet<String> = tasks
        .iter()
        .filter_map(|task| {
            task.configured
                .as_ref()
                .map(|item| item.instance_id.clone())
        })
        .collect();
    let task_snapshot = diagnostics::build_run_task_snapshot(
        &project,
        &resolved.tasks,
        &selected_instance_ids,
        run_configuration_id.clone(),
    );
    let force_stop_target_app = configuration.force_stop_target_app;
    let close_target_app_after_run = configuration.close_target_app_after_run;
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
        // Watches the game's health on the controlled display for the whole
        // run: samples FPS once per second, polls the target app state once
        // per second, and stops the run early on target exit or display
        // loss. The guard stops the watcher on every exit path.
        let _supervisor = run_supervisor::SupervisorGuard::start(
            &app,
            logger_for_run.clone(),
            sessions.clone(),
            &run_execution_id,
            controller_display_id,
        );
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
                if let Err(error) = tasker.add_context_event_sink(Box::new(focus::FocusSink::new(
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
                if let Err(error) = tasker.add_context_event_sink(Box::new(run_diagnosis::DiagSink))
                {
                    if let Ok(event) = logger_for_run.append(
                        run_log::RunEventKind::Warning,
                        runtime::RunState::Running,
                        format!("run diagnosis could not be registered: {error}"),
                        None,
                        None,
                    ) {
                        let _ = app.emit("run-event", &event);
                    }
                }
                // Enabled labels keep the existing run-history UI working;
                // the full resolved-task snapshot preserves the configured
                // choices and availability state for diagnostics.
                let task_labels: Vec<String> = tasks
                    .iter()
                    .map(|task| run_progress::task_progress_label(task).to_string())
                    .collect();
                let started_data = serde_json::json!({
                    "tasks": task_labels,
                    "taskSnapshot": task_snapshot,
                });
                if let Ok(event) = logger_for_run.append(
                    run_log::RunEventKind::Started,
                    runtime::RunState::Running,
                    "The run started".to_string(),
                    None,
                    Some(started_data),
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
                    let report_progress =
                        |done: u32, total: u32, task: &crate::domain::types::ResolvedTask| {
                            let payload = run_progress::progress_payload(
                                done,
                                total,
                                run_progress::task_progress_label(task),
                                None,
                            );
                            #[cfg(target_os = "android")]
                            if let Err(error) = call_runtime_bridge_string_with_string(
                                "updateRunProgress",
                                &payload,
                            ) {
                                log::warn!(
                                    "Could not update the run progress notification: {error}"
                                );
                            }
                            #[cfg(not(target_os = "android"))]
                            let _ = payload;
                        };
                    runtime::run_tasks(
                        &run_tasker,
                        &tasks,
                        &base_pipeline,
                        &task_logger,
                        &report_progress,
                        &probe_target_app_state,
                    )
                })
                .await;
                // Whatever the outcome, the run is over: a modal dialog left
                // unconfirmed must never block the next run's queue.
                focus::clear_pending_modals();
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
                // MaaFwApp semantics: only natural endings (completed or failed)
                // close the target app; a user stop changes nothing.
                //
                // Closing the app means tearing the display session down: the
                // target runs *on* the virtual display, so releasing the display
                // (owned by the run foreground service) is what closes it. With
                // the setting off the session — display, preview stream and target
                // app — stays alive until the user ends it from the display card.
                let should_close_target_app =
                    close_target_app_after_run && outcome.is_natural_end();
                let task_name = if let runtime::RunOutcome::Failed { task_name, .. } = &outcome {
                    Some(task_name.clone())
                } else {
                    None
                };
                let (kind, state, message, data, telemetry_message, outcome_label, attachment_path) =
                    match outcome {
                        runtime::RunOutcome::Completed => {
                            let message = "The run completed".to_string();
                            (
                                run_log::RunEventKind::Completed,
                                runtime::RunState::Idle,
                                message.clone(),
                                None,
                                message,
                                "completed",
                                None,
                            )
                        }
                        runtime::RunOutcome::Stopped => {
                            let message = "The run was stopped".to_string();
                            (
                                run_log::RunEventKind::Cancelled,
                                runtime::RunState::Idle,
                                message.clone(),
                                None,
                                message,
                                "stopped",
                                None,
                            )
                        }
                        runtime::RunOutcome::Failed {
                            entry,
                            task_name: _,
                            status,
                            diagnosis,
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
                                        format!(
                                            "failure screenshot could not be captured: {error}"
                                        ),
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
                            let (message, data) =
                                runtime::task_failed_event(&entry, &status, diagnosis.as_deref());
                            let telemetry_message = match &diagnosis {
                                Some(diagnosis) => format!("{message} {diagnosis}"),
                                None => message.clone(),
                            };
                            (
                                run_log::RunEventKind::Failure,
                                runtime::RunState::Idle,
                                message,
                                data,
                                telemetry_message,
                                "failed",
                                attachment_path,
                            )
                        }
                    };
                sessions.finish_with(&run_execution_id, || {
                    if should_close_target_app {
                        stop_run_foreground_service();
                    }
                    if let Ok(event) =
                        logger_for_run.append(kind, state, message.clone(), task_name, data)
                    {
                        let _ = app.emit("run-event", &event);
                    }
                    telemetry::run_event(
                        outcome_label,
                        &telemetry_message,
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
async fn start_run(
    app: AppHandle,
    state: State<'_, AppState>,
    task_selection: Option<TaskRunSelection>,
) -> Result<StartRunStatus, AppError> {
    start_run_core(app, state.inner(), None, None, task_selection).await
}

#[tauri::command]
fn run_status() -> Result<runtime::RunResult, AppError> {
    runtime::run_result()
        .ok_or_else(|| AppError::Message("No run has been started in this session".to_string()))
}

/// Acknowledges one `modal` focus message from the UI, releasing the run
/// queue gate that `run_tasks` waits on.
#[tauri::command]
fn resolve_focus_modal() {
    focus::resolve_modal_ack();
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
async fn export_logs(app: AppHandle, state: State<'_, AppState>) -> Result<LogExport, AppError> {
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
    let snapshots = match state.project_and_configuration() {
        Ok((project, configuration)) => Some(diagnostics::LogExportSnapshots {
            project,
            configuration,
        }),
        Err(_) => None,
    };
    let runs_dir = state.runs_dir().ok();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let output = exports_dir.join(format!("maa_tauri_android-logs-{timestamp}.zip"));
    let archive = tokio::task::spawn_blocking(move || {
        let source = diagnostics::log_export_source();
        diagnostics::export_log_archive(&source, &roots, snapshots, runs_dir.as_deref(), output)
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
fn restart_app(app: AppHandle) -> Result<(), AppError> {
    // Tauri's `restart` only respawns the current binary, which works on
    // desktop; on Android the relaunch must go through the Kotlin bridge.
    #[cfg(target_os = "android")]
    {
        let _ = &app;
        runtime::restart_app()?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        app.restart();
    }
}

#[tauri::command]
async fn clear_diagnostic_data(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ClearedDiagnostics, AppError> {
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
    if let Some(maa_log_dir) = runtime::maa_log_dir().map(Path::to_path_buf) {
        let cleanup_maa_log_dir = maa_log_dir;
        tokio::task::spawn_blocking(move || diagnostics::clear_dir_contents(&cleanup_maa_log_dir))
            .await
            .map_err(|error| AppError::Message(error.to_string()))??;
        // MaaFramework keeps a stream open on the deleted log file; setting
        // the log directory again makes it recreate a fresh `maafw.log`.
        runtime::reconfigure_maa_logging();
    }
    let app_log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Path(error.to_string()))?;
    let cleanup_app_log_dir = app_log_dir;
    tokio::task::spawn_blocking(move || diagnostics::clear_dir_contents(&cleanup_app_log_dir))
        .await
        .map_err(|error| AppError::Message(error.to_string()))??;
    // The log plugin keeps the active file handle open and only reopens on
    // rotation (~1 MiB) or restart, so a bounded amount of logs written after
    // this point may be lost until then; an app restart fully resolves it.
    state.clear_latest_log();
    runtime::clear_run_result();
    Ok(ClearedDiagnostics {
        deleted_run_count,
        runs_dir: runs_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn list_run_history(
    state: State<'_, AppState>,
) -> Result<Vec<run_history::RunHistoryEntry>, AppError> {
    Ok(run_history::list(&state.runs_dir()?))
}

#[tauri::command]
fn read_run_history(
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<Vec<run_log::RunEvent>, AppError> {
    Ok(run_history::read(&state.runs_dir()?, &execution_id)?)
}

#[tauri::command]
async fn delete_run_history(
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<bool, AppError> {
    let runs_dir = state.runs_dir()?;
    // Holding the storage lock closes the race against a starting run:
    // `start_run_core` sets `latest_log` while still holding this lock, so a
    // run that is about to write history is always seen as active here.
    let _storage_guard = state.run_storage.lock().await;
    let latest = state.latest_log().ok();
    if run_history::is_active_run(
        latest.as_deref().map(|logger| logger.execution_id()),
        state.maa.status(),
        &execution_id,
    ) {
        return Err(AppError::Message(
            "cannot delete the running record".to_string(),
        ));
    }
    Ok(run_history::delete(&runs_dir, &execution_id)?)
}

#[tauri::command]
async fn cleanup_run_history(
    state: State<'_, AppState>,
    keep_days: Option<u32>,
) -> Result<usize, AppError> {
    let runs_dir = state.runs_dir()?;
    let latest = state.latest_log().ok();
    let latest_execution_id = latest
        .as_deref()
        .map(|logger| logger.execution_id().to_string());
    let status = state.maa.status();
    let _storage_guard = state.run_storage.lock().await;
    Ok(run_history::cleanup(
        &runs_dir,
        keep_days.unwrap_or(run_history::DEFAULT_KEEP_DAYS),
        |execution_id| {
            run_history::is_active_run(latest_execution_id.as_deref(), status, execution_id)
        },
    )?)
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
    RunHistory(#[from] run_history::RunHistoryError),
    #[error("{0}")]
    Diagnostic(#[from] diagnostics::DiagnosticError),
    #[error("{0}")]
    Schedule(#[from] schedule::ScheduleError),
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

    fn resolved_task(
        instance_id: &str,
        enabled: bool,
        unavailable_reason: Option<&str>,
    ) -> crate::domain::types::ResolvedTask {
        crate::domain::types::ResolvedTask {
            task: crate::domain::types::TaskDefinition {
                name: instance_id.to_string(),
                label: instance_id.to_string(),
                entry: instance_id.to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: Vec::new(),
                pipeline_override: serde_json::Value::Null,
                default_check: true,
                icon: None,
            },
            configured: Some(ConfiguredTask {
                instance_id: instance_id.to_string(),
                task_name: instance_id.to_string(),
                enabled,
                option_values: BTreeMap::new(),
                custom_label: None,
            }),
            enabled,
            unavailable_reason: unavailable_reason.map(str::to_string),
            pipeline_override: serde_json::Value::Null,
        }
    }

    fn selection(instance_id: &str, mode: TaskRunSelectionMode) -> TaskRunSelection {
        TaskRunSelection {
            run_configuration_id: "default".to_string(),
            instance_id: instance_id.to_string(),
            mode,
        }
    }

    fn selected_ids(tasks: &[crate::domain::types::ResolvedTask]) -> Vec<&str> {
        tasks
            .iter()
            .map(|task| task.configured.as_ref().unwrap().instance_id.as_str())
            .collect()
    }

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
            setting_sections: Vec::new(),
            tasks: Vec::new(),
            options: BTreeMap::new(),
            global_options: Vec::new(),
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: ProjectMetadata::default(),
        }
    }

    #[test]
    fn applying_a_preset_keeps_the_preset_order_instead_of_the_import_order() {
        let mut project = project();
        project.tasks = ["AndroidOpenGame", "SellProduct", "DailyRewards"]
            .iter()
            .map(|name| crate::domain::types::TaskDefinition {
                name: name.to_string(),
                label: name.to_string(),
                entry: name.to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: Vec::new(),
                pipeline_override: serde_json::Value::Null,
                default_check: false,
                icon: None,
            })
            .collect();
        let preset = ConfigurationTemplate {
            name: "DailyFull".to_string(),
            label: "Daily".to_string(),
            description: None,
            icon: None,
            tasks: vec![
                crate::domain::types::TemplateTask {
                    task_name: "DailyRewards".to_string(),
                    enabled: true,
                    option: BTreeMap::new(),
                    label: "DailyRewards".to_string(),
                },
                crate::domain::types::TemplateTask {
                    task_name: "AndroidOpenGame".to_string(),
                    enabled: true,
                    option: BTreeMap::new(),
                    label: "Start the game".to_string(),
                },
            ],
        };
        let existing = vec![ConfiguredTask {
            instance_id: "kept-instance".to_string(),
            task_name: "AndroidOpenGame".to_string(),
            enabled: true,
            option_values: BTreeMap::new(),
            custom_label: None,
        }];

        let tasks = configuration_tasks_from_preset(&project, &preset, &existing);

        let names: Vec<&str> = tasks.iter().map(|task| task.task_name.as_str()).collect();
        // Preset order first, then the tasks the preset never mentions.
        assert_eq!(
            names,
            vec!["DailyRewards", "AndroidOpenGame", "SellProduct"]
        );
        // A reused instance id keeps the per-task UI state attached.
        let game = tasks
            .iter()
            .find(|task| task.task_name == "AndroidOpenGame")
            .expect("the game task should survive");
        assert_eq!(game.instance_id, "kept-instance");
        assert_eq!(game.custom_label.as_deref(), Some("Start the game"));
        // Tasks left out of the preset fall back to their own default check.
        assert!(!tasks[2].enabled);
    }

    #[test]
    fn set_configuration_publishes_after_a_successful_save() {
        let root = std::env::temp_dir().join(format!("mta-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = AppState::default();
        state.set_project(None, project());
        let path = root.join("configuration.json");
        *state.store.write().expect("store lock poisoned") =
            Some(UserConfigurationStore::new(path.clone()));

        let configuration = UserConfiguration::default();
        state.set_configuration(configuration.clone()).unwrap();

        assert_eq!(state.configuration().unwrap(), configuration);
        assert!(path.is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn set_configuration_failure_keeps_the_previous_configuration() {
        let root = std::env::temp_dir().join(format!("mta-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = AppState::default();
        state.set_project(None, project());
        let path = root.join("configuration.json");
        *state.store.write().expect("store lock poisoned") =
            Some(UserConfigurationStore::new(path.clone()));
        let configuration = UserConfiguration::default();
        state.set_configuration(configuration.clone()).unwrap();

        let blocker = root.join("not-a-directory");
        std::fs::write(&blocker, b"blocked").unwrap();
        *state.store.write().expect("store lock poisoned") = Some(UserConfigurationStore::new(
            blocker.join("configuration.json"),
        ));

        let error = state
            .set_configuration(UserConfiguration::default())
            .unwrap_err();
        assert!(matches!(error, PersistenceError::CreateDirectory { .. }));
        assert_eq!(state.configuration().unwrap(), configuration);
        assert!(path.is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_asset_path_allows_images_inside_the_project() {
        let root = std::env::temp_dir().join(format!("mta-asset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::write(root.join("images/example.png"), b"png").unwrap();

        let asset = project_asset_path(&root, "images/example.png").unwrap();
        assert!(asset.ends_with("images/example.png"));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_tasks_without_selection_keeps_only_runnable_tasks() {
        let tasks = vec![
            resolved_task("first", true, None),
            resolved_task("disabled", false, None),
            resolved_task("unavailable", true, Some("wrong resource")),
            resolved_task("last", true, None),
        ];

        let selected = startup_tasks(&tasks, None).unwrap();

        assert_eq!(selected_ids(&selected), ["first", "last"]);
    }

    #[test]
    fn startup_tasks_can_run_only_the_selected_instance() {
        let tasks = vec![
            resolved_task("first", true, None),
            resolved_task("selected", true, None),
            resolved_task("last", true, None),
        ];

        let selected = startup_tasks(
            &tasks,
            Some(&selection("selected", TaskRunSelectionMode::Current)),
        )
        .unwrap();

        assert_eq!(selected_ids(&selected), ["selected"]);
    }

    #[test]
    fn startup_tasks_can_run_the_selected_instance_and_later_runnable_tasks() {
        let tasks = vec![
            resolved_task("first", true, None),
            resolved_task("selected", true, None),
            resolved_task("disabled", false, None),
            resolved_task("unavailable", true, Some("wrong resource")),
            resolved_task("last", true, None),
        ];

        let selected = startup_tasks(
            &tasks,
            Some(&selection(
                "selected",
                TaskRunSelectionMode::CurrentAndFollowing,
            )),
        )
        .unwrap();

        assert_eq!(selected_ids(&selected), ["selected", "last"]);
    }

    #[test]
    fn startup_tasks_reject_missing_or_unrunnable_selections() {
        let tasks = vec![
            resolved_task("disabled", false, None),
            resolved_task("unavailable", true, Some("wrong resource")),
        ];

        let missing = startup_tasks(
            &tasks,
            Some(&selection("missing", TaskRunSelectionMode::Current)),
        );
        let disabled = startup_tasks(
            &tasks,
            Some(&selection("disabled", TaskRunSelectionMode::Current)),
        );
        let unavailable = startup_tasks(
            &tasks,
            Some(&selection(
                "unavailable",
                TaskRunSelectionMode::CurrentAndFollowing,
            )),
        );

        assert!(missing.is_err());
        assert!(disabled.is_err());
        assert!(unavailable.is_err());
    }

    #[test]
    fn task_run_selection_parses_camel_case_ipc_payload() {
        let selection: TaskRunSelection = serde_json::from_str(
            r#"{
                "runConfigurationId": "default",
                "instanceId": "task-2",
                "mode": "currentAndFollowing"
            }"#,
        )
        .unwrap();

        assert_eq!(selection.run_configuration_id, "default");
        assert_eq!(selection.instance_id, "task-2");
        assert!(matches!(
            selection.mode,
            TaskRunSelectionMode::CurrentAndFollowing
        ));
    }

    #[test]
    fn project_asset_path_rejects_unsafe_and_non_image_paths() {
        let root = std::env::temp_dir().join(format!("mta-asset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::write(root.join("images/example.png"), b"png").unwrap();

        assert!(project_asset_path(&root, "images/example.txt").is_err());
        assert!(project_asset_path(&root, "/images/example.png").is_err());
        assert!(project_asset_path(&root, "../images/example.png").is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_text_path_reads_only_files_inside_the_project() {
        let root = std::env::temp_dir().join(format!("mta-text-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("locale")).unwrap();
        std::fs::write(root.join("locale/interface.jsonc"), "{\"name\":\"x\"}").unwrap();

        let path = project_text_path(&root, "locale/interface.jsonc").unwrap();
        assert!(path.ends_with("locale/interface.jsonc"));
        assert!(project_text_path(&root, "./locale/interface.jsonc")
            .unwrap()
            .ends_with("locale/interface.jsonc"));
        assert!(project_text_path(&root, "locale/../locale/interface.jsonc")
            .unwrap()
            .ends_with("locale/interface.jsonc"));
        assert!(project_text_path(&root, "").is_err());
        assert!(project_text_path(&root, "/etc/passwd").is_err());
        assert!(project_text_path(&root, "../outside.json").is_err());
        assert!(project_text_path(&root, "locale/../../outside.json").is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn project_text_path_rejects_symlinks_escaping_the_project() {
        let root = std::env::temp_dir().join(format!("mta-text-link-{}", uuid::Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("mta-text-outside-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, "outside").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("interface.json")).unwrap();

        assert!(project_text_path(&root, "interface.json").is_err());

        std::fs::remove_file(root.join("interface.json")).unwrap();
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_file(outside).unwrap();
    }

    #[test]
    fn scoped_project_text_rejects_missing_oversized_and_non_utf8_files() {
        let root = std::env::temp_dir().join(format!("mta-text-read-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();

        assert!(read_scoped_project_text(&root, "missing.json").is_err());

        let oversized = root.join("oversized.json");
        std::fs::File::create(&oversized)
            .unwrap()
            .set_len(MAX_PROJECT_TEXT_BYTES as u64 + 1)
            .unwrap();
        assert!(read_scoped_project_text(&root, "oversized.json").is_err());
        std::fs::remove_file(&oversized).unwrap();

        std::fs::write(root.join("invalid.json"), [0xff, 0xfe]).unwrap();
        assert!(read_scoped_project_text(&root, "invalid.json").is_err());

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
    fn native_preparation_update_parses_camel_case_json() {
        let update: NativePreparationUpdate = serde_json::from_str(
            r#"{
                "status": "running",
                "stage": "installingProject",
                "projectReady": true,
                "engineReady": false,
                "projectRoot": "/data/pi",
                "progress": {
                    "phase": "extracting",
                    "copiedBytes": 100,
                    "totalArchiveBytes": 100,
                    "extractedEntries": 2,
                    "totalEntries": 4,
                    "currentFile": "interface.json"
                }
            }"#,
        )
        .unwrap();

        assert_eq!(update.stage, "installingProject");
        assert!(update.project_ready);
        assert_eq!(update.project_root.as_deref(), Some("/data/pi"));
        let progress = update.progress.unwrap();
        assert_eq!(progress.phase, "extracting");
        assert_eq!(progress.extracted_entries, 2);
        assert_eq!(progress.current_file.as_deref(), Some("interface.json"));
    }

    #[test]
    fn later_native_preparation_updates_preserve_ui_readiness() {
        let mut current = PreparationState::default();
        current.revision = 8;
        current.ui_ready = true;
        current.project_root = Some("/data/pi".to_string());
        let update = NativePreparationUpdate {
            status: "running".to_string(),
            stage: "loadingRuntimeLibraries".to_string(),
            project_ready: true,
            engine_ready: false,
            project_root: None,
            progress: None,
            error: None,
        };

        apply_native_preparation(&mut current, update);

        assert_eq!(current.revision, 9);
        assert!(current.ui_ready);
        assert!(current.project_ready);
        assert_eq!(current.project_root.as_deref(), Some("/data/pi"));
    }

    #[test]
    fn engine_ready_native_update_maps_to_ready_status() {
        let mut current = PreparationState::default();
        let update = NativePreparationUpdate {
            status: "running".to_string(),
            stage: "engineReady".to_string(),
            project_ready: true,
            engine_ready: true,
            project_root: Some("/data/pi".to_string()),
            progress: None,
            error: None,
        };

        apply_native_preparation(&mut current, update);

        assert_eq!(current.status, "ready");
        assert_eq!(current.stage, "engineReady");
        assert!(current.engine_ready);
    }

    #[test]
    fn retry_reset_clears_preparation_and_advances_revision() {
        let mut current = PreparationState {
            revision: 8,
            status: "failed".to_string(),
            stage: "loadingRuntimeLibraries".to_string(),
            project_ready: true,
            ui_ready: true,
            engine_ready: true,
            project_root: Some("/data/pi".to_string()),
            progress: Some(PreparationProgress {
                phase: "extracting".to_string(),
                copied_bytes: 100,
                total_archive_bytes: 100,
                extracted_entries: 2,
                total_entries: 4,
                current_file: Some("interface.json".to_string()),
            }),
            error: Some("extract failed".to_string()),
        };

        reset_preparation_for_retry(&mut current);

        assert_eq!(current.revision, 9);
        assert_eq!(current.status, "running");
        assert_eq!(current.stage, "retrying");
        assert!(!current.project_ready);
        assert!(!current.ui_ready);
        assert!(!current.engine_ready);
        assert_eq!(current.project_root, None);
        assert_eq!(current.progress, None);
        assert_eq!(current.error, None);
    }

    #[test]
    fn normalize_configuration_preserves_welcome_fingerprint() {
        let mut project = project();
        project.metadata.welcome_fingerprint = Some("project".to_string());
        let mut configuration = UserConfiguration::default();
        configuration.welcome_fingerprint = Some("acknowledged".to_string());

        normalize_configuration(&project, &mut configuration);

        assert_eq!(
            configuration.welcome_fingerprint.as_deref(),
            Some("acknowledged")
        );
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
    #[cfg(not(target_os = "android"))]
    fn virtual_display_touch_is_unavailable_when_the_display_is_inactive() {
        let status = virtual_display_status().expect("the desktop status is available");
        assert!(matches!(
            virtual_display_touch(12, 6, 0, 0, 15),
            Err(AppError::Message(message)) if message == "The virtual display is not active"
        ));
        assert!(matches!(
            virtual_display_back(),
            Err(AppError::Message(message)) if message == "The virtual display is not active"
        ));
        assert!(validate_virtual_display_touch(&status, 6, 0, 0, 15).is_err());
    }

    #[test]
    fn virtual_display_back_is_valid_before_dispatch() {
        let status = VirtualDisplayStatus {
            active: true,
            display_id: 12,
            width: 1280,
            height: 720,
            frame_count: 0,
        };
        assert!(validate_virtual_display_back(&status).is_ok());

        let inactive = VirtualDisplayStatus {
            active: false,
            ..status
        };
        assert!(matches!(
            validate_virtual_display_back(&inactive),
            Err(AppError::Message(message)) if message == "The virtual display is not active"
        ));
    }

    #[test]
    fn virtual_display_touch_rejects_invalid_commands() {
        let status = VirtualDisplayStatus {
            active: true,
            display_id: 12,
            width: 1280,
            height: 720,
            frame_count: 0,
        };

        assert!(validate_virtual_display_touch(&status, 9, 0, 0, 15).is_err());
        assert!(validate_virtual_display_touch(&status, 6, 0, 0, -1).is_err());
        assert!(validate_virtual_display_touch(&status, 6, 0, 0, 16).is_err());
        assert!(validate_virtual_display_touch(&status, 6, -1, 0, 15).is_err());
        assert!(validate_virtual_display_touch(&status, 6, 1280, 0, 15).is_err());
        assert!(validate_virtual_display_touch(&status, 6, 0, 720, 15).is_err());
        assert!(validate_virtual_display_touch(&status, 6, 1279, 719, 15).is_ok());
    }

    #[test]
    fn virtual_display_touch_rejections_are_actionable() {
        assert_eq!(
            virtual_display_touch_rejection_message(-4),
            "Android rejected the virtual display touch injection"
        );
        assert_eq!(
            virtual_display_touch_rejection_message(-7),
            "The privileged control service is unavailable for virtual display touch"
        );
        assert_eq!(
            virtual_display_touch_rejection_message(-99),
            "The virtual display touch command failed with result -99"
        );
    }

    #[test]
    fn virtual_display_dimensions_follow_the_configured_orientation() {
        assert_eq!(virtual_display_dimensions(false), (1280, 720));
        assert_eq!(virtual_display_dimensions(true), (720, 1280));
    }

    #[test]
    fn virtual_display_touch_markers_are_parsed_in_field_groups() {
        let markers = parse_virtual_display_touch_markers(&[11, 24, 48, 0, 15, 12, 96, 120, 5, 0])
            .expect("complete marker data is available");

        assert_eq!(markers.len(), 2);
        assert_eq!(markers[0].id, 11);
        assert_eq!(markers[0].x, 24);
        assert_eq!(markers[0].y, 48);
        assert_eq!(markers[0].action, 0);
        assert_eq!(markers[0].contact, 15);
        assert_eq!(markers[1].action, 5);
    }

    #[test]
    fn incomplete_virtual_display_touch_markers_are_rejected() {
        assert!(matches!(
            parse_virtual_display_touch_markers(&[11, 24, 48, 0]),
            Err(AppError::Message(message))
                if message == "The virtual display touch marker data is incomplete"
        ));
    }

    #[test]
    fn virtual_display_rejection_names_the_missing_precondition() {
        assert_eq!(
            virtual_display_rejection_message(
                2,
                "Shizuku permission is required",
                PrivilegedBackend::Shizuku
            ),
            "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(
                1,
                "Shizuku is unavailable",
                PrivilegedBackend::Shizuku
            ),
            "Shizuku is unavailable; install or start Shizuku, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(
                4,
                "The privileged control unit disconnected",
                PrivilegedBackend::Shizuku
            ),
            "The privileged control service disconnected; restart Shizuku and reopen the app, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(
                5,
                "The privileged control unit failed to start",
                PrivilegedBackend::Shizuku
            ),
            "The privileged control unit failed to start; check Shizuku and the app logs, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(
                3,
                "The privileged control unit is connected",
                PrivilegedBackend::Shizuku
            ),
            "The privileged control service rejected the virtual display"
        );

        assert_eq!(
            virtual_display_rejection_message(
                4,
                "The privileged control unit disconnected",
                PrivilegedBackend::Root
            ),
            "The root control service disconnected; request root access again, then try again"
        );
        assert_eq!(
            virtual_display_rejection_message(
                5,
                "The privileged control unit failed to start",
                PrivilegedBackend::Root
            ),
            "The privileged control unit failed to start; check the root prompt and the app logs, then try again"
        );
    }

    #[test]
    fn privileged_backend_values_are_normalized() {
        assert_eq!(
            PrivilegedBackend::parse("shizuku"),
            PrivilegedBackend::Shizuku
        );
        assert_eq!(PrivilegedBackend::parse("root"), PrivilegedBackend::Root);
        assert_eq!(
            PrivilegedBackend::parse("unknown"),
            PrivilegedBackend::Shizuku
        );
        assert_eq!(PrivilegedBackend::Root.as_str(), "root");
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_initializeSecretBridge(
    env: *mut std::ffi::c_void,
    class: *mut std::ffi::c_void,
) -> jni::sys::jboolean {
    let Ok(mut env) = (unsafe { jni::JNIEnv::from_raw(env.cast()) }) else {
        eprintln!("Could not initialize the JNI environment for the secret bridge");
        return false.into();
    };
    let runtime_bridge_class = unsafe { jni::objects::JClass::from_raw(class.cast()) };
    if let Err(error) = runtime::initialize_secret_bridge(&mut env, &runtime_bridge_class) {
        eprintln!("Failed to initialize the secret bridge: {error}");
        return false.into();
    }
    true.into()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_reportPreparationState(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    state_json: *mut std::ffi::c_void,
) {
    let Ok(mut environment) = (unsafe { jni::JNIEnv::from_raw(env.cast()) }) else {
        return;
    };
    let raw_state = unsafe { jni::objects::JObject::from_raw(state_json.cast()) };
    let java_state = jni::objects::JString::from(raw_state);
    let Ok(state_json) = environment.get_string(&java_state) else {
        eprintln!("Failed to read the native preparation state");
        return;
    };
    let state_json = state_json.to_string_lossy().into_owned();
    match serde_json::from_str::<NativePreparationUpdate>(&state_json) {
        Ok(update) => report_native_preparation(update),
        Err(error) => eprintln!("Could not parse the native preparation state: {error}"),
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
    let root_backend = runtime::privileged_backend() == "root";
    let message = match state {
        1 if root_backend => "The root control unit is unavailable".to_string(),
        2 if root_backend => "Root permission is required".to_string(),
        1 => "Shizuku is unavailable".to_string(),
        2 => "Shizuku permission is required".to_string(),
        3 => "The privileged control unit is connected".to_string(),
        4 => "The privileged control unit disconnected".to_string(),
        5 => "The privileged control unit failed to start".to_string(),
        _ => "The privileged control unit is starting".to_string(),
    };
    runtime::set_control_state(state as i64, message);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_setPrivilegedBackend(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    backend: *mut std::ffi::c_void,
) {
    if let Ok(mut env) = unsafe { jni::JNIEnv::from_raw(env.cast()) } {
        let raw_backend = unsafe { jni::objects::JObject::from_raw(backend.cast()) };
        let backend = jni::objects::JString::from(raw_backend);
        match env.get_string(&backend) {
            Ok(backend) => {
                let backend = backend.to_string_lossy().into_owned();
                runtime::set_privileged_backend(&backend);
            }
            Err(error) => eprintln!("Failed to read the privileged backend: {error}"),
        };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(run_log::APPLICATION_LOG_FILE_STEM.to_string()),
                    }),
                ])
                // The fern dispatch gate is fixed at build time, so it stays at
                // the loosest level; the user-facing debug switch tightens the
                // effective level at runtime via `log::set_max_level` (see
                // `runtime::apply_debug_mode`).
                .level(log::LevelFilter::Debug)
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .manage(AppState::default())
        .manage(update::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            prepare_app,
            get_preparation_status,
            retry_preparation,
            window_insets,
            load_project,
            read_project_image,
            read_project_text,
            save_configuration,
            apply_preset,
            resolve_current,
            reset_task_parameters,
            privileged_status,
            get_privileged_backend,
            set_privileged_backend,
            request_privileged_access,
            open_shizuku,
            start_virtual_display,
            stop_virtual_display,
            virtual_display_status,
            virtual_display_stream,
            set_virtual_display_landscape,
            virtual_display_touch,
            virtual_display_back,
            set_virtual_display_touch_markers,
            start_run,
            run_status,
            stop_run,
            resolve_focus_modal,
            export_diagnostics,
            export_logs,
            capture_manual_screenshot,
            clear_diagnostic_data,
            reinstall_resources,
            restart_app,
            list_run_history,
            read_run_history,
            delete_run_history,
            cleanup_run_history,
            list_schedule_rules,
            save_schedule_rule,
            delete_schedule_rule,
            set_schedule_rule_enabled,
            get_schedule_status,
            update::update_get_status,
            update::update_check,
            update::update_resolve,
            update::update_cancel,
            update::update_install,
            update::update_get_prefs,
            update::update_set_prefs
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            install_panic_reporter();
            let root = app
                .path()
                .app_data_dir()
                .map_err(|error| AppError::Path(error.to_string()))?;
            state.set_runs_dir(root.join("runs"));
            state.set_schedule_data_dir(root.clone());
            #[cfg(target_os = "android")]
            {
                let _ = APP_HANDLE.set(app.handle().clone());
            }
            let maa_log_dir = root.join("maa-logs");
            let _ = std::fs::create_dir_all(&maa_log_dir);
            runtime::set_maa_log_dir(maa_log_dir);
            // The plugin registered its logger at the loosest level; info stays
            // the default until bootstrap applies the stored debug switch.
            runtime::apply_debug_mode(false);
            if let Ok(dirs) = update::resolve_dirs(app.handle()) {
                let update_state = app.state::<update::UpdateState>().inner().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    update_state.load_prefs(&dirs);
                });
            }
            // Plugins are initialized before `setup` runs, so the banner below is
            // the first record both log targets receive.
            log::info!("{}", version::banner(version::environment().as_ref()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                telemetry::flush(telemetry::EXIT_FLUSH_TIMEOUT);
                cleanup_virtual_display_on_exit();
            }
        });
}

/// Tauri's log plugin writes to the app log file; the default panic hook does
/// not. Keep the original hook so stdout still receives the normal panic trace.
fn install_panic_reporter() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = if let Some(message) = info.payload().downcast_ref::<&str>() {
            (*message).to_string()
        } else if let Some(message) = info.payload().downcast_ref::<String>() {
            message.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let location = info
            .location()
            .map(|location| location.to_string())
            .unwrap_or_else(|| "unknown location".to_string());
        log::error!("Rust panic at {location}: {payload}");
        previous_hook(info);
    }));
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_isAppReady(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> jni::sys::jboolean {
    android_app_handle().is_some().into()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_isProjectReady(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> jni::sys::jboolean {
    let Some(app) = android_app_handle() else {
        return false.into();
    };
    let state = app.state::<AppState>();
    if let Err(error) =
        tauri::async_runtime::block_on(ensure_background_project(app, state.inner()))
    {
        log::error!("Could not prepare the background project: {error}");
        return false.into();
    }
    state.project().is_ok().into()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_isEngineReady(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> jni::sys::jboolean {
    preparation_state().engine_ready.into()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_isPreparationFailed(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> jni::sys::jboolean {
    matches!(preparation_state().status.as_str(), "failed").into()
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_scheduleRulesJson(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> *mut std::ffi::c_void {
    let Some(app) = android_app_handle() else {
        return std::ptr::null_mut();
    };
    let rules = app.state::<AppState>().schedule_store().and_then(|store| {
        store
            .list()
            .and_then(|rules| serde_json::to_string(&rules).map_err(schedule::ScheduleError::from))
            .map_err(AppError::from)
    });
    match rules {
        Ok(rules) => match unsafe { jni::JNIEnv::from_raw(env.cast()) } {
            Ok(mut environment) => match environment.new_string(rules) {
                Ok(value) => value.into_raw().cast(),
                Err(_) => std::ptr::null_mut(),
            },
            Err(_) => std::ptr::null_mut(),
        },
        Err(_) => std::ptr::null_mut(),
    }
}

#[cfg(target_os = "android")]
async fn ensure_background_project(app: &AppHandle, state: &AppState) -> Result<(), AppError> {
    if state.project().is_ok() {
        return Ok(());
    }
    let _preparation_guard = state.preparation_task.lock().await;
    if state.project().is_ok() {
        return Ok(());
    }
    let root = wait_for_native_project(std::time::Duration::from_secs(120))?;
    match bootstrap_snapshot(app, state, Some(&root)).await {
        Ok(_) => {
            mark_preparation_ui_ready().map_err(AppError::Message)?;
            Ok(())
        }
        Err(error) => {
            mark_preparation_failed(error.to_string());
            Err(error)
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_recordScheduleForegroundServiceDenied(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    rule_id: *mut std::ffi::c_void,
    scheduled_time_ms: std::os::raw::c_long,
) -> std::os::raw::c_int {
    let Some(app) = android_app_handle() else {
        return 0;
    };
    let Ok(mut environment) = (unsafe { jni::JNIEnv::from_raw(env.cast()) }) else {
        return 0;
    };
    let raw_rule_id = unsafe { jni::objects::JObject::from_raw(rule_id.cast()) };
    let java_rule_id = jni::objects::JString::from(raw_rule_id);
    let Ok(rule_id) = environment.get_string(&java_rule_id) else {
        return 0;
    };
    let rule_id = rule_id.to_string_lossy().into_owned();
    let state = app.state::<AppState>();
    let recorded = state.schedule_store().and_then(|store| {
        store
            .record_trigger(schedule::ScheduleTriggerLogEntry {
                rule_id,
                scheduled_epoch_ms: scheduled_time_ms,
                actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                result: schedule::ScheduleTriggerResult::ForegroundServiceDenied,
                detail: Some("Android rejected the schedule foreground service".to_string()),
            })
            .map_err(AppError::from)
    });
    i32::from(recorded.is_ok())
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_top_natsuu_mta_RuntimeBridge_startScheduledRun(
    env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
    rule_id: *mut std::ffi::c_void,
    scheduled_time_ms: std::os::raw::c_long,
) -> std::os::raw::c_int {
    let Some(app) = android_app_handle() else {
        return 0;
    };
    let Ok(mut environment) = (unsafe { jni::JNIEnv::from_raw(env.cast()) }) else {
        return 0;
    };
    let raw_rule_id = unsafe { jni::objects::JObject::from_raw(rule_id.cast()) };
    let java_rule_id = jni::objects::JString::from(raw_rule_id);
    let Ok(rule_id) = environment.get_string(&java_rule_id) else {
        return 0;
    };
    let rule_id = rule_id.to_string_lossy().into_owned();
    let state = app.state::<AppState>();
    if tauri::async_runtime::block_on(ensure_background_project(&app, state.inner())).is_err() {
        return 0;
    }
    let Ok(store) = state.schedule_store() else {
        return 0;
    };
    let Ok(Some(rule)) = store.find(&rule_id) else {
        return 0;
    };
    if !rule.enabled
        || store
            .is_duplicate(&rule_id, scheduled_time_ms)
            .unwrap_or(true)
    {
        return 1;
    }
    if state.maa.status() != runtime::RunState::Idle {
        if !rule.force_start {
            let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
                rule_id,
                scheduled_epoch_ms: scheduled_time_ms,
                actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                result: schedule::ScheduleTriggerResult::RejectedActive,
                detail: Some("Another run is active or finishing".to_string()),
            });
            return 1;
        }
        let preempted = match preempt_running_run(&state) {
            Ok(preempted) => preempted,
            Err(error) => {
                let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
                    rule_id,
                    scheduled_epoch_ms: scheduled_time_ms,
                    actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                    result: schedule::ScheduleTriggerResult::RejectedActive,
                    detail: Some(error.to_string()),
                });
                return 1;
            }
        };
        if !preempted {
            let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
                rule_id,
                scheduled_epoch_ms: scheduled_time_ms,
                actual_epoch_ms: chrono::Local::now().timestamp_millis(),
                result: schedule::ScheduleTriggerResult::RejectedActive,
                detail: Some("The active run did not stop in time".to_string()),
            });
            return 1;
        }
    }
    let _ = store.record_trigger(schedule::ScheduleTriggerLogEntry {
        rule_id: rule_id.clone(),
        scheduled_epoch_ms: scheduled_time_ms,
        actual_epoch_ms: chrono::Local::now().timestamp_millis(),
        result: schedule::ScheduleTriggerResult::Started,
        detail: None,
    });
    let scheduled_app = app.clone();
    let scheduled_rule_id = rule_id.clone();
    tauri::async_runtime::block_on(async move {
        let scheduled_state = scheduled_app.state::<AppState>();
        let _ = start_run_core(
            scheduled_app.clone(),
            scheduled_state.inner(),
            Some(rule.run_configuration_id),
            Some((rule_id, scheduled_time_ms)),
            None,
        )
        .await;
        let _ = scheduled_state
            .schedule_store()
            .map_err(AppError::from)
            .and_then(|_| sync_schedule_alarms());
    });
    1
}

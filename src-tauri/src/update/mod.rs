//! In-app self-update.
//!
//! Two sources (MirrorChyan and GitHub Releases), a two-phase flow — an
//! anonymous availability check, then a resolve step that fetches the download
//! URL — a sha256-verified streaming download into the app cache, and a
//! hand-off to the Android package installer. The state machine lives here;
//! the source clients, the downloader and the persisted preferences are
//! sibling modules.

mod downloader;
mod github;
mod http;
mod mirror_chyan;
mod prefs;
mod semver;

pub use prefs::{UpdateChannel, UpdatePrefs, UpdateSource};

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

use crate::version::APP_VERSION;
use downloader::DownloadOutcome;
use http::{ReqwestUpdateClient, UpdateHttpClient};
use semver::Version;

/// Where the update flow currently stands. `available` means "an update is
/// known and ready for the next step" — after a successful check (download
/// button), after a completed download (install button), and after a cancelled
/// or failed download (retry button).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    Idle,
    Checking,
    UpToDate,
    Available,
    Resolving,
    Downloading,
    InstallPrompted,
    InstallFailed,
}

impl UpdatePhase {
    /// Phases with a task in flight; the UI polls through these.
    fn is_active(self) -> bool {
        matches!(
            self,
            UpdatePhase::Checking | UpdatePhase::Resolving | UpdatePhase::Downloading
        )
    }
}

/// Why the last step failed. Serialized verbatim to the frontend, which owns
/// the user-facing wording; [`UpdateFailure::Cancelled`] never reaches it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateFailure {
    Network,
    InvalidResponse,
    CdkRequired,
    CdkInvalid,
    CdkExpired,
    CdkDisabled,
    CdkQuotaExceeded,
    CdkMismatch,
    ResourceNotFound,
    ResourceUnavailable,
    InvalidDigest,
    NoMatchingAsset,
    DownloadFailed,
    Storage,
    InstallerNotFound,
    Cancelled,
    Internal,
}

/// A failure code plus the English diagnostic that explains it. Backend
/// diagnostics stay English by project convention; the frontend localizes.
#[derive(Debug, Clone)]
pub struct UpdateError {
    pub failure: UpdateFailure,
    pub detail: String,
}

impl UpdateError {
    pub fn new(failure: UpdateFailure, detail: impl Into<String>) -> Self {
        Self {
            failure,
            detail: detail.into(),
        }
    }

    pub(crate) fn network(detail: impl Into<String>) -> Self {
        Self::new(UpdateFailure::Network, detail)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: UpdatePhase,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_note: Option<String>,
    pub failure: Option<UpdateFailure>,
    pub failure_detail: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub apk_path: Option<String>,
}

impl UpdateStatus {
    fn new(phase: UpdatePhase) -> Self {
        Self {
            phase,
            current_version: APP_VERSION.to_string(),
            latest_version: None,
            release_note: None,
            failure: None,
            failure_detail: None,
            downloaded_bytes: None,
            total_bytes: None,
            apk_path: None,
        }
    }
}

/// What a successful check learned; the resolve stage needs the rest.
#[derive(Debug, Clone)]
enum PendingUpdate {
    MirrorChyan {
        rid: String,
    },
    Github {
        repo: String,
        url: String,
        sha256: String,
    },
}

impl PendingUpdate {
    /// Bytes are only known up front for GitHub assets; MirrorChyan reports
    /// the size during the download itself.
    fn size(&self) -> Option<u64> {
        match self {
            PendingUpdate::MirrorChyan { .. } => None,
            PendingUpdate::Github { .. } => None,
        }
    }
}

/// The checked update carried from the check task back into the state.
struct CheckedUpdate {
    pending: PendingUpdate,
    version: String,
    note: Option<String>,
}

struct TaskHandle {
    abort: tokio::task::AbortHandle,
    /// Set before aborting, so a task that raced past its last await point
    /// knows not to write a terminal phase over the cancel.
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
struct Inner {
    status: UpdateStatus,
    prefs: UpdatePrefs,
    pending: Option<PendingUpdate>,
    task: Option<TaskHandle>,
}

impl Default for UpdateStatus {
    fn default() -> Self {
        Self::new(UpdatePhase::Idle)
    }
}

/// Shared update state: the status machine, the saved preferences and at most
/// one in-flight task. Cloneable so spawned tasks can report back; `Default`
/// wires the real reqwest client, tests inject a stub through `with_client`.
#[derive(Clone)]
pub struct UpdateState {
    inner: Arc<Mutex<Inner>>,
    client: Arc<dyn UpdateHttpClient>,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self::with_client(Arc::new(ReqwestUpdateClient::new()))
    }
}

impl UpdateState {
    pub fn with_client(client: Arc<dyn UpdateHttpClient>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            client,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Reads the saved preferences once at startup; per-command reads use the
    /// cached copy so a slow disk never blocks the UI.
    pub fn load_prefs(&self, dirs: &UpdateDirs) {
        self.lock().prefs = UpdatePrefs::load(&dirs.prefs_dir);
    }

    fn set_prefs(&self, dirs: &UpdateDirs, prefs: UpdatePrefs) -> UpdatePrefs {
        let mut inner = self.lock();
        // Prefs are the inputs of a possibly running task; do not change them
        // underneath one. Echo the saved values back instead.
        if inner.status.phase.is_active() {
            return inner.prefs.clone();
        }
        let mut prefs = prefs;
        prefs.cdk = prefs.cdk.trim().to_string();
        let _ = prefs.save(&dirs.prefs_dir);
        inner.prefs = prefs.clone();
        prefs
    }

    fn begin_check(&self, info: RepoInfo) -> UpdateStatus {
        let prefs = { self.lock().prefs.clone() };
        let mut inner = self.lock();
        if inner.status.phase.is_active() {
            return inner.status.clone();
        }
        let rid = mirror_chyan::normalize_rid(info.mirrorchyan_rid.as_deref().unwrap_or(""));
        let repo = github::parse_repo(info.github.as_deref().unwrap_or(""));
        let source = match prefs.source {
            UpdateSource::Auto => rid
                .map(|rid| CheckSource::MirrorChyan { rid })
                .or_else(|| repo.map(|repo| CheckSource::Github { repo })),
            UpdateSource::Mirrorchyan => rid.map(|rid| CheckSource::MirrorChyan { rid }),
            UpdateSource::Github => repo.map(|repo| CheckSource::Github { repo }),
        };
        let Some(source) = source else {
            // No usable update source in the project metadata: nothing to ask,
            // so answer synchronously with the current version.
            inner.task = None;
            inner.pending = None;
            inner.status = UpdateStatus {
                latest_version: Some(APP_VERSION.to_string()),
                ..UpdateStatus::new(UpdatePhase::UpToDate)
            };
            return inner.status.clone();
        };
        inner.task = None;
        inner.pending = None;
        inner.status = UpdateStatus::new(UpdatePhase::Checking);

        let cancelled = Arc::new(AtomicBool::new(false));
        let task_cancelled = cancelled.clone();
        let state = self.clone();
        let client = self.client.clone();
        let channel = prefs.channel;
        let handle = tokio::spawn(async move {
            let outcome = match &source {
                CheckSource::MirrorChyan { rid } => check_mirror_chyan(&client, rid, channel).await,
                CheckSource::Github { repo } => check_github(&client, repo, channel).await,
            };
            state.finish_check(outcome, task_cancelled.load(Ordering::Relaxed));
        });
        inner.task = Some(TaskHandle {
            abort: handle.abort_handle(),
            cancelled,
        });
        inner.status.clone()
    }

    fn finish_check(&self, outcome: Result<Option<CheckedUpdate>, UpdateError>, cancelled: bool) {
        let mut inner = self.lock();
        if cancelled {
            // cancel() already restored a ready phase.
            return;
        }
        inner.task = None;
        inner.status.downloaded_bytes = None;
        inner.status.total_bytes = None;
        inner.status.apk_path = None;
        match outcome {
            Ok(Some(checked)) => {
                inner.pending = Some(checked.pending);
                inner.status.phase = UpdatePhase::Available;
                inner.status.latest_version = Some(checked.version);
                inner.status.release_note = checked.note;
                inner.status.failure = None;
                inner.status.failure_detail = None;
            }
            Ok(None) => {
                inner.pending = None;
                inner.status.phase = UpdatePhase::UpToDate;
                inner.status.latest_version = Some(inner.status.current_version.clone());
                inner.status.release_note = None;
                inner.status.failure = None;
                inner.status.failure_detail = None;
            }
            Err(error) => {
                inner.pending = None;
                inner.status.phase = UpdatePhase::Idle;
                inner.status.latest_version = None;
                inner.status.release_note = None;
                inner.status.failure = Some(error.failure);
                inner.status.failure_detail = Some(error.detail);
            }
        }
    }

    fn begin_download(&self, dirs: UpdateDirs) -> UpdateStatus {
        let pending = {
            let mut inner = self.lock();
            if !matches!(inner.status.phase, UpdatePhase::Available) || inner.pending.is_none() {
                return inner.status.clone();
            }
            inner.status.phase = UpdatePhase::Resolving;
            inner.status.failure = None;
            inner.status.failure_detail = None;
            inner.status.downloaded_bytes = None;
            inner.status.total_bytes = inner.pending.as_ref().and_then(PendingUpdate::size);
            inner.pending.clone().expect("pending checked above")
        };
        let prefs = { self.lock().prefs.clone() };
        let cancelled = Arc::new(AtomicBool::new(false));
        let task_cancelled = cancelled.clone();
        let state = self.clone();
        let client = self.client.clone();
        let handle = tokio::spawn(async move {
            let outcome = run_download(
                &state,
                &client,
                &pending,
                &prefs.cdk,
                prefs.channel,
                &task_cancelled,
                &dirs,
            )
            .await;
            state.finish_download(outcome, task_cancelled.load(Ordering::Relaxed));
        });
        let mut inner = self.lock();
        inner.task = Some(TaskHandle {
            abort: handle.abort_handle(),
            cancelled,
        });
        inner.status.clone()
    }

    fn finish_download(&self, outcome: Result<DownloadOutcome, UpdateError>, cancelled: bool) {
        let mut inner = self.lock();
        if cancelled {
            return;
        }
        inner.task = None;
        let status = &mut inner.status;
        match outcome {
            Ok(outcome) => {
                status.phase = UpdatePhase::Available;
                status.apk_path = Some(outcome.path.to_string_lossy().into_owned());
                status.downloaded_bytes = Some(outcome.bytes);
                status.total_bytes = Some(outcome.bytes);
                status.failure = None;
                status.failure_detail = None;
            }
            // Resolve and download failures keep the pending update so the
            // user can simply retry; only a fresh check replaces it.
            Err(error) => {
                status.phase = UpdatePhase::Available;
                status.downloaded_bytes = None;
                status.total_bytes = None;
                status.failure = Some(error.failure);
                status.failure_detail = Some(error.detail);
            }
        }
    }

    fn cancel(&self) -> UpdateStatus {
        let mut inner = self.lock();
        if let Some(task) = &inner.task {
            task.cancelled.store(true, Ordering::Relaxed);
            task.abort.abort();
        }
        inner.task = None;
        match inner.status.phase {
            UpdatePhase::Checking => inner.status.phase = UpdatePhase::Idle,
            UpdatePhase::Resolving | UpdatePhase::Downloading => {
                inner.status.phase = UpdatePhase::Available;
                inner.status.downloaded_bytes = None;
                inner.status.total_bytes = None;
                inner.status.failure = None;
                inner.status.failure_detail = None;
            }
            _ => {}
        }
        inner.status.clone()
    }

    fn install(&self) -> UpdateStatus {
        let apk_path = {
            let inner = self.lock();
            match inner.status.phase {
                UpdatePhase::Available
                | UpdatePhase::InstallPrompted
                | UpdatePhase::InstallFailed => inner.status.apk_path.clone(),
                _ => None,
            }
        };
        let Some(apk_path) = apk_path else {
            return self.lock().status.clone();
        };
        let result = install_apk(&apk_path);
        let mut inner = self.lock();
        match result {
            Ok(()) => {
                inner.status.phase = UpdatePhase::InstallPrompted;
                inner.status.failure = None;
                inner.status.failure_detail = None;
            }
            Err(error) => {
                inner.status.phase = UpdatePhase::InstallFailed;
                inner.status.failure = Some(error.failure);
                inner.status.failure_detail = Some(error.detail);
            }
        }
        inner.status.clone()
    }

    fn advance_to_downloading(&self) {
        let mut inner = self.lock();
        // A cancel between resolve and download already restored `available`;
        // do not resurrect a phase for a task that is about to be dropped.
        if inner.status.phase == UpdatePhase::Resolving {
            inner.status.phase = UpdatePhase::Downloading;
        }
    }

    fn report_progress(&self, received: u64, total: Option<u64>) {
        let mut inner = self.lock();
        if inner.status.phase == UpdatePhase::Downloading {
            inner.status.downloaded_bytes = Some(received);
            inner.status.total_bytes = total;
        }
    }
}

enum CheckSource {
    MirrorChyan { rid: String },
    Github { repo: String },
}

async fn check_mirror_chyan(
    client: &Arc<dyn UpdateHttpClient>,
    rid: &str,
    channel: UpdateChannel,
) -> Result<Option<CheckedUpdate>, UpdateError> {
    let release = mirror_chyan::check(client.as_ref(), rid, channel.as_str(), APP_VERSION).await?;
    let Ok(version) = semver::parse(&release.version) else {
        return Err(UpdateError::new(
            UpdateFailure::InvalidResponse,
            format!(
                "MirrorChyan returned an unparsable version ({})",
                release.version
            ),
        ));
    };
    let current = semver::parse(APP_VERSION).ok();
    let newer = current.as_ref().is_none_or(|current| version > *current);
    if !newer {
        return Ok(None);
    }
    Ok(Some(CheckedUpdate {
        pending: PendingUpdate::MirrorChyan {
            rid: rid.to_string(),
        },
        version: release.version,
        note: release.note,
    }))
}

async fn check_github(
    client: &Arc<dyn UpdateHttpClient>,
    repo: &str,
    channel: UpdateChannel,
) -> Result<Option<CheckedUpdate>, UpdateError> {
    let release =
        github::latest_release(client.as_ref(), repo, channel.as_str(), APP_VERSION).await?;
    let Some(release) = release else {
        return Ok(None);
    };
    Ok(Some(CheckedUpdate {
        pending: PendingUpdate::Github {
            repo: repo.to_string(),
            url: release.url,
            sha256: release.sha256,
        },
        version: release.version,
        note: release.note,
    }))
}

async fn run_download(
    state: &UpdateState,
    client: &Arc<dyn UpdateHttpClient>,
    pending: &PendingUpdate,
    cdk: &str,
    channel: UpdateChannel,
    cancelled: &AtomicBool,
    dirs: &UpdateDirs,
) -> Result<DownloadOutcome, UpdateError> {
    let version_label = state
        .lock()
        .status
        .latest_version
        .clone()
        .unwrap_or_else(|| APP_VERSION.to_string());
    let (url, digest) = match pending {
        PendingUpdate::MirrorChyan { rid } => {
            let release =
                mirror_chyan::resolve(client.as_ref(), rid, channel.as_str(), APP_VERSION, cdk)
                    .await?;
            state.advance_to_downloading();
            (
                release.url.expect("resolve validates the URL"),
                release.sha256.expect("resolve validates the digest"),
            )
        }
        PendingUpdate::Github { url, sha256, .. } => {
            state.advance_to_downloading();
            (url.clone(), sha256.clone())
        }
    };
    let progress_state = state.clone();
    downloader::download_apk(
        client.as_ref(),
        &url,
        &digest,
        &dirs.download_dir,
        &version_label,
        cancelled,
        move |received, total| progress_state.report_progress(received, total),
    )
    .await
}

/// The project metadata facts the update sources need. Normalization of the
/// raw metadata strings (owner/repo reduction, rid trimming) happens in the
/// source modules.
#[derive(Debug, Clone, Default)]
pub struct RepoInfo {
    pub mirrorchyan_rid: Option<String>,
    pub github: Option<String>,
}

fn repo_info(app_state: &crate::AppState) -> RepoInfo {
    let metadata = app_state
        .project
        .read()
        .ok()
        .and_then(|project| project.as_ref().map(|project| project.metadata.clone()))
        .unwrap_or_default();
    RepoInfo {
        mirrorchyan_rid: metadata.mirrorchyan_rid,
        github: metadata.github,
    }
}

/// Where update artifacts live: preferences beside the rest of the app data,
/// downloads in a scratch subdirectory of the cache.
#[derive(Clone)]
pub struct UpdateDirs {
    prefs_dir: PathBuf,
    download_dir: PathBuf,
}

pub fn resolve_dirs(app: &AppHandle) -> Result<UpdateDirs, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    Ok(UpdateDirs {
        prefs_dir: data_dir,
        download_dir: cache_dir.join("updates"),
    })
}

fn dirs_or_storage_failure(
    app: &AppHandle,
    state: &UpdateState,
) -> Result<UpdateDirs, UpdateStatus> {
    match resolve_dirs(app) {
        Ok(dirs) => Ok(dirs),
        Err(detail) => {
            let mut inner = state.lock();
            inner.status.phase = UpdatePhase::Idle;
            inner.status.failure = Some(UpdateFailure::Storage);
            inner.status.failure_detail = Some(detail);
            Err(inner.status.clone())
        }
    }
}

/// Asks the Android shell to hand the downloaded APK to the system installer.
/// Returns `ok` or a short error code agreed with `RuntimeBridge`.
#[cfg(target_os = "android")]
fn install_apk(path: &str) -> Result<(), UpdateError> {
    let bridge_class = crate::runtime::runtime_bridge_class()
        .map_err(|error| UpdateError::new(UpdateFailure::Internal, error.to_string()))?;
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        UpdateError::new(
            UpdateFailure::Storage,
            "the Java runtime has not been initialized",
        )
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| UpdateError::new(UpdateFailure::Internal, error.to_string()))?;
    let _ = env.exception_clear();
    let java_path = env
        .new_string(path)
        .map_err(|error| UpdateError::new(UpdateFailure::Internal, error.to_string()))?;
    let value = match env.call_static_method(
        bridge_class,
        "installUpdateApk",
        "(Ljava/lang/String;)Ljava/lang/String;",
        &[jni::objects::JValue::Object(&java_path)],
    ) {
        Ok(value) => value,
        Err(error) => {
            let _ = env.exception_clear();
            return Err(UpdateError::new(
                UpdateFailure::Internal,
                format!("installUpdateApk failed: {error}"),
            ));
        }
    };
    let object = value
        .l()
        .map_err(|error| UpdateError::new(UpdateFailure::Internal, error.to_string()))?;
    let text = jni::objects::JString::from(object);
    let code = match env.get_string(&text) {
        Ok(code) => code.to_string_lossy().into_owned(),
        Err(error) => {
            let _ = env.exception_clear();
            return Err(UpdateError::new(
                UpdateFailure::Internal,
                format!("installUpdateApk returned no code: {error}"),
            ));
        }
    };
    match code.as_str() {
        "ok" => Ok(()),
        "fileInvalid" | "noContext" => Err(UpdateError::new(
            UpdateFailure::Storage,
            format!("the installer rejected the APK ({code})"),
        )),
        "installerNotFound" => Err(UpdateError::new(
            UpdateFailure::InstallerNotFound,
            "no package installer activity is available",
        )),
        other => Err(UpdateError::new(
            UpdateFailure::Internal,
            format!("the installer reported {other}"),
        )),
    }
}

/// Desktop builds have nothing to hand the APK to; the error keeps the
/// never-reject command contract intact.
#[cfg(not(target_os = "android"))]
fn install_apk(_path: &str) -> Result<(), UpdateError> {
    Err(UpdateError::new(
        UpdateFailure::InstallerNotFound,
        "in-app install requires the Android shell",
    ))
}

#[tauri::command]
pub async fn update_get_status(state: State<'_, UpdateState>) -> Result<UpdateStatus, ()> {
    Ok(state.lock().status.clone())
}

#[tauri::command]
pub async fn update_check(
    state: State<'_, UpdateState>,
    app_state: State<'_, crate::AppState>,
) -> Result<UpdateStatus, ()> {
    Ok(state.begin_check(repo_info(&app_state)))
}

#[tauri::command]
pub async fn update_resolve(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateStatus, ()> {
    match dirs_or_storage_failure(&app, &state) {
        Ok(dirs) => Ok(state.begin_download(dirs)),
        Err(status) => Ok(status),
    }
}

#[tauri::command]
pub async fn update_cancel(state: State<'_, UpdateState>) -> Result<UpdateStatus, ()> {
    Ok(state.cancel())
}

#[tauri::command]
pub async fn update_install(state: State<'_, UpdateState>) -> Result<UpdateStatus, ()> {
    Ok(state.install())
}

#[tauri::command]
pub async fn update_get_prefs(state: State<'_, UpdateState>) -> Result<UpdatePrefs, ()> {
    Ok(state.lock().prefs.clone())
}

#[tauri::command]
pub async fn update_set_prefs(
    app: AppHandle,
    state: State<'_, UpdateState>,
    prefs: UpdatePrefs,
) -> Result<UpdatePrefs, ()> {
    match dirs_or_storage_failure(&app, &state) {
        Ok(dirs) => Ok(state.set_prefs(&dirs, prefs)),
        Err(_) => Ok(state.lock().prefs.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::http::testing::StubClient;
    use super::*;

    struct TestEnv {
        _temp: tempfile::TempDir,
        dirs: UpdateDirs,
    }

    fn test_env() -> TestEnv {
        let temp = tempfile::tempdir().unwrap();
        let dirs = UpdateDirs {
            prefs_dir: temp.path().join("data"),
            download_dir: temp.path().join("cache/updates"),
        };
        TestEnv { _temp: temp, dirs }
    }

    fn digest_of(content: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(content))
    }

    async fn wait_for_phase(state: &UpdateState, phase: UpdatePhase) {
        for _ in 0..300 {
            if state.lock().status.phase == phase {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        panic!("timed out waiting for phase {phase:?}");
    }

    fn mirror_body(version: &str) -> String {
        format!(
            r#"{{"code": 0, "message": "success", "data": {{"version_name": "{version}", "release_note": "note for {version}"}}}}"#
        )
    }

    #[test]
    fn pending_size_is_unknown_until_the_download_reports_it() {
        let mirror = PendingUpdate::MirrorChyan { rid: "m9a".into() };
        let github_repo = PendingUpdate::Github {
            repo: "owner/repo".into(),
            url: "https://example.test/a.apk".into(),
            sha256: digest_of(b"a").into(),
        };
        assert_eq!(mirror.size(), None);
        assert_eq!(github_repo.size(), None);
    }

    #[tokio::test]
    async fn a_project_without_update_sources_is_up_to_date() {
        let state = UpdateState::with_client(Arc::new(StubClient::new()));

        let status = state.begin_check(RepoInfo::default());

        assert_eq!(status.phase, UpdatePhase::UpToDate);
        assert_eq!(status.latest_version.as_deref(), Some(APP_VERSION));
        assert!(status.failure.is_none());
    }

    #[tokio::test]
    async fn a_failed_check_lands_on_idle_with_the_failure_code() {
        // Auto picks MirrorChyan when a rid exists; the stub has no script, so
        // the request fails with a transport error.
        let state = UpdateState::with_client(Arc::new(StubClient::new()));

        state.begin_check(RepoInfo {
            mirrorchyan_rid: Some("m9a".to_string()),
            github: None,
        });
        wait_for_phase(&state, UpdatePhase::Idle).await;

        let status = state.lock().status.clone();
        assert_eq!(status.failure, Some(UpdateFailure::Network));
        assert!(status.latest_version.is_none());
    }

    #[tokio::test]
    async fn a_newer_mirror_release_becomes_available() {
        let client = Arc::new(StubClient::new().with_body("latest", 200, mirror_body("99.0.0")));
        let state = UpdateState::with_client(client.clone());

        state.begin_check(RepoInfo {
            mirrorchyan_rid: Some("m9a".to_string()),
            github: Some("github.com/owner/repo".to_string()),
        });
        wait_for_phase(&state, UpdatePhase::Available).await;

        let status = state.lock().status.clone();
        assert_eq!(status.latest_version.as_deref(), Some("99.0.0"));
        assert_eq!(status.release_note.as_deref(), Some("note for 99.0.0"));
        assert!(status.failure.is_none());
        // Auto prefers MirrorChyan, so GitHub is never asked.
        assert_eq!(client.requested_urls().len(), 1);
    }

    #[tokio::test]
    async fn an_equal_mirror_version_is_up_to_date() {
        let client = Arc::new(StubClient::new().with_body("latest", 200, mirror_body(APP_VERSION)));
        let state = UpdateState::with_client(client);

        state.begin_check(RepoInfo {
            mirrorchyan_rid: Some("m9a".to_string()),
            github: None,
        });
        wait_for_phase(&state, UpdatePhase::UpToDate).await;

        let status = state.lock().status.clone();
        assert_eq!(status.phase, UpdatePhase::UpToDate);
        assert_eq!(status.latest_version.as_deref(), Some(APP_VERSION));
    }

    #[tokio::test]
    async fn resolving_without_a_cdk_fails_but_keeps_the_update_available() {
        let client = Arc::new(StubClient::new().with_body("latest", 200, mirror_body("99.0.0")));
        let state = UpdateState::with_client(client.clone());
        let env = test_env();

        state.begin_check(RepoInfo {
            mirrorchyan_rid: Some("m9a".to_string()),
            github: None,
        });
        wait_for_phase(&state, UpdatePhase::Available).await;

        state.begin_download(env.dirs.clone());
        wait_for_phase(&state, UpdatePhase::Available).await;

        let status = state.lock().status.clone();
        assert_eq!(status.failure, Some(UpdateFailure::CdkRequired));
        assert!(status.apk_path.is_none());
        // The resolve call never fired: the CDK gate is local.
        assert_eq!(client.requested_urls().len(), 1);
    }

    #[tokio::test]
    async fn a_full_mirror_flow_downloads_a_verified_apk() {
        let digest = digest_of(b"apk bytes");
        let resolve_body = format!(
            r#"{{"code": 0, "message": "success", "data": {{"version_name": "99.0.0", "url": "https://cdn.test/app.apk", "sha256": "{digest}"}}}}"#
        );
        let stream = http::testing::StreamSpec {
            status: 200,
            content_length: Some(9),
            chunks: vec![Ok(b"apk bytes".to_vec())],
        };
        let client = Arc::new(
            StubClient::new()
                .with_body("latest", 200, mirror_body("99.0.0"))
                .with_body("latest", 200, resolve_body)
                .with_stream("app.apk", stream),
        );
        let state = UpdateState::with_client(client.clone());
        let env = test_env();

        state.begin_check(RepoInfo {
            mirrorchyan_rid: Some("m9a".to_string()),
            github: None,
        });
        wait_for_phase(&state, UpdatePhase::Available).await;

        state.set_prefs(
            &env.dirs,
            UpdatePrefs {
                source: UpdateSource::Auto,
                channel: UpdateChannel::Stable,
                cdk: "  cdk-key  ".to_string(),
            },
        );
        state.begin_download(env.dirs.clone());
        wait_for_phase(&state, UpdatePhase::Available).await;

        let status = state.lock().status.clone();
        assert!(status.failure.is_none(), "{:?}", status.failure_detail);
        let apk_path = status.apk_path.expect("the apk is ready");
        assert_eq!(std::fs::read(&apk_path).unwrap(), b"apk bytes");
        assert_eq!(status.downloaded_bytes, Some(9));
        assert_eq!(status.total_bytes, Some(9));
        // Second request is the resolve, and it carried the trimmed CDK.
        assert!(client.requested_urls()[1].contains("cdk=cdk-key"));
    }

    #[tokio::test]
    async fn the_github_source_flows_through_asset_selection() {
        let digest = digest_of(b"github apk");
        let releases = format!(
            r#"[{{"tag_name": "v2.0.0", "prerelease": false, "body": "gh note", "assets": [{{"name": "app-arm64-v8a.apk", "size": 11, "browser_download_url": "https://github.com/owner/repo/releases/download/v2.0.0/app-arm64-v8a.apk", "digest": "sha256:{digest}"}}]}}]"#
        );
        let stream = http::testing::StreamSpec {
            status: 200,
            content_length: Some(10),
            chunks: vec![Ok(b"github apk".to_vec())],
        };
        let client = Arc::new(
            StubClient::new()
                .with_body("page=1", 200, releases)
                .with_body("page=2", 200, "[]")
                .with_stream("app-arm64-v8a.apk", stream),
        );
        let state = UpdateState::with_client(client);
        let env = test_env();

        state.begin_check(RepoInfo {
            mirrorchyan_rid: None,
            github: Some("https://github.com/owner/repo".to_string()),
        });
        wait_for_phase(&state, UpdatePhase::Available).await;
        assert_eq!(state.lock().status.latest_version.as_deref(), Some("2.0.0"));

        state.begin_download(env.dirs.clone());
        wait_for_phase(&state, UpdatePhase::Available).await;

        let status = state.lock().status.clone();
        assert!(status.failure.is_none(), "{:?}", status.failure_detail);
        assert_eq!(
            std::fs::read(status.apk_path.as_ref().unwrap()).unwrap(),
            b"github apk"
        );
    }

    #[tokio::test]
    async fn installing_without_a_ready_apk_changes_nothing() {
        let state = UpdateState::with_client(Arc::new(StubClient::new()));
        let before = state.lock().status.clone();

        let after = state.install();

        assert_eq!(after.phase, before.phase);
        assert_eq!(after.phase, UpdatePhase::Idle);
    }

    #[tokio::test]
    async fn a_failed_install_lands_on_install_failed() {
        let env = test_env();
        let client = Arc::new(StubClient::new());
        let state = UpdateState::with_client(client);
        // Simulate a completed download without the network.
        let apk_path = env.dirs.download_dir.join("ttflow-9.9.9-abcdef.apk");
        std::fs::create_dir_all(&env.dirs.download_dir).unwrap();
        std::fs::write(&apk_path, b"apk").unwrap();
        {
            let mut inner = state.lock();
            inner.status = UpdateStatus {
                phase: UpdatePhase::Available,
                latest_version: Some("9.9.9".to_string()),
                apk_path: Some(apk_path.to_string_lossy().into_owned()),
                downloaded_bytes: Some(3),
                total_bytes: Some(3),
                ..UpdateStatus::new(UpdatePhase::Available)
            };
        }

        // On desktop there is no installer; the failure must be reported, not
        // rejected through the IPC boundary.
        let status = state.install();
        assert_eq!(status.phase, UpdatePhase::InstallFailed);
        assert_eq!(status.failure, Some(UpdateFailure::InstallerNotFound));

        // And a retry stays possible from the failed phase.
        let retry = state.install();
        assert_eq!(retry.phase, UpdatePhase::InstallFailed);
    }

    #[tokio::test]
    async fn cancel_without_a_task_is_a_no_op() {
        let state = UpdateState::with_client(Arc::new(StubClient::new()));
        let before = state.lock().status.clone();
        let after = state.cancel();
        assert_eq!(after.phase, before.phase);
    }

    #[tokio::test]
    async fn prefs_round_trip_through_the_state_and_disk() {
        let env = test_env();
        let state = UpdateState::with_client(Arc::new(StubClient::new()));

        let saved = state.set_prefs(
            &env.dirs,
            UpdatePrefs {
                source: UpdateSource::Mirrorchyan,
                channel: UpdateChannel::Beta,
                cdk: "  key-1  ".to_string(),
            },
        );
        assert_eq!(saved.cdk, "key-1");

        // A fresh state loads the same prefs from disk.
        let reloaded = UpdateState::with_client(Arc::new(StubClient::new()));
        reloaded.load_prefs(&env.dirs);
        assert_eq!(reloaded.lock().prefs, saved);
    }
}

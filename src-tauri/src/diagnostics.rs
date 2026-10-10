use crate::domain::types::{
    OptionValue, Project, ResolvedTask, RunTaskSnapshot, RunTaskSnapshotEntry, UserConfiguration,
};
use chrono::{DateTime, Local, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
#[cfg(target_os = "android")]
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter as ZipFileWriter};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const CHECKSUMS_FILE: &str = "checksums.sha256";
#[cfg(target_os = "android")]
const CONTROL_RECONNECT_TIMEOUT_MS: u64 = 10_000;

pub const EXPECTED_ARTIFACTS: &[&str] = &[
    "bugreport.zip",
    "device-info.txt",
    "display-state.txt",
    "dumpsys.txt",
    "logs/bugreport-progress.txt",
    "logs/logcat-full.txt",
    "logs/maa_tauri_android-filtered.log",
    "screens/main.png",
];

pub trait DiagnosticSource {
    fn capture_png(&self, display_id: u32) -> io::Result<Vec<u8>>;
    fn device_info(&self) -> io::Result<Vec<u8>>;
    fn display_state(&self) -> io::Result<Vec<u8>>;
    fn logcat(&self) -> io::Result<Vec<u8>>;
    fn dumpsys(&self) -> io::Result<Vec<u8>>;
    fn bugreport(&self, destination: &Path) -> io::Result<Vec<String>>;

    /// Raw platform property dump (getprop + identity) for the log export.
    /// Optional: sources that cannot collect it keep the default and the
    /// archive simply omits the file.
    fn device_properties(&self) -> io::Result<Vec<u8>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "device properties are unavailable",
        ))
    }
}

/// A directory whose files are copied into the standalone log archive.
pub struct LogExportRoot {
    /// Destination prefix inside the archive, for example `logs/app`.
    pub entry: String,
    /// Source directory walked recursively.
    pub path: PathBuf,
}

/// Application state captured into the standalone log export.
pub struct LogExportSnapshots {
    pub project: Project,
    pub configuration: UserConfiguration,
}

/// Captures the resolved task list at run start. Password input values are
/// removed before the snapshot enters the run history or a log export.
pub fn build_run_task_snapshot(
    project: &Project,
    resolved_tasks: &[ResolvedTask],
    selected_instance_ids: &BTreeSet<String>,
    run_configuration_id: Option<String>,
) -> RunTaskSnapshot {
    let password_fields = declared_password_fields(project);
    let tasks = resolved_tasks
        .iter()
        .map(|task| {
            let configured = task.configured.as_ref();
            let mut option_values = configured
                .map(|configured| configured.option_values.clone())
                .unwrap_or_default();
            remove_password_option_values(&mut option_values, &password_fields);
            RunTaskSnapshotEntry {
                instance_id: configured.map(|configured| configured.instance_id.clone()),
                task_name: task.task.name.clone(),
                task_label: crate::run_progress::task_progress_label(task).to_string(),
                custom_label: configured.and_then(|configured| configured.custom_label.clone()),
                enabled: task.enabled,
                unavailable_reason: task.unavailable_reason.clone(),
                selected: configured.is_some_and(|configured| {
                    selected_instance_ids.contains(&configured.instance_id)
                }),
                option_values,
            }
        })
        .collect();
    RunTaskSnapshot {
        run_configuration_id,
        tasks,
    }
}

pub fn collect_artifacts(
    source: &dyn DiagnosticSource,
    run_dir: &Path,
) -> Result<Vec<String>, DiagnosticError> {
    let mut gaps = Vec::new();
    let screenshot_dir = run_dir.join("screens");
    fs::create_dir_all(&screenshot_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: screenshot_dir.clone(),
        source,
    })?;
    let logs_dir = run_dir.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: logs_dir.clone(),
        source,
    })?;

    for (name, bytes) in [
        ("display-state.txt", source.display_state()),
        ("dumpsys.txt", source.dumpsys()),
        ("logs/logcat-full.txt", source.logcat()),
    ] {
        match bytes {
            Ok(bytes) if !bytes.is_empty() => {
                write_file(&run_dir.join(name), &bytes)?;
            }
            Ok(_) => gaps.push(format!("{name} was empty")),
            Err(error) => gaps.push(format!("{name}: {error}")),
        }
    }

    match source.device_info() {
        Ok(bytes) if !bytes.is_empty() => {
            write_file(&run_dir.join("device-info.txt"), &with_version_rows(bytes))?;
        }
        Ok(_) => gaps.push("device-info.txt was empty".to_string()),
        Err(error) => gaps.push(format!("device-info.txt: {error}")),
    }

    for (display_id, name) in [(0_u32, "screens/main.png")] {
        match capture_png_to(source, display_id, &run_dir.join(name)) {
            Ok(()) => {}
            Err(error) => gaps.push(format!("{name}: {error}")),
        }
    }

    let display_state = fs::read_to_string(run_dir.join("display-state.txt")).unwrap_or_default();
    for display_id in virtual_display_ids(&display_state).into_iter().take(8) {
        let name = format!("screens/virtual-{display_id}.png");
        match capture_png_to(source, display_id, &run_dir.join(&name)) {
            Ok(()) => {}
            Err(error) => gaps.push(format!("{name}: {error}")),
        }
    }

    let full_log_path = run_dir.join("logs/logcat-full.txt");
    if full_log_path.is_file() {
        let full_log = fs::read(&full_log_path).map_err(|source| DiagnosticError::Read {
            path: full_log_path.clone(),
            source,
        })?;
        let full_log = String::from_utf8_lossy(&full_log).into_owned();
        let filtered = filtered_maa_tauri_android_log(&full_log);
        if filtered.trim().is_empty() {
            gaps.push(
                "logs/maa_tauri_android-filtered.log: no MaaTauriAndroid or Maa lines matched"
                    .to_string(),
            );
        } else {
            write_file(
                &run_dir.join("logs/maa_tauri_android-filtered.log"),
                filtered.as_bytes(),
            )?;
        }
    }

    let destination = run_dir.join("bugreport.zip");
    match source.bugreport(&destination) {
        Ok(progress) => {
            write_file(
                &run_dir.join("logs/bugreport-progress.txt"),
                progress.join("\n").as_bytes(),
            )?;
            let report_size = if destination.is_file() {
                Some(
                    fs::metadata(&destination)
                        .map_err(|source| DiagnosticError::Read {
                            path: destination.clone(),
                            source,
                        })?
                        .len(),
                )
            } else {
                None
            };
            if report_size.is_none_or(|size| size == 0) {
                gaps.push("bugreport.zip: collector did not receive report bytes".to_string());
            }
        }
        Err(error) => gaps.push(format!("bugreport.zip: {error}")),
    }

    Ok(gaps)
}

fn capture_png_to(
    source: &dyn DiagnosticSource,
    display_id: u32,
    destination: &Path,
) -> Result<(), DiagnosticError> {
    let png = source
        .capture_png(display_id)
        .map_err(|source| DiagnosticError::Read {
            path: destination.to_path_buf(),
            source,
        })?;
    ensure_png(&png).map_err(|source| DiagnosticError::Read {
        path: destination.to_path_buf(),
        source,
    })?;
    write_file(destination, &png)
}

#[derive(Debug, thiserror::Error)]
pub enum DiagnosticError {
    #[error("could not create {path}: {source}")]
    CreateDirectory { path: PathBuf, source: io::Error },
    #[error("could not read {path}: {source}")]
    Read { path: PathBuf, source: io::Error },
    #[error("could not write {path}: {source}")]
    Write { path: PathBuf, source: io::Error },
    #[error("could not remove {path}: {source}")]
    Remove { path: PathBuf, source: io::Error },
    #[error("diagnostic file {path} is too large for a ZIP archive")]
    TooLarge { path: PathBuf },
}

pub fn capture_manual_screenshot(
    source: &dyn DiagnosticSource,
    run_dir: &Path,
) -> Result<PathBuf, DiagnosticError> {
    let screenshot_dir = run_dir.join("screens");
    fs::create_dir_all(&screenshot_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: screenshot_dir.clone(),
        source,
    })?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let path = screenshot_dir.join(format!("manual-{timestamp}.png"));
    capture_png_to(source, 0, &path)?;
    Ok(path)
}

/// Collects the device logs (full logcat plus the app-filtered log) into a ZIP
/// archive. This is a standalone export: unlike the diagnostic bundle it does
/// not require a run and skips live capture, bugreport and manifest
/// bookkeeping. Screenshots already saved into run records are included.
pub fn export_log_archive(
    source: &dyn DiagnosticSource,
    roots: &[LogExportRoot],
    snapshots: Option<LogExportSnapshots>,
    runs_dir: Option<&Path>,
    output_path: PathBuf,
) -> Result<PathBuf, DiagnosticError> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|source| DiagnosticError::CreateDirectory {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let staging_dir = output_path.with_extension("logs.staging");
    let _ = fs::remove_dir_all(&staging_dir);
    let logs_dir = staging_dir.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: logs_dir.clone(),
        source,
    })?;
    let failure = |source: io::Error| DiagnosticError::Read {
        path: logs_dir.join("logcat-full.txt"),
        source,
    };
    let logcat = source.logcat().map_err(failure)?;
    if logcat.is_empty() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(failure(io::Error::new(
            io::ErrorKind::InvalidData,
            "logcat capture was empty",
        )));
    }
    write_file(&logs_dir.join("logcat-full.txt"), &logcat)?;
    let full_log = String::from_utf8_lossy(&logcat).into_owned();
    let filtered = filtered_maa_tauri_android_log(&full_log);
    if !filtered.trim().is_empty() {
        write_file(
            &logs_dir.join("maa_tauri_android-filtered.log"),
            filtered.as_bytes(),
        )?;
    }
    write_device_snapshot(source, &staging_dir);
    if let Some(snapshots) = snapshots {
        write_log_export_snapshots(&staging_dir, &snapshots)?;
    }
    for root in roots {
        copy_log_root(root, &staging_dir);
    }
    copy_run_histories(runs_dir, &staging_dir);

    let staging_zip = output_path.with_extension("zip.partial");
    let mut archive = ZipWriter::create(staging_zip.clone())?;
    for name in walk_files(&staging_dir)? {
        archive.add(staging_dir.join(&name), &name)?;
    }
    archive.finish()?;
    fs::remove_dir_all(&staging_dir).map_err(|source| DiagnosticError::Remove {
        path: staging_dir,
        source,
    })?;
    fs::rename(&staging_zip, &output_path).map_err(|source| DiagnosticError::Write {
        path: output_path.clone(),
        source,
    })?;
    Ok(output_path)
}

/// Appends the client and framework versions to a device snapshot.
///
/// These are written here rather than read from the platform collector so every
/// device snapshot names the exact build it came from, even when the privileged
/// collector is unavailable. The collector's payload may not end with a newline,
/// so one is inserted before the rows to avoid gluing them onto its last line.
fn with_version_rows(payload: Vec<u8>) -> Vec<u8> {
    let mut snapshot = payload;
    if !snapshot.ends_with(b"\n") {
        snapshot.push(b'\n');
    }
    snapshot.extend_from_slice(crate::version::device_info_rows().as_bytes());
    snapshot
}

fn write_log_export_snapshots(
    staging_dir: &Path,
    snapshots: &LogExportSnapshots,
) -> Result<(), DiagnosticError> {
    let snapshots_dir = staging_dir.join("snapshots");
    fs::create_dir_all(&snapshots_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: snapshots_dir.clone(),
        source,
    })?;
    let configuration = remove_password_values(&snapshots.project, snapshots.configuration.clone());
    write_json_snapshot(&snapshots_dir.join("settings.json"), &configuration)?;
    write_json_snapshot(&snapshots_dir.join("project.json"), &snapshots.project)
}

fn write_json_snapshot<T: Serialize>(path: &Path, value: &T) -> Result<(), DiagnosticError> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|source| DiagnosticError::Write {
        path: path.to_path_buf(),
        source: io::Error::new(io::ErrorKind::InvalidData, source),
    })?;
    write_file(path, &bytes)
}

pub(crate) use crate::configuration_backup::{
    declared_password_fields, remove_password_option_values, remove_password_values,
};

/// Device snapshots are best-effort: a missing collector must not fail the
/// whole export, mirroring the MaaFwApp log export behaviour.
fn write_device_snapshot(source: &dyn DiagnosticSource, staging_dir: &Path) {
    if let Ok(bytes) = source.device_info() {
        if !bytes.is_empty() {
            let _ = write_file(
                &staging_dir.join("device-info.txt"),
                &with_version_rows(bytes),
            );
        }
    }
    if let Ok(bytes) = source.device_properties() {
        if !bytes.is_empty() {
            let _ = write_file(&staging_dir.join("properties.txt"), &bytes);
        }
    }
}

fn copy_log_root(root: &LogExportRoot, staging_dir: &Path) {
    for (source_path, relative) in collect_root_files(&root.path) {
        let destination = staging_dir.join(&root.entry).join(&relative);
        let Some(parent) = destination.parent() else {
            continue;
        };
        if fs::create_dir_all(parent).is_err() {
            continue;
        }
        let _ = fs::copy(&source_path, &destination);
    }
}

/// Copies the top-level JSONL run records and their saved screenshots so
/// exported logs include the Started task snapshot without bug reports.
fn copy_run_histories(runs_dir: Option<&Path>, staging_dir: &Path) {
    let Some(runs_dir) = runs_dir else {
        return;
    };
    let mut exported_runs = Vec::new();
    for entry in crate::run_history::list(runs_dir).into_iter().take(20) {
        let source = runs_dir
            .join(crate::run_log::sanitize(&entry.execution_id))
            .join(&entry.file_name);
        let history_stem = entry
            .file_name
            .strip_suffix(".jsonl")
            .unwrap_or(&entry.file_name);
        let export_file_name = format!(
            "{}_{}.jsonl",
            crate::run_log::sanitize(history_stem),
            crate::run_log::sanitize(&entry.execution_id)
        );
        let destination = staging_dir.join("logs/runs").join(&export_file_name);
        let Some(parent) = destination.parent() else {
            continue;
        };
        if fs::create_dir_all(parent).is_err() {
            continue;
        }
        if fs::copy(&source, &destination).is_err() {
            continue;
        }
        copy_run_screenshots(
            &runs_dir.join(crate::run_log::sanitize(&entry.execution_id)),
            &staging_dir
                .join("logs/runs/screens")
                .join(crate::run_log::sanitize(&entry.execution_id)),
        );
        let started_at_unix_ms = i64::try_from(entry.started_at_unix_ms).unwrap_or_default();
        let started_at = DateTime::<Utc>::from_timestamp_millis(started_at_unix_ms)
            .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
            .with_timezone(&Local);
        exported_runs.push(RunHistoryExportEntry {
            execution_id: entry.execution_id,
            file_name: export_file_name,
            started_at,
            started_at_unix_ms: entry.started_at_unix_ms,
            task_count: entry.task_count,
            size_bytes: entry.size_bytes,
        });
    }

    if exported_runs.is_empty() {
        return;
    }

    let index = RunHistoryExportIndex {
        version: 1,
        runs: exported_runs,
    };
    if let Ok(output) = serde_json::to_vec_pretty(&index) {
        let _ = write_file(&staging_dir.join("logs/runs/index.json"), &output);
    }
}

fn copy_run_screenshots(run_dir: &Path, screenshots_dir: &Path) {
    for (source_path, relative) in collect_root_files(&run_dir.join("screens")) {
        let destination = screenshots_dir.join(&relative);
        let Some(parent) = destination.parent() else {
            continue;
        };
        if fs::create_dir_all(parent).is_err() {
            continue;
        }
        let _ = fs::copy(&source_path, &destination);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunHistoryExportIndex {
    version: u8,
    runs: Vec<RunHistoryExportEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunHistoryExportEntry {
    execution_id: String,
    file_name: String,
    started_at: DateTime<Local>,
    started_at_unix_ms: u64,
    task_count: usize,
    size_bytes: u64,
}

fn collect_root_files(root: &Path) -> Vec<(PathBuf, PathBuf)> {
    fn visit(dir: &Path, relative: &Path, output: &mut Vec<(PathBuf, PathBuf)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let child_path = dir.join(entry.file_name());
            let child_relative = relative.join(entry.file_name());
            match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => {
                    visit(&child_path, &child_relative, output);
                }
                Ok(file_type) if file_type.is_file() => {
                    output.push((child_path, child_relative));
                }
                _ => {}
            }
        }
    }

    let mut files = Vec::new();
    visit(root, Path::new(""), &mut files);
    files
}

pub fn clear_run_directories(runs_dir: &Path) -> Result<usize, DiagnosticError> {
    let entries = match fs::read_dir(runs_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(source) => {
            return Err(DiagnosticError::Read {
                path: runs_dir.to_path_buf(),
                source,
            })
        }
    };

    let mut deleted = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|source| DiagnosticError::Read {
            path: runs_dir.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        let is_directory = entry
            .file_type()
            .map_err(|source| DiagnosticError::Read {
                path: path.clone(),
                source,
            })?
            .is_dir();
        if !is_directory {
            continue;
        }
        fs::remove_dir_all(&path).map_err(|source| DiagnosticError::Remove {
            path: path.clone(),
            source,
        })?;
        deleted += 1;
    }
    Ok(deleted)
}

/// Deletes every entry (file or subdirectory) inside `dir`, keeping the
/// directory itself. Missing directories count as already empty. Used for the
/// MaaFramework log directory, whose contents must be removable while the
/// framework still holds an open handle on the active log file; the handle is
/// re-armed afterwards via `runtime::reconfigure_maa_logging`.
pub fn clear_dir_contents(dir: &Path) -> Result<usize, DiagnosticError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(source) => {
            return Err(DiagnosticError::Read {
                path: dir.to_path_buf(),
                source,
            })
        }
    };

    let mut deleted = 0_usize;
    for entry in entries {
        let entry = entry.map_err(|source| DiagnosticError::Read {
            path: dir.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        let is_directory = entry
            .file_type()
            .map_err(|source| DiagnosticError::Read {
                path: path.clone(),
                source,
            })?
            .is_dir();
        if is_directory {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        }
        .map_err(|source| DiagnosticError::Remove {
            path: path.clone(),
            source,
        })?;
        deleted += 1;
    }
    Ok(deleted)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    pub name: String,
    pub present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticManifest {
    pub schema_version: u32,
    pub execution_id: String,
    pub created_at_unix_ms: u128,
    pub status: &'static str,
    pub privacy_confirmation: String,
    pub items: Vec<DiagnosticItem>,
    pub partial_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExport {
    pub path: String,
    pub manifest: DiagnosticManifest,
}

pub fn write_manifest(
    run_dir: &Path,
    execution_id: &str,
    expected: &[&str],
    collection_gaps: &[String],
) -> Result<DiagnosticManifest, DiagnosticError> {
    let mut items = Vec::new();
    for name in walk_files(run_dir)? {
        let path = run_dir.join(&name);
        let metadata = fs::metadata(&path).map_err(|source| DiagnosticError::Read {
            path: path.clone(),
            source,
        })?;
        items.push(DiagnosticItem {
            name: name.clone(),
            present: true,
            byte_length: Some(metadata.len()),
            sha256: Some(sha256_file(&path)?),
            reason: None,
        });
    }

    let mut partial_reasons = collection_gaps.to_vec();
    for name in expected {
        if !items.iter().any(|item| &item.name == name) {
            items.push(DiagnosticItem {
                name: (*name).to_string(),
                present: false,
                byte_length: None,
                sha256: None,
                reason: Some("collector did not produce this artifact".to_string()),
            });
            partial_reasons.push(format!("{name} is missing"));
        }
    }
    items.sort_by(|left, right| left.name.cmp(&right.name));
    partial_reasons.sort();
    partial_reasons.dedup();

    let manifest = DiagnosticManifest {
        schema_version: 1,
        execution_id: execution_id.to_string(),
        created_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
        status: if partial_reasons.is_empty() {
            "complete"
        } else {
            "partial"
        },
        privacy_confirmation: "The user explicitly requested this diagnostic export".to_string(),
        items,
        partial_reasons,
    };
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|source| DiagnosticError::Write {
        path: run_dir.join(MANIFEST_FILE),
        source: io::Error::new(io::ErrorKind::InvalidData, source),
    })?;
    write_file(&run_dir.join(MANIFEST_FILE), &bytes)?;
    Ok(manifest)
}

pub fn export_bundle(
    run_dir: &Path,
    output_path: PathBuf,
    execution_id: &str,
    collection_gaps: Vec<String>,
) -> Result<DiagnosticExport, DiagnosticError> {
    let expected = EXPECTED_ARTIFACTS;
    let manifest = write_manifest(run_dir, execution_id, &expected, &collection_gaps)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|source| DiagnosticError::CreateDirectory {
            path: parent.to_path_buf(),
            source,
        })?;
    }

    let checksums = checksums_file(run_dir, &manifest)?;
    write_file(&run_dir.join(CHECKSUMS_FILE), checksums.as_bytes())?;
    let mut entries = walk_files(run_dir)?;
    entries.push(CHECKSUMS_FILE.to_string());
    entries.sort();
    entries.dedup();
    let staging_path = output_path.with_extension("zip.partial");
    let mut archive = ZipWriter::create(staging_path.clone())?;
    for name in entries {
        archive.add(run_dir.join(&name), &name)?;
    }
    archive.finish()?;
    fs::rename(&staging_path, &output_path).map_err(|source| DiagnosticError::Write {
        path: output_path.clone(),
        source,
    })?;

    Ok(DiagnosticExport {
        path: output_path.to_string_lossy().into_owned(),
        manifest,
    })
}

fn ensure_png(bytes: &[u8]) -> io::Result<()> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "capture did not emit PNG",
        ))
    }
}

fn virtual_display_ids(display_state: &str) -> Vec<u32> {
    let mut ids = Vec::new();
    for line in display_state.lines() {
        let value = ["mDisplayId=", "DisplayId=", "Display id="]
            .iter()
            .find_map(|prefix| line.trim().split_once(prefix))
            .map(|(_, value)| value)
            .unwrap_or(line);
        let id = value
            .split(|character: char| !character.is_ascii_digit())
            .find(|part| !part.is_empty())
            .and_then(|part| part.parse::<u32>().ok());
        if let Some(id) = id.filter(|id| *id != 0 && !ids.contains(id)) {
            ids.push(id);
        }
    }
    ids
}

fn filtered_maa_tauri_android_log(log: &str) -> String {
    log.lines()
        .filter(|line| {
            ["MaaTauriAndroid", "maa_tauri_android", "Maa", "MAA", "maa"]
                .iter()
                .any(|token| line.contains(token))
        })
        .collect::<Vec<_>>()
        .join("\n")
        + if log.contains('\n') { "\n" } else { "" }
}

fn checksums_file(
    run_dir: &Path,
    manifest: &DiagnosticManifest,
) -> Result<String, DiagnosticError> {
    let mut output = String::new();
    for item in &manifest.items {
        if !item.present {
            continue;
        }
        let digest = item
            .sha256
            .as_deref()
            .map(str::to_string)
            .unwrap_or_else(|| sha256_file(&run_dir.join(&item.name)).expect("checksummed file"));
        output.push_str(&format!("{digest}  {}\n", item.name));
    }
    Ok(output)
}

fn walk_files(root: &Path) -> Result<Vec<String>, DiagnosticError> {
    fn visit(
        root: &Path,
        relative: &Path,
        output: &mut Vec<String>,
    ) -> Result<(), DiagnosticError> {
        let current = root.join(relative);
        for entry in fs::read_dir(&current).map_err(|source| DiagnosticError::Read {
            path: current.clone(),
            source,
        })? {
            let path = entry.map_err(|source| DiagnosticError::Read {
                path: current.clone(),
                source,
            })?;
            let child = relative.join(path.file_name());
            if path
                .file_type()
                .map_err(|source| DiagnosticError::Read {
                    path: current.clone(),
                    source,
                })?
                .is_dir()
            {
                visit(root, &child, output)?;
            } else {
                output.push(child.to_string_lossy().replace('\\', "/"));
            }
        }
        Ok(())
    }

    let mut output = Vec::new();
    visit(root, Path::new(""), &mut output)?;
    output.retain(|name| {
        name != MANIFEST_FILE && name != CHECKSUMS_FILE && !is_diagnostic_bundle(name)
    });
    output.sort();
    Ok(output)
}

fn is_diagnostic_bundle(name: &str) -> bool {
    Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("maa_tauri_android-diagnostics-")
                && (name.ends_with(".zip") || name.ends_with(".partial"))
        })
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), DiagnosticError> {
    File::create(path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(|source| DiagnosticError::Write {
            path: path.to_path_buf(),
            source,
        })
}

pub fn sha256_file(path: &Path) -> Result<String, DiagnosticError> {
    let mut file = File::open(path).map_err(|source| DiagnosticError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|source| DiagnosticError::Read {
                path: path.to_path_buf(),
                source,
            })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

pub fn capture_failure_screenshot(
    run_dir: &Path,
    task_entry: &str,
) -> Result<PathBuf, DiagnosticError> {
    let source = platform_source();
    let screenshot_dir = run_dir.join("screens");
    fs::create_dir_all(&screenshot_dir).map_err(|source| DiagnosticError::CreateDirectory {
        path: screenshot_dir.clone(),
        source,
    })?;

    let path = screenshot_dir.join("failure.png");
    let png = source
        .capture_png(0)
        .and_then(|png| {
            ensure_png(&png)?;
            Ok(png)
        })
        .map_err(|source| DiagnosticError::Read {
            path: PathBuf::from("screens/failure.png"),
            source,
        })?;
    write_file(&path, &png)?;
    let _ = task_entry;
    Ok(path)
}

#[cfg(not(target_os = "android"))]
pub fn platform_source() -> impl DiagnosticSource {
    UnsupportedSource
}

#[cfg(target_os = "android")]
pub fn platform_source() -> impl DiagnosticSource {
    AndroidSource
}

#[cfg(not(target_os = "android"))]
pub fn log_export_source() -> impl DiagnosticSource {
    UnsupportedSource
}

#[cfg(target_os = "android")]
pub fn log_export_source() -> impl DiagnosticSource {
    AndroidLogSource
}

#[cfg(not(target_os = "android"))]
struct UnsupportedSource;

#[cfg(not(target_os = "android"))]
impl DiagnosticSource for UnsupportedSource {
    fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Android privileged service is unavailable",
        ))
    }

    fn device_info(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn display_state(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn logcat(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn dumpsys(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
        self.capture_png(0).map(|_| Vec::new())
    }
}

#[cfg(target_os = "android")]
struct AndroidSource;

#[cfg(target_os = "android")]
impl DiagnosticSource for AndroidSource {
    fn capture_png(&self, display_id: u32) -> io::Result<Vec<u8>> {
        with_service(|env, service| {
            let descriptor = env
                .call_method(
                    service,
                    "capturePng",
                    "(I)Landroid/os/ParcelFileDescriptor;",
                    &[jni::objects::JValue::Int(display_id as i32)],
                )
                .and_then(|value| value.l())
                .map_err(jni_error)?;
            read_parcel_file_descriptor(env, descriptor)
        })
    }

    fn device_info(&self) -> io::Result<Vec<u8>> {
        text_source("deviceInfo")
    }

    fn display_state(&self) -> io::Result<Vec<u8>> {
        text_source("displayState")
    }

    fn logcat(&self) -> io::Result<Vec<u8>> {
        text_source("logcat")
    }

    fn dumpsys(&self) -> io::Result<Vec<u8>> {
        text_source("dumpsys")
    }

    fn bugreport(&self, destination: &Path) -> io::Result<Vec<String>> {
        with_service(|env, service| {
            let file = File::create(destination)?;
            let transfer = file.try_clone()?;
            let descriptor = env
                .call_static_method(
                    "android/os/ParcelFileDescriptor",
                    "adoptFd",
                    "(I)Landroid/os/ParcelFileDescriptor;",
                    &[jni::objects::JValue::Int(transfer.as_raw_fd())],
                )
                .and_then(|value| value.l())
                .map_err(jni_error)?;
            std::mem::forget(transfer);
            env.call_method(
                service,
                "bugreport",
                "(ILandroid/os/ParcelFileDescriptor;)V",
                &[
                    jni::objects::JValue::Int(0),
                    jni::objects::JValue::Object(&descriptor),
                ],
            )
            .map_err(jni_error)?;

            let mut progress = Vec::new();
            let started = std::time::Instant::now();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let state = env
                    .call_method(service, "bugreportProgress", "()Ljava/lang/String;", &[])
                    .and_then(|value| value.l())
                    .map_err(jni_error)?;
                let state = jni::objects::JString::from(state);
                let state = env
                    .get_string(&state)
                    .map_err(jni_error)?
                    .to_string_lossy()
                    .into_owned();
                progress.push(format!(
                    "{} {:?}",
                    humantime_millis(started.elapsed().as_millis() as u64),
                    state
                ));
                let finished = state.starts_with("done|")
                    || state.starts_with("failed|")
                    || state.starts_with("cancelled|")
                    || started.elapsed() > std::time::Duration::from_secs(30 * 60);
                if finished {
                    break;
                }
            }
            file.sync_all()?;
            if progress.last().is_some_and(|line| line.contains("failed|")) {
                return Err(io::Error::other("bugreport failed"));
            }
            Ok(progress)
        })
    }
}

#[cfg(target_os = "android")]
struct AndroidLogSource;

#[cfg(target_os = "android")]
impl DiagnosticSource for AndroidLogSource {
    fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "screenshots are not included in the standalone log export",
        ))
    }

    fn device_info(&self) -> io::Result<Vec<u8>> {
        bridge_string("deviceInfo").map(String::into_bytes)
    }

    fn display_state(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn logcat(&self) -> io::Result<Vec<u8>> {
        let vm = crate::runtime::java_vm().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "Java runtime is not initialized",
            )
        })?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| io::Error::other(error.to_string()))?;
        let _ = env.exception_clear();
        let descriptor = env
            .call_static_method(
                crate::runtime::runtime_bridge_class()
                    .map_err(|error| io::Error::other(error.to_string()))?,
                "localLogcat",
                "()Landroid/os/ParcelFileDescriptor;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|error| io::Error::other(error.to_string()))?;
        read_parcel_file_descriptor(&mut env, descriptor)
    }

    fn dumpsys(&self) -> io::Result<Vec<u8>> {
        self.capture_png(0)
    }

    fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
        self.capture_png(0).map(|_| Vec::new())
    }

    fn device_properties(&self) -> io::Result<Vec<u8>> {
        text_source("deviceInfo")
    }
}

/// Reads a `String` from a `RuntimeBridge` static without the privileged
/// service, so the log export still works after Shizuku goes away.
#[cfg(target_os = "android")]
pub(crate) fn bridge_string(method: &'static str) -> io::Result<String> {
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Unsupported,
            "Java runtime is not initialized",
        )
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let _ = env.exception_clear();
    let class = crate::runtime::runtime_bridge_class()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let text = match env.call_static_method(class, method, "()Ljava/lang/String;", &[]) {
        Ok(value) => value
            .l()
            .map_err(|error| io::Error::other(error.to_string()))?,
        Err(error) => {
            let _ = env.exception_clear();
            return Err(io::Error::other(error.to_string()));
        }
    };
    if text.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "device info is unavailable",
        ));
    }
    let text = jni::objects::JString::from(text);
    let text = env
        .get_string(&text)
        .map_err(|error| io::Error::other(error.to_string()))?;
    Ok(text.to_string_lossy().into_owned())
}

#[cfg(target_os = "android")]
fn humantime_millis(value: u64) -> String {
    format!("{value}ms")
}

#[cfg(target_os = "android")]
fn text_source(method: &'static str) -> io::Result<Vec<u8>> {
    with_service(|env, service| {
        let (signature, args): (&str, Vec<jni::objects::JValue>) = match method {
            "logcat" => (
                "(Z)Landroid/os/ParcelFileDescriptor;",
                vec![jni::objects::JValue::Bool(1)],
            ),
            _ => ("()Landroid/os/ParcelFileDescriptor;", Vec::new()),
        };
        let descriptor = env
            .call_method(service, method, signature, args.as_slice())
            .and_then(|value| value.l())
            .map_err(jni_error)?;
        read_parcel_file_descriptor(env, descriptor)
    })
}

#[cfg(target_os = "android")]
fn with_service<T>(
    operation: impl for<'local> FnOnce(
        &mut jni::JNIEnv<'local>,
        &jni::objects::JObject<'local>,
    ) -> io::Result<T>,
) -> io::Result<T> {
    let vm = crate::runtime::java_vm().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::Unsupported,
            "Java runtime is not initialized",
        )
    })?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let mut service = env
        .call_static_method(
            crate::runtime::control_host_class()
                .map_err(|error| io::Error::other(error.to_string()))?,
            "current",
            "()Ltop/natsuu/mta/IMaaTauriAndroidControlService;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|error| io::Error::other(error.to_string()))?;
    if service.is_null() {
        crate::runtime::ensure_control_service(CONTROL_RECONNECT_TIMEOUT_MS)
            .map_err(|error| io::Error::other(error.to_string()))?;
        service = env
            .call_static_method(
                crate::runtime::control_host_class()
                    .map_err(|error| io::Error::other(error.to_string()))?,
                "current",
                "()Ltop/natsuu/mta/IMaaTauriAndroidControlService;",
                &[],
            )
            .and_then(|value| value.l())
            .map_err(|error| io::Error::other(error.to_string()))?;
    }
    if service.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::NotConnected,
            "privileged control service is disconnected",
        ));
    }
    operation(&mut env, &service)
}

#[cfg(target_os = "android")]
fn jni_error(error: jni::errors::Error) -> io::Error {
    io::Error::other(error)
}

#[cfg(target_os = "android")]
fn read_parcel_file_descriptor<'local>(
    env: &mut jni::JNIEnv<'local>,
    descriptor: jni::objects::JObject<'local>,
) -> io::Result<Vec<u8>> {
    if descriptor.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "service returned no file descriptor",
        ));
    }
    let fd = env
        .call_method(&descriptor, "detachFd", "()I", &[])
        .and_then(|value| value.i())
        .map_err(|error| io::Error::other(error.to_string()))?;
    if fd < 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "service returned an invalid file descriptor",
        ));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

struct ZipWriter {
    writer: ZipFileWriter<File>,
    local_offset: u64,
    central_size: u64,
    entries: u64,
}

impl ZipWriter {
    fn create(path: PathBuf) -> Result<Self, DiagnosticError> {
        let file = File::create(&path).map_err(|source| DiagnosticError::Write {
            path: path.clone(),
            source,
        })?;
        Ok(Self {
            writer: ZipFileWriter::new(file),
            local_offset: 0,
            central_size: 0,
            entries: 0,
        })
    }

    fn add(&mut self, path: PathBuf, name: &str) -> Result<(), DiagnosticError> {
        let size = fs::metadata(&path)
            .map_err(|source| DiagnosticError::Read {
                path: path.clone(),
                source,
            })?
            .len();
        if size > u32::MAX as u64 || self.local_offset > u32::MAX as u64 {
            return Err(DiagnosticError::TooLarge { path });
        }
        let name_length = name.as_bytes().len() as u64;
        let mut source = File::open(&path).map_err(|source| DiagnosticError::Read {
            path: path.clone(),
            source,
        })?;
        self.writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(|source| DiagnosticError::Write {
                path: path.clone(),
                source: io::Error::other(source),
            })?;

        let copied =
            io::copy(&mut source, &mut self.writer).map_err(|source| DiagnosticError::Write {
                path: path.clone(),
                source,
            })?;
        if copied != size {
            return Err(DiagnosticError::Read {
                path,
                source: io::Error::new(io::ErrorKind::UnexpectedEof, "file changed while reading"),
            });
        }

        self.entries += 1;
        self.local_offset += 30 + name_length + copied;
        self.central_size += 46 + name_length;
        if self.entries > u16::MAX as u64 || self.local_offset + self.central_size > u32::MAX as u64
        {
            return Err(DiagnosticError::TooLarge {
                path: PathBuf::from("diagnostics archive"),
            });
        }
        Ok(())
    }

    fn finish(self) -> Result<(), DiagnosticError> {
        if self.local_offset + self.central_size > u32::MAX as u64 {
            return Err(DiagnosticError::TooLarge {
                path: PathBuf::from("diagnostics archive"),
            });
        }
        self.writer
            .finish()
            .map_err(|source| DiagnosticError::Write {
                path: PathBuf::from("diagnostics archive"),
                source: io::Error::other(source),
            })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::types::{
        ConfiguredTask, InputFieldDefinition, InputType, OptionApplicability, OptionDefinition,
        PipelineType, RunConfiguration, TaskDefinition,
    };
    use std::collections::BTreeMap;
    use std::io::Cursor;
    use std::sync::Mutex;

    fn input_field(name: &str, password: bool) -> InputFieldDefinition {
        InputFieldDefinition {
            name: name.to_string(),
            label: name.to_string(),
            description: None,
            placeholder: None,
            default: None,
            pipeline_type: PipelineType::String,
            verify: None,
            pattern_message: None,
            password,
            input_type: InputType::Text,
        }
    }

    fn input_option(name: &str, field: &str, password: bool) -> OptionDefinition {
        OptionDefinition::Input {
            name: name.to_string(),
            label: name.to_string(),
            description: None,
            inputs: vec![input_field(field, password)],
            pipeline_override: serde_json::Value::Null,
            icon: None,
            applicability: OptionApplicability {
                controllers: Vec::new(),
                resources: Vec::new(),
            },
        }
    }

    fn minimal_project(options: BTreeMap<String, OptionDefinition>) -> Project {
        Project {
            root: "/project".to_string(),
            interface_version: 2,
            name: "minimal".to_string(),
            label: "Minimal".to_string(),
            version: Some("1.2.3".to_string()),
            language: "zh_cn".to_string(),
            languages: vec!["zh_cn".to_string()],
            controllers: Vec::new(),
            resources: Vec::new(),
            groups: Vec::new(),
            setting_sections: Vec::new(),
            tasks: Vec::new(),
            options,
            global_options: Vec::new(),
            presets: Vec::new(),
            agents: Vec::new(),
            metadata: Default::default(),
        }
    }

    fn zip_entry(zip: &[u8], name: &str) -> Vec<u8> {
        let mut archive = zip::ZipArchive::new(Cursor::new(zip.to_vec())).unwrap();
        let mut file = archive.by_name(name).unwrap();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut bytes).unwrap();
        bytes
    }

    #[test]
    fn export_reports_missing_artifacts_and_creates_a_valid_zip() {
        let temp = std::env::temp_dir().join(format!(
            "maa_tauri_android-diagnostic-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(temp.join("screens")).unwrap();
        fs::write(temp.join("screens/main.png"), [1, 2, 3]).unwrap();
        let output = std::env::temp_dir().join(format!("{}.zip", uuid::Uuid::new_v4()));

        let export = export_bundle(&temp, output.clone(), "run-1", Vec::new()).unwrap();
        assert_eq!(export.manifest.status, "partial");
        assert!(export
            .manifest
            .partial_reasons
            .iter()
            .any(|reason| reason.contains("device-info.txt")));
        let manifest = fs::read_to_string(temp.join(MANIFEST_FILE)).unwrap();
        let checksums = fs::read_to_string(temp.join(CHECKSUMS_FILE)).unwrap();
        let zip = fs::read(&output).unwrap();
        assert!(manifest.contains("\"status\": \"partial\""));
        assert!(checksums.contains("  screens/main.png"));
        assert_eq!(&zip[..4], b"PK\x03\x04");
        let eocd_offset = zip.len() - 22;
        let central_offset =
            u32::from_le_bytes(zip[eocd_offset + 16..eocd_offset + 20].try_into().unwrap())
                as usize;
        let central_size =
            u32::from_le_bytes(zip[eocd_offset + 12..eocd_offset + 16].try_into().unwrap())
                as usize;
        assert_eq!(&zip[central_offset..central_offset + 4], b"PK\x01\x02");
        assert_eq!(central_size, zip.len() - 22 - central_offset);
        assert_eq!(&zip[zip.len() - 22..zip.len() - 18], b"PK\x05\x06");
        let mut entry = central_offset;
        while entry < central_offset + central_size {
            assert_eq!(&zip[entry..entry + 4], b"PK\x01\x02");
            let name_len =
                u16::from_le_bytes(zip[entry + 28..entry + 30].try_into().unwrap()) as usize;
            let local_offset =
                u32::from_le_bytes(zip[entry + 42..entry + 46].try_into().unwrap()) as usize;
            let local_name_len = u16::from_le_bytes(
                zip[local_offset + 26..local_offset + 28]
                    .try_into()
                    .unwrap(),
            ) as usize;
            let local_extra_len = u16::from_le_bytes(
                zip[local_offset + 28..local_offset + 30]
                    .try_into()
                    .unwrap(),
            ) as usize;
            assert_eq!(local_name_len, name_len);
            assert_eq!(local_extra_len, 0);
            assert_eq!(
                &zip[local_offset + 30..local_offset + 30 + name_len],
                &zip[entry + 46..entry + 46 + name_len]
            );
            entry += 46 + name_len;
        }
        assert_eq!(entry, central_offset + central_size);
        fs::remove_dir_all(temp).unwrap();
        fs::remove_file(output).unwrap();
    }

    #[test]
    fn log_archive_contains_logcat_filtered_log_device_info_and_roots() {
        let source = FakeSource {
            capture_failures: Mutex::new(Vec::new()),
            capture_bytes: [0x89, b'P', b'N', b'G'].to_vec(),
        };
        let log_root = std::env::temp_dir().join(format!("log-root-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&log_root).unwrap();
        fs::write(log_root.join("mta.log"), b"app log line\n").unwrap();
        let roots = vec![LogExportRoot {
            entry: "logs/app".to_string(),
            path: log_root.clone(),
        }];
        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        let path = export_log_archive(&source, &roots, None, None, output.clone()).unwrap();

        assert_eq!(path, output);
        let zip = fs::read(&output).unwrap();
        assert_eq!(&zip[..4], b"PK\x03\x04");
        assert!(zip.windows(15).any(|window| window == b"logcat-full.txt"));
        assert!(zip
            .windows(30)
            .any(|window| window == b"maa_tauri_android-filtered.log"));
        assert!(zip
            .windows(19)
            .any(|window| window == b"device-info-payload"));
        assert!(zip.windows(16).any(|window| window == b"logs/app/mta.log"));
        assert!(zip.windows(12).any(|window| window == b"app log line"));
        fs::remove_file(output).unwrap();
        fs::remove_dir_all(log_root).unwrap();
    }

    #[test]
    fn log_archive_preserves_non_utf8_logcat_and_filters_lossily() {
        struct NonUtf8Source;

        impl DiagnosticSource for NonUtf8Source {
            fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no capture"))
            }

            fn device_info(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no device info"))
            }

            fn display_state(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no display state"))
            }

            fn logcat(&self) -> io::Result<Vec<u8>> {
                Ok(b"ignored \xff\nMaaTauriAndroid started \xff\n".to_vec())
            }

            fn dumpsys(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no dumpsys"))
            }

            fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
                Ok(Vec::new())
            }
        }

        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        export_log_archive(&NonUtf8Source, &[], None, None, output.clone()).unwrap();

        let zip = fs::read(&output).unwrap();
        assert!(zip.windows(15).any(|window| window == b"logcat-full.txt"));
        assert!(zip
            .windows(30)
            .any(|window| window == b"maa_tauri_android-filtered.log"));
        assert!(zip
            .windows(23)
            .any(|window| window == b"MaaTauriAndroid started"));
        assert!(!zip.windows(8).any(|window| window == b"ignored \n"));
        fs::remove_file(output).unwrap();
    }

    #[test]
    fn log_archive_rejects_empty_logcat() {
        struct EmptySource;

        impl DiagnosticSource for EmptySource {
            fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
                Ok(Vec::new())
            }

            fn device_info(&self) -> io::Result<Vec<u8>> {
                Ok(Vec::new())
            }

            fn display_state(&self) -> io::Result<Vec<u8>> {
                Ok(Vec::new())
            }

            fn logcat(&self) -> io::Result<Vec<u8>> {
                Ok(Vec::new())
            }

            fn dumpsys(&self) -> io::Result<Vec<u8>> {
                Ok(Vec::new())
            }

            fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
                Ok(Vec::new())
            }
        }

        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        let error = export_log_archive(&EmptySource, &[], None, None, output.clone()).unwrap_err();

        assert!(error.to_string().contains("logcat capture was empty"));
        assert!(!output.exists());
    }

    #[test]
    fn log_archive_copies_roots_and_skips_unavailable_device_info() {
        struct LogOnlySource;

        impl DiagnosticSource for LogOnlySource {
            fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no capture"))
            }

            fn device_info(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no device info"))
            }

            fn display_state(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no display state"))
            }

            fn logcat(&self) -> io::Result<Vec<u8>> {
                Ok(b"MaaTauriAndroid ran\n".to_vec())
            }

            fn dumpsys(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no dumpsys"))
            }

            fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
                Ok(Vec::new())
            }
        }

        let log_root = std::env::temp_dir().join(format!("log-root-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(log_root.join("nested")).unwrap();
        fs::write(log_root.join("nested/maa.log"), b"maa framework log\n").unwrap();
        let roots = vec![LogExportRoot {
            entry: "logs/maa".to_string(),
            path: log_root.clone(),
        }];
        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        export_log_archive(&LogOnlySource, &roots, None, None, output.clone()).unwrap();

        let zip = fs::read(&output).unwrap();
        assert!(!zip.windows(15).any(|window| window == b"device-info.txt"));
        assert!(!zip.windows(14).any(|window| window == b"properties.txt"));
        assert!(zip
            .windows(23)
            .any(|window| window == b"logs/maa/nested/maa.log"));
        assert!(zip.windows(17).any(|window| window == b"maa framework log"));
        fs::remove_dir_all(log_root).unwrap();
        fs::remove_file(output).unwrap();
    }

    #[test]
    fn log_archive_contains_project_and_settings_snapshots_without_password_values() {
        let source = FakeSource {
            capture_failures: Mutex::new(Vec::new()),
            capture_bytes: Vec::new(),
        };
        let project = minimal_project(BTreeMap::from([(
            "account".to_string(),
            input_option("account", "token", true),
        )]));
        let mut configuration = UserConfiguration::default();
        configuration.active_resource = Some("default".to_string());
        configuration.global_option_values.insert(
            "account".to_string(),
            OptionValue::Inputs {
                values: BTreeMap::from([("token".to_string(), "secret".to_string())]),
            },
        );
        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        export_log_archive(
            &source,
            &[],
            Some(LogExportSnapshots {
                project,
                configuration,
            }),
            None,
            output.clone(),
        )
        .unwrap();

        let zip = fs::read(&output).unwrap();
        let settings: UserConfiguration =
            serde_json::from_slice(&zip_entry(&zip, "snapshots/settings.json")).unwrap();
        let exported_project: serde_json::Value =
            serde_json::from_slice(&zip_entry(&zip, "snapshots/project.json")).unwrap();
        let OptionValue::Inputs { values } = &settings.global_option_values["account"] else {
            panic!("account should be an input option");
        };

        assert!(!values.contains_key("token"));
        assert_eq!(exported_project["name"], serde_json::json!("minimal"));
        fs::remove_file(output).unwrap();
    }

    #[test]
    fn removes_declared_password_inputs_but_preserves_ordinary_inputs() {
        let project = minimal_project(BTreeMap::from([(
            "credentials".to_string(),
            OptionDefinition::Input {
                name: "credentials".to_string(),
                label: "Credentials".to_string(),
                description: None,
                inputs: vec![
                    input_field("password", true),
                    input_field("secondary", false),
                ],
                pipeline_override: serde_json::Value::Null,
                icon: None,
                applicability: OptionApplicability {
                    controllers: Vec::new(),
                    resources: Vec::new(),
                },
            },
        )]));
        let mut configuration = UserConfiguration::default();
        configuration.run_configurations.push(RunConfiguration {
            id: "run".to_string(),
            name: "Run".to_string(),
            tasks: vec![ConfiguredTask {
                instance_id: "login".to_string(),
                task_name: "Login".to_string(),
                enabled: true,
                option_values: BTreeMap::from([
                    (
                        "credentials".to_string(),
                        OptionValue::Inputs {
                            values: BTreeMap::from([
                                ("password".to_string(), "123456".to_string()),
                                ("secondary".to_string(), "654321".to_string()),
                            ]),
                        },
                    ),
                    (
                        "mode".to_string(),
                        OptionValue::Single {
                            case: "fast".to_string(),
                        },
                    ),
                ]),
                custom_label: None,
            }],
        });

        let exported = remove_password_values(&project, configuration);
        let task = &exported.run_configurations[0].tasks[0];
        let OptionValue::Inputs { values } = &task.option_values["credentials"] else {
            panic!("credentials should be an input option");
        };

        assert!(!values.contains_key("password"));
        assert_eq!(values["secondary"], "654321");
        let OptionValue::Single { case } = &task.option_values["mode"] else {
            panic!("mode should be a single-choice option");
        };
        assert_eq!(case, "fast");
        assert!(task.enabled);
    }

    #[test]
    fn run_task_snapshot_removes_passwords_and_marks_selected_tasks() {
        let project = minimal_project(BTreeMap::from([(
            "credentials".to_string(),
            input_option("credentials", "password", true),
        )]));
        let configured = ConfiguredTask {
            instance_id: "login".to_string(),
            task_name: "Login".to_string(),
            enabled: true,
            option_values: BTreeMap::from([
                (
                    "credentials".to_string(),
                    OptionValue::Inputs {
                        values: BTreeMap::from([
                            ("password".to_string(), "secret".to_string()),
                            ("secondary".to_string(), "visible".to_string()),
                        ]),
                    },
                ),
                (
                    "mode".to_string(),
                    OptionValue::Single {
                        case: "fast".to_string(),
                    },
                ),
            ]),
            custom_label: Some("Daily login".to_string()),
        };
        let selected = BTreeSet::from(["login".to_string()]);

        let snapshot = build_run_task_snapshot(
            &project,
            &[
                ResolvedTask {
                    task: TaskDefinition {
                        name: "Login".to_string(),
                        label: "Login".to_string(),
                        entry: "Login".to_string(),
                        description: None,
                        groups: Vec::new(),
                        controllers: Vec::new(),
                        resources: Vec::new(),
                        options: vec!["credentials".to_string(), "mode".to_string()],
                        pipeline_override: serde_json::Value::Null,
                        default_check: true,
                        icon: None,
                    },
                    configured: Some(configured),
                    enabled: true,
                    unavailable_reason: None,
                    pipeline_override: serde_json::Value::Null,
                },
                ResolvedTask {
                    task: TaskDefinition {
                        name: "Arena".to_string(),
                        label: "Arena".to_string(),
                        entry: "Arena".to_string(),
                        description: None,
                        groups: Vec::new(),
                        controllers: Vec::new(),
                        resources: Vec::new(),
                        options: Vec::new(),
                        pipeline_override: serde_json::Value::Null,
                        default_check: false,
                        icon: None,
                    },
                    configured: None,
                    enabled: false,
                    unavailable_reason: Some("controller unavailable".to_string()),
                    pipeline_override: serde_json::Value::Null,
                },
            ],
            &selected,
            Some("run-config".to_string()),
        );

        assert_eq!(snapshot.run_configuration_id.as_deref(), Some("run-config"));
        assert_eq!(snapshot.tasks.len(), 2);
        let login = &snapshot.tasks[0];
        assert_eq!(login.instance_id.as_deref(), Some("login"));
        assert_eq!(login.task_name, "Login");
        assert_eq!(login.task_label, "Login");
        assert_eq!(login.custom_label.as_deref(), Some("Daily login"));
        assert!(login.enabled);
        assert!(login.selected);
        let OptionValue::Inputs { values } = &login.option_values["credentials"] else {
            panic!("credentials should be an input option");
        };
        assert!(!values.contains_key("password"));
        assert_eq!(values["secondary"], "visible");

        let arena = &snapshot.tasks[1];
        assert_eq!(arena.instance_id, None);
        assert!(!arena.enabled);
        assert!(!arena.selected);
        assert_eq!(
            arena.unavailable_reason.as_deref(),
            Some("controller unavailable")
        );
    }

    fn write_run_record(runs_dir: &Path, execution_id: &str, file_name: &str, body: &[u8]) {
        let run_dir = runs_dir.join(execution_id);
        fs::create_dir_all(run_dir.join("logs")).unwrap();
        fs::create_dir_all(run_dir.join("screens")).unwrap();
        fs::write(run_dir.join(file_name), body).unwrap();
        fs::write(run_dir.join("screens/main.png"), [1, 2, 3]).unwrap();
        fs::write(run_dir.join("screens/manual-123.png"), [4, 5, 6]).unwrap();
        fs::write(run_dir.join("logs/nested.log"), b"nested").unwrap();
    }

    #[test]
    fn copy_run_histories_copies_recent_jsonl_and_screenshots() {
        let runs_dir = std::env::temp_dir().join(format!(
            "maa_tauri_android-export-runs-{}",
            uuid::Uuid::new_v4()
        ));
        let staging_dir = std::env::temp_dir().join(format!(
            "maa_tauri_android-export-staging-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&staging_dir).unwrap();
        for index in 1..=21 {
            let execution_id = format!("run-{index:02}");
            let file_name = format!("run_20240101_{index:02}0000_2.jsonl");
            write_run_record(&runs_dir, &execution_id, &file_name, b"run record\n");
        }

        copy_run_histories(Some(&runs_dir), &staging_dir);

        let exported_runs = staging_dir.join("logs/runs");
        let mut exported_files: Vec<_> = fs::read_dir(&exported_runs)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("run_") && name.ends_with(".jsonl"))
            .collect();
        exported_files.sort();
        assert_eq!(exported_files.len(), 20);
        assert!(exported_files.contains(&"run_20240101_210000_2_run-21.jsonl".to_string()));
        assert!(exported_files.contains(&"run_20240101_020000_2_run-02.jsonl".to_string()));
        assert!(exported_runs
            .join("run_20240101_210000_2_run-21.jsonl")
            .is_file());
        assert!(exported_runs
            .join("run_20240101_020000_2_run-02.jsonl")
            .is_file());
        assert!(!exported_runs.join("run-21").exists());
        assert!(!exported_runs.join("run-02").exists());
        let exported_screens = staging_dir.join("logs/runs/screens");
        assert_eq!(
            fs::read(exported_screens.join("run-21/main.png")).unwrap(),
            [1, 2, 3]
        );
        assert_eq!(
            fs::read(exported_screens.join("run-02/manual-123.png")).unwrap(),
            [4, 5, 6]
        );
        assert!(!exported_screens.join("run-01").exists());
        let index: serde_json::Value =
            serde_json::from_slice(&fs::read(exported_runs.join("index.json")).unwrap()).unwrap();
        assert_eq!(index["version"], 1);
        assert_eq!(index["runs"].as_array().unwrap().len(), 20);
        assert_eq!(
            index["runs"][0]["fileName"],
            "run_20240101_210000_2_run-21.jsonl"
        );
        assert_eq!(index["runs"][0]["executionId"], "run-21");
        assert_eq!(index["runs"][0]["taskCount"], 2);
        assert_eq!(
            index["runs"][19]["fileName"],
            "run_20240101_020000_2_run-02.jsonl"
        );
        fs::remove_dir_all(runs_dir).unwrap();
        fs::remove_dir_all(staging_dir).unwrap();
    }

    #[test]
    fn copy_run_histories_ignores_a_missing_runs_directory() {
        let staging_dir = std::env::temp_dir().join(format!(
            "maa_tauri_android-export-missing-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&staging_dir).unwrap();

        copy_run_histories(Some(&staging_dir.join("missing")), &staging_dir);

        assert!(!staging_dir.join("logs/runs").exists());
        fs::remove_dir_all(staging_dir).unwrap();
    }

    #[test]
    fn log_archive_includes_recent_run_history_and_screenshots() {
        struct LogOnlySource;

        impl DiagnosticSource for LogOnlySource {
            fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no capture"))
            }

            fn device_info(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no device info"))
            }

            fn display_state(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no display state"))
            }

            fn logcat(&self) -> io::Result<Vec<u8>> {
                Ok(b"MaaTauriAndroid ran\n".to_vec())
            }

            fn dumpsys(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no dumpsys"))
            }

            fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
                Ok(Vec::new())
            }
        }

        let source = LogOnlySource;
        let runs_dir = std::env::temp_dir().join(format!(
            "maa_tauri_android-archive-runs-{}",
            uuid::Uuid::new_v4()
        ));
        write_run_record(
            &runs_dir,
            "run-1",
            "run_20240101_120000_2.jsonl",
            b"started with snapshot\n",
        );
        let output = std::env::temp_dir().join(format!("logs-{}.zip", uuid::Uuid::new_v4()));

        export_log_archive(&source, &[], None, Some(&runs_dir), output.clone()).unwrap();

        let zip = fs::read(&output).unwrap();
        let history = zip_entry(&zip, "logs/runs/run_20240101_120000_2_run-1.jsonl");
        assert_eq!(history, b"started with snapshot\n");
        assert_eq!(
            zip_entry(&zip, "logs/runs/screens/run-1/main.png"),
            [1, 2, 3].as_slice()
        );
        let index = zip_entry(&zip, "logs/runs/index.json");
        let index: serde_json::Value = serde_json::from_slice(&index).unwrap();
        assert_eq!(
            index["runs"][0]["fileName"],
            "run_20240101_120000_2_run-1.jsonl"
        );
        assert_eq!(index["runs"][0]["executionId"], "run-1");
        fs::remove_dir_all(runs_dir).unwrap();
        fs::remove_file(output).unwrap();
    }

    struct FakeSource {
        capture_failures: Mutex<Vec<u32>>,
        capture_bytes: Vec<u8>,
    }

    impl DiagnosticSource for FakeSource {
        fn capture_png(&self, display_id: u32) -> io::Result<Vec<u8>> {
            if self.capture_failures.lock().unwrap().contains(&display_id) {
                return Err(io::Error::other("capture unavailable"));
            }
            Ok(self.capture_bytes.clone())
        }

        fn device_info(&self) -> io::Result<Vec<u8>> {
            Ok(b"device-info-payload".to_vec())
        }

        fn display_state(&self) -> io::Result<Vec<u8>> {
            Ok(b"mDisplayId=2\nmDisplayId=0".to_vec())
        }

        fn logcat(&self) -> io::Result<Vec<u8>> {
            Ok(b"ignored\nMaaTauriAndroid started\nMaa completed".to_vec())
        }

        fn dumpsys(&self) -> io::Result<Vec<u8>> {
            Ok(b"dumpsys".to_vec())
        }

        fn bugreport(&self, destination: &Path) -> io::Result<Vec<String>> {
            fs::write(destination, b"PK\x03\x04").unwrap();
            Ok(vec!["running|50".to_string(), "done|100".to_string()])
        }
    }

    #[test]
    fn collector_writes_all_platform_artifacts_and_reports_capture_gaps() {
        let runs_root = std::env::temp_dir().join(format!(
            "maa_tauri_android-collector-{}",
            uuid::Uuid::new_v4()
        ));
        let run_dir = runs_root.join("run-1");
        fs::create_dir_all(run_dir.join("logs")).unwrap();
        crate::run_log::RunLogger::create(&runs_root, "run-1", 0).unwrap();
        fs::create_dir_all(run_dir.join("screens")).unwrap();
        fs::write(
            run_dir.join("screens/failure.png"),
            [0x89, b'P', b'N', b'G'],
        )
        .unwrap();
        let source = FakeSource {
            capture_failures: Mutex::new(vec![2]),
            capture_bytes: [0x89, b'P', b'N', b'G', 1, 2, 3].to_vec(),
        };

        let gaps = collect_artifacts(&source, &run_dir).unwrap();

        for name in EXPECTED_ARTIFACTS {
            assert!(run_dir.join(name).is_file(), "{name} was not collected");
        }
        assert!(!run_dir.join("screens/virtual-2.png").is_file());
        assert!(gaps.iter().any(|gap| gap.contains("screens/virtual-2.png")));
        let filtered =
            fs::read_to_string(run_dir.join("logs/maa_tauri_android-filtered.log")).unwrap();
        assert!(filtered.contains("MaaTauriAndroid started"));
        assert!(filtered.contains("Maa completed"));
        assert!(!filtered.contains("ignored"));
        fs::remove_dir_all(runs_root).unwrap();
    }

    #[test]
    fn manual_screenshots_are_validated_and_named_separately() {
        let runs_root =
            std::env::temp_dir().join(format!("maa_tauri_android-manual-{}", uuid::Uuid::new_v4()));
        let run_dir = runs_root.join("run-1");
        fs::create_dir_all(&run_dir).unwrap();
        let source = FakeSource {
            capture_failures: Mutex::new(Vec::new()),
            capture_bytes: [0x89, b'P', b'N', b'G', 1, 2, 3].to_vec(),
        };

        let path = capture_manual_screenshot(&source, &run_dir).unwrap();

        assert_eq!(path.parent().unwrap(), run_dir.join("screens").as_path());
        assert!(path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("manual-") && name.ends_with(".png")));
        assert_eq!(fs::read(&path).unwrap(), source.capture_bytes);
        fs::remove_dir_all(runs_root).unwrap();
    }

    #[test]
    fn manual_screenshot_rejects_invalid_png_data() {
        let runs_root =
            std::env::temp_dir().join(format!("maa_tauri_android-manual-{}", uuid::Uuid::new_v4()));
        let run_dir = runs_root.join("run-1");
        fs::create_dir_all(&run_dir).unwrap();
        let source = FakeSource {
            capture_failures: Mutex::new(Vec::new()),
            capture_bytes: b"not-a-png".to_vec(),
        };

        let error = capture_manual_screenshot(&source, &run_dir).unwrap_err();

        assert!(error.to_string().contains("could not read"));
        let screenshots = run_dir.join("screens").read_dir().unwrap();
        assert!(!screenshots.into_iter().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("manual-")
        }));
        fs::remove_dir_all(runs_root).unwrap();
    }

    #[test]
    fn exported_device_snapshot_names_the_client_and_framework() {
        struct DeviceSource;

        impl DiagnosticSource for DeviceSource {
            fn capture_png(&self, _display_id: u32) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no capture"))
            }

            fn device_info(&self) -> io::Result<Vec<u8>> {
                Ok(b"Device      : Pixel 9".to_vec())
            }

            fn display_state(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no display state"))
            }

            fn logcat(&self) -> io::Result<Vec<u8>> {
                Ok(b"MaaTauriAndroid ran\n".to_vec())
            }

            fn dumpsys(&self) -> io::Result<Vec<u8>> {
                Err(io::Error::other("no dumpsys"))
            }

            fn bugreport(&self, _destination: &Path) -> io::Result<Vec<String>> {
                Ok(Vec::new())
            }
        }

        let staging = std::env::temp_dir().join(format!("snapshot-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&staging).unwrap();

        write_device_snapshot(&DeviceSource, &staging);

        let snapshot = fs::read_to_string(staging.join("device-info.txt")).unwrap();
        assert!(snapshot.contains("Device      : Pixel 9"));
        assert!(snapshot.contains(crate::version::device_info_rows().as_str()));
        // The collector's payload has no trailing newline; the appended rows must
        // not be glued onto its last line.
        assert!(snapshot.contains("Pixel 9\nMaaTauriAndroid"));
        fs::remove_dir_all(staging).unwrap();
    }

    #[test]
    fn cleanup_removes_only_run_directories_and_accepts_missing_storage() {
        let runs_root = std::env::temp_dir().join(format!(
            "maa_tauri_android-cleanup-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(runs_root.join("run-1").join("logs")).unwrap();
        fs::create_dir_all(runs_root.join("run-2")).unwrap();
        fs::write(runs_root.join("configuration.json"), b"keep").unwrap();

        let deleted = clear_run_directories(&runs_root).unwrap();
        let missing = clear_run_directories(&runs_root.join("missing")).unwrap();

        assert_eq!(deleted, 2);
        assert_eq!(missing, 0);
        assert!(!runs_root.join("run-1").exists());
        assert!(!runs_root.join("run-2").exists());
        assert!(runs_root.join("configuration.json").is_file());
        fs::remove_dir_all(runs_root).unwrap();
    }

    #[test]
    fn clear_dir_contents_removes_all_entries_but_keeps_root() {
        let log_root = std::env::temp_dir().join(format!(
            "maa_tauri_android-clear-logs-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(log_root.join("nested")).unwrap();
        fs::write(log_root.join("maafw.log"), b"active log").unwrap();
        fs::write(log_root.join("maafw.bak.1.log"), b"rotated").unwrap();
        fs::write(log_root.join("nested").join("error.png"), b"png").unwrap();

        let missing = clear_dir_contents(&log_root.join("missing")).unwrap();
        let deleted = clear_dir_contents(&log_root).unwrap();

        assert_eq!(missing, 0);
        assert_eq!(deleted, 3);
        assert!(!log_root.join("maafw.log").exists());
        assert!(!log_root.join("maafw.bak.1.log").exists());
        assert!(!log_root.join("nested").exists());
        assert!(log_root.is_dir());
        fs::remove_dir_all(log_root).unwrap();
    }
}

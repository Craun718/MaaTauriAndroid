use serde::Serialize;
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{
    fs::{self, File},
    io::{self, Read, Seek, Write},
};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const CHECKSUMS_FILE: &str = "checksums.sha256";

pub const EXPECTED_ARTIFACTS: &[&str] = &[
    "bugreport.zip",
    "device-info.txt",
    "display-state.txt",
    "dumpsys.txt",
    "logs/bugreport-progress.txt",
    "logs/logcat-full.txt",
    "logs/maa_tauri_android-filtered.log",
    "run.jsonl",
    "screens/main.png",
];

pub trait DiagnosticSource {
    fn capture_png(&self, display_id: u32) -> io::Result<Vec<u8>>;
    fn device_info(&self) -> io::Result<Vec<u8>>;
    fn display_state(&self) -> io::Result<Vec<u8>>;
    fn logcat(&self) -> io::Result<Vec<u8>>;
    fn dumpsys(&self) -> io::Result<Vec<u8>>;
    fn bugreport(&self, destination: &Path) -> io::Result<Vec<String>>;
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
        ("device-info.txt", source.device_info()),
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
        let full_log =
            fs::read_to_string(&full_log_path).map_err(|source| DiagnosticError::Read {
                path: full_log_path.clone(),
                source,
            })?;
        let filtered = filtered_maa_tauri_android_log(&full_log);
        if filtered.trim().is_empty() {
            gaps.push("logs/maa_tauri_android-filtered.log: no MaaTauriAndroid or Maa lines matched".to_string());
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
    let service = env
        .call_static_method(
            "top/natsuu/maa/tauri/android/control/ControlHost",
            "current",
            "()Ltop/natsuu/maa/tauri/android/IMaaTauriAndroidControlService;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|error| io::Error::other(error.to_string()))?;
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
    file: File,
    offset: u64,
    central: Vec<u8>,
    entries: u16,
}

struct ZipEntry {
    crc32: u32,
    size: u64,
    offset: u64,
}

impl ZipWriter {
    fn create(path: PathBuf) -> Result<Self, DiagnosticError> {
        let file = File::create(&path).map_err(|source| DiagnosticError::Write {
            path: path.clone(),
            source,
        })?;
        Ok(Self {
            file,
            offset: 0,
            central: Vec::new(),
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
        if size > u32::MAX as u64 || self.offset > u32::MAX as u64 {
            return Err(DiagnosticError::TooLarge { path });
        }
        let mut source = File::open(&path).map_err(|source| DiagnosticError::Read {
            path: path.clone(),
            source,
        })?;
        let offset = self.offset;
        let mut crc = Crc32::new();
        let local_name = name.as_bytes();
        let header_size = 30 + local_name.len();
        self.file
            .seek(io::SeekFrom::Start(offset))
            .and_then(|_| {
                self.file.write_all(&[
                    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0,
                    0, 0,
                ])
            })
            .and_then(|_| {
                self.file.write_all(&[
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    (size & 0xff) as u8,
                    ((size >> 8) & 0xff) as u8,
                    ((size >> 16) & 0xff) as u8,
                    ((size >> 24) & 0xff) as u8,
                ])
            })
            .and_then(|_| {
                self.file
                    .write_all(&(local_name.len() as u16).to_le_bytes())
            })
            .and_then(|_| self.file.write_all(&[0, 0]))
            .and_then(|_| self.file.write_all(local_name))
            .map_err(|source| DiagnosticError::Write {
                path: path.clone(),
                source,
            })?;

        let mut copied = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = source
                .read(&mut buffer)
                .map_err(|source| DiagnosticError::Read {
                    path: path.clone(),
                    source,
                })?;
            if count == 0 {
                break;
            }
            crc.update(&buffer[..count]);
            self.file
                .write_all(&buffer[..count])
                .map_err(|source| DiagnosticError::Write {
                    path: path.clone(),
                    source,
                })?;
            copied += count as u64;
        }
        if copied != size {
            return Err(DiagnosticError::Read {
                path,
                source: io::Error::new(io::ErrorKind::UnexpectedEof, "file changed while reading"),
            });
        }

        self.offset += header_size as u64 + size;
        let entry = ZipEntry {
            crc32: crc.finish(),
            size,
            offset,
        };
        self.central.extend_from_slice(&[
            0x50, 0x4b, 0x01, 0x02, // signature
            0x14, 0x00, // version made by
            0x08, 0x00, // version needed
            0x00, 0x00, // flags
            0x00, 0x00, // method: stored
            0x00, 0x00, 0x00, 0x00, // modification time and date
        ]);
        self.central.extend_from_slice(&entry.crc32.to_le_bytes());
        self.central
            .extend_from_slice(&(entry.size as u32).to_le_bytes());
        self.central
            .extend_from_slice(&(entry.size as u32).to_le_bytes());
        self.central
            .extend_from_slice(&(name.len() as u16).to_le_bytes());
        self.central.extend_from_slice(&[
            0, 0, // extra length
            0, 0, // comment length
            0, 0, // disk number start
            0, 0, // internal attributes
            0, 0, 0, 0, // external attributes
        ]);
        self.central
            .extend_from_slice(&(entry.offset as u32).to_le_bytes());
        self.central.extend_from_slice(name.as_bytes());
        self.entries = self.entries.saturating_add(1);
        Ok(())
    }

    fn finish(mut self) -> Result<(), DiagnosticError> {
        let central_offset = self.offset;
        let central_size = self.central.len() as u64;
        if central_offset + central_size > u32::MAX as u64 {
            return Err(DiagnosticError::TooLarge {
                path: PathBuf::from("diagnostics archive"),
            });
        }
        self.file
            .seek(io::SeekFrom::Start(central_offset))
            .and_then(|_| self.file.write_all(&self.central))
            .and_then(|_| self.file.write_all(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]))
            .and_then(|_| self.file.write_all(&self.entries.to_le_bytes()))
            .and_then(|_| self.file.write_all(&self.entries.to_le_bytes()))
            .and_then(|_| self.file.write_all(&(central_size as u32).to_le_bytes()))
            .and_then(|_| self.file.write_all(&(central_offset as u32).to_le_bytes()))
            .and_then(|_| self.file.write_all(&[0, 0]))
            .and_then(|_| self.file.flush())
            .map_err(|source| DiagnosticError::Write {
                path: PathBuf::from("diagnostics archive"),
                source,
            })?;
        Ok(())
    }
}

struct Crc32(u32);

impl Crc32 {
    fn new() -> Self {
        Self(0xffff_ffff)
    }

    fn update(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 = crc_table()[((self.0 ^ u32::from(*byte)) & 0xff) as usize] ^ (self.0 >> 8);
        }
    }

    fn finish(self) -> u32 {
        !self.0
    }
}

fn crc_table() -> &'static [u32; 256] {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0_u32; 256];
        for (index, entry) in table.iter_mut().enumerate() {
            let mut value = index as u32;
            for _ in 0..8 {
                value = if value & 1 != 0 {
                    0xedb8_8320 ^ (value >> 1)
                } else {
                    value >> 1
                };
            }
            *entry = value;
        }
        table
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn export_reports_missing_artifacts_and_creates_a_valid_zip() {
        let temp = std::env::temp_dir().join(format!("maa_tauri_android-diagnostic-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(temp.join("screens")).unwrap();
        fs::write(temp.join("run.jsonl"), "{\"executionId\":\"run-1\"}\n").unwrap();
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
        assert!(checksums.contains("  run.jsonl"));
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
        fs::remove_dir_all(temp).unwrap();
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
            Ok(b"device".to_vec())
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
        let runs_root =
            std::env::temp_dir().join(format!("maa_tauri_android-collector-{}", uuid::Uuid::new_v4()));
        let run_dir = runs_root.join("run-1");
        fs::create_dir_all(run_dir.join("logs")).unwrap();
        crate::run_log::RunLogger::create(&runs_root, "run-1").unwrap();
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
        let filtered = fs::read_to_string(run_dir.join("logs/maa_tauri_android-filtered.log")).unwrap();
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
    fn cleanup_removes_only_run_directories_and_accepts_missing_storage() {
        let runs_root =
            std::env::temp_dir().join(format!("maa_tauri_android-cleanup-{}", uuid::Uuid::new_v4()));
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
}

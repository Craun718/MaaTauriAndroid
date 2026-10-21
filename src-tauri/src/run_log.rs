use chrono::{DateTime, Local};
use log::Level;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APPLICATION_LOG_FILE_STEM: &str = "mta";
pub const RUN_EVENT_LOG_FILE_STEM: &str = "mta-run";
pub const RUN_EVENT_TARGET: &str = "mta::run";

#[derive(Debug, thiserror::Error)]
pub enum RunLogError {
    #[error("could not serialize run event: {0}")]
    Serialize(serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunEventKind {
    Started,
    Preparing,
    Task,
    Stopping,
    Failure,
    Warning,
    Focus,
    Completed,
    Cancelled,
    Screenshot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub execution_id: String,
    pub sequence: u64,
    pub at_unix_ms: u64,
    pub kind: RunEventKind,
    pub state: crate::runtime::RunState,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub struct RunLogger {
    execution_id: String,
    run_dir: PathBuf,
    sequence: Mutex<u64>,
    /// Per-run JSONL history writer. `None` when the file could not be
    /// opened: the run proceeds normally and simply leaves no record.
    history: Mutex<Option<BufWriter<fs::File>>>,
    history_path: Option<PathBuf>,
    ui_sink: RwLock<Option<Arc<dyn Fn(&RunEvent) + Send + Sync>>>,
    /// Mirrors every event into the Android floating panel's log feed. Off
    /// unless the run installed that panel: a run nothing is drawing over has
    /// no use for the feed, and keeping it off keeps the panel from ever
    /// showing a run that does not own it.
    overlay_mirror: AtomicBool,
}

static LATEST_LOGGER: RwLock<Option<Arc<RunLogger>>> = RwLock::new(None);

pub fn set_latest_global(logger: Arc<RunLogger>) {
    *LATEST_LOGGER
        .write()
        .expect("latest global run log lock poisoned") = Some(logger);
}

pub fn latest_global() -> Option<Arc<RunLogger>> {
    LATEST_LOGGER
        .read()
        .expect("latest global run log lock poisoned")
        .clone()
}

/// `run_<yyyyMMdd>_<HHmmss>_<task_count>.jsonl`: the start time and task
/// count travel in the name so the history list never reads file contents.
/// The matching parser lives in `run_history::parse_history_file_name`.
fn history_file_name(started_at: DateTime<Local>, task_count: usize) -> String {
    format!(
        "run_{}_{}.jsonl",
        started_at.format("%Y%m%d_%H%M%S"),
        task_count
    )
}

/// Best-effort open of the history file. Any open error (a directory
/// occupying the path, permissions, ...) yields `None` and the run goes on
/// without a persistent record.
fn open_history(run_dir: &Path, file_name: &str) -> Option<(PathBuf, BufWriter<fs::File>)> {
    let path = run_dir.join(file_name);
    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => Some((path, BufWriter::new(file))),
        Err(error) => {
            log::warn!("run history will not be recorded in {path:?}: {error}");
            None
        }
    }
}

impl RunLogger {
    pub fn create(
        runs_dir: &Path,
        execution_id: &str,
        task_count: usize,
    ) -> Result<Self, RunLogError> {
        let run_dir = runs_dir.join(sanitize(execution_id));
        if let Err(error) = fs::create_dir_all(run_dir.join("logs")) {
            log::warn!("optional run diagnostics directory unavailable at {run_dir:?}: {error}");
        }
        let file_name = history_file_name(Local::now(), task_count);
        let (history_path, history) = open_history(&run_dir, &file_name)
            .map(|(path, writer)| (Some(path), Some(writer)))
            .unwrap_or((None, None));
        Ok(Self {
            execution_id: execution_id.to_string(),
            run_dir,
            sequence: Mutex::new(0),
            history: Mutex::new(history),
            history_path,
            ui_sink: RwLock::new(None),
            overlay_mirror: AtomicBool::new(false),
        })
    }

    pub fn execution_id(&self) -> &str {
        &self.execution_id
    }

    pub fn run_dir(&self) -> &Path {
        &self.run_dir
    }

    pub fn set_ui_sink(&self, sink: Arc<dyn Fn(&RunEvent) + Send + Sync>) {
        *self.ui_sink.write().expect("run log UI sink lock poisoned") = Some(sink);
    }

    /// Turns the floating panel's log mirror on or off for this run.
    pub fn set_overlay_mirror(&self, enabled: bool) {
        self.overlay_mirror.store(enabled, Ordering::Relaxed);
    }

    pub fn append(
        &self,
        kind: RunEventKind,
        state: crate::runtime::RunState,
        message: impl Into<String>,
        task_name: Option<String>,
        data: Option<Value>,
    ) -> Result<RunEvent, RunLogError> {
        let mut sequence = self
            .sequence
            .lock()
            .expect("run log sequence lock poisoned");
        *sequence += 1;
        let event = RunEvent {
            execution_id: self.execution_id.clone(),
            sequence: *sequence,
            at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or_default(),
            kind,
            state,
            message: message.into(),
            task_name,
            data,
        };
        let payload = serde_json::to_string(&event).map_err(RunLogError::Serialize)?;
        // Best-effort persistence: a history write failure must never break
        // the run or the live UI feed, so errors are swallowed on purpose.
        if let Some(file) = self
            .history
            .lock()
            .expect("run history lock poisoned")
            .as_mut()
        {
            let _ = writeln!(file, "{payload}").and_then(|()| file.flush());
        }
        let level = match kind {
            RunEventKind::Failure => Level::Error,
            RunEventKind::Warning => Level::Warn,
            _ => Level::Info,
        };
        log::log!(target: RUN_EVENT_TARGET, level, "{payload}");
        if self.overlay_mirror.load(Ordering::Relaxed) {
            crate::run_progress::record_overlay_log(
                event.at_unix_ms,
                overlay_line_level(kind),
                &event.message,
            );
        }
        Ok(event)
    }

    /// Appends and forwards a copy to listeners that cannot own an `AppHandle`
    /// (the Python agent reader and background task runner, for example).
    pub fn append_to_ui(
        &self,
        kind: RunEventKind,
        state: crate::runtime::RunState,
        message: impl Into<String>,
        task_name: Option<String>,
        data: Option<Value>,
    ) -> Result<RunEvent, RunLogError> {
        let event = self.append(kind, state, message, task_name, data)?;
        if let Some(sink) = self
            .ui_sink
            .read()
            .expect("run log UI sink lock poisoned")
            .as_ref()
        {
            sink(&event);
        }
        Ok(event)
    }
}

/// Panel rows are colour-coded, so the level travels with the mirrored line.
fn overlay_line_level(kind: RunEventKind) -> &'static str {
    match kind {
        RunEventKind::Failure => "error",
        RunEventKind::Warning => "warn",
        _ => "info",
    }
}

pub fn sanitize(value: &str) -> String {
    let output = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if output.is_empty() {
        "run".to_string()
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RunState;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn appends_sequenced_run_events() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let logger = RunLogger::create(&root, "run/one", 2).unwrap();
        let first = logger
            .append(
                RunEventKind::Preparing,
                RunState::Preparing,
                "prepared",
                None,
                None,
            )
            .unwrap();
        let second = logger
            .append(
                RunEventKind::Task,
                RunState::Running,
                "task failed",
                Some("Login".to_string()),
                None,
            )
            .unwrap();
        assert_eq!(first.execution_id, "run/one");
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);
        assert_eq!(second.task_name.as_deref(), Some("Login"));
        assert!(logger.run_dir().join("logs").is_dir());
        assert!(logger.history_path.is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overlay_line_level_matches_the_event_severity() {
        assert_eq!(overlay_line_level(RunEventKind::Failure), "error");
        assert_eq!(overlay_line_level(RunEventKind::Warning), "warn");
        assert_eq!(overlay_line_level(RunEventKind::Started), "info");
        assert_eq!(overlay_line_level(RunEventKind::Focus), "info");
    }

    #[test]
    fn append_to_ui_forwards_exactly_once() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let logger = RunLogger::create(&root, "run/ui", 0).unwrap();
        let messages: Arc<StdMutex<Vec<String>>> = Arc::default();
        let sink_messages = messages.clone();
        logger.set_ui_sink(Arc::new(move |event| {
            sink_messages.lock().unwrap().push(event.message.clone());
        }));

        logger
            .append_to_ui(
                RunEventKind::Task,
                RunState::Running,
                "agent line",
                None,
                None,
            )
            .unwrap();

        assert_eq!(*messages.lock().unwrap(), ["agent line"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_file_round_trips_every_event() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let logger = RunLogger::create(&root, "run/history", 3).unwrap();
        let history_path = logger.history_path.clone().unwrap();
        let file_name = history_path.file_name().unwrap().to_string_lossy();
        assert!(file_name.starts_with("run_"));
        assert!(file_name.ends_with("_3.jsonl"));
        let first = logger
            .append(
                RunEventKind::Started,
                RunState::Running,
                "The run started",
                None,
                Some(serde_json::json!({ "tasks": ["A", "B"] })),
            )
            .unwrap();
        let second = logger
            .append(
                RunEventKind::Completed,
                RunState::Idle,
                "The run completed",
                None,
                None,
            )
            .unwrap();
        let content = fs::read_to_string(&history_path).unwrap();
        let events: Vec<RunEvent> = content
            .lines()
            .map(serde_json::from_str)
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(events, vec![first, second]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unavailable_run_directory_keeps_live_events_working() {
        let root = std::env::temp_dir().join(format!("mta-unavailable-{}", uuid::Uuid::new_v4()));
        fs::write(&root, b"not a directory").unwrap();
        let logger = RunLogger::create(&root, "run", 1).unwrap();
        assert!(logger.history_path.is_none());
        let event = logger
            .append(
                RunEventKind::Preparing,
                RunState::Preparing,
                "still running",
                None,
                None,
            )
            .unwrap();
        assert_eq!(event.sequence, 1);
        assert_eq!(event.message, "still running");
        fs::remove_file(root).unwrap();
    }

    #[test]
    fn history_open_failure_degrades_gracefully() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let run_dir = root.join(sanitize("run/blocked"));
        fs::create_dir_all(run_dir.join("logs")).unwrap();
        // A directory occupying the history file path makes the open fail
        // on every platform, exercising the best-effort fallback.
        fs::create_dir_all(run_dir.join("run_20200101_000000_4.jsonl")).unwrap();
        assert!(open_history(&run_dir, "run_20200101_000000_4.jsonl").is_none());

        let logger = RunLogger {
            execution_id: "run/blocked".to_string(),
            run_dir,
            sequence: Mutex::new(0),
            history: Mutex::new(None),
            history_path: None,
            ui_sink: RwLock::new(None),
            overlay_mirror: AtomicBool::new(false),
        };
        let event = logger
            .append(
                RunEventKind::Preparing,
                RunState::Preparing,
                "still works",
                None,
                None,
            )
            .unwrap();
        assert_eq!(event.sequence, 1);
        assert!(logger.history_path.is_none());
        fs::remove_dir_all(root).unwrap();
    }
}

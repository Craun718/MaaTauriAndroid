use log::Level;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APPLICATION_LOG_FILE_STEM: &str = "ttflow";
pub const RUN_EVENT_LOG_FILE_STEM: &str = "ttflow-run";
pub const RUN_EVENT_TARGET: &str = "ttflow::run";

#[derive(Debug, thiserror::Error)]
pub enum RunLogError {
    #[error("could not create run directory: {0}")]
    CreateDirectory(std::io::Error),
    #[error("could not serialize run event: {0}")]
    Serialize(serde_json::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub execution_id: String,
    pub sequence: u64,
    pub at_unix_ms: u128,
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

impl RunLogger {
    pub fn create(runs_dir: &Path, execution_id: &str) -> Result<Self, RunLogError> {
        let run_dir = runs_dir.join(sanitize(execution_id));
        fs::create_dir_all(run_dir.join("logs")).map_err(RunLogError::CreateDirectory)?;
        Ok(Self {
            execution_id: execution_id.to_string(),
            run_dir,
            sequence: Mutex::new(0),
        })
    }

    pub fn execution_id(&self) -> &str {
        &self.execution_id
    }

    pub fn run_dir(&self) -> &Path {
        &self.run_dir
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
                .map(|duration| duration.as_millis())
                .unwrap_or_default(),
            kind,
            state,
            message: message.into(),
            task_name,
            data,
        };
        let payload = serde_json::to_string(&event).map_err(RunLogError::Serialize)?;
        let level = match kind {
            RunEventKind::Failure => Level::Error,
            RunEventKind::Warning => Level::Warn,
            _ => Level::Info,
        };
        log::log!(target: RUN_EVENT_TARGET, level, "{payload}");
        Ok(event)
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

    #[test]
    fn appends_sequenced_run_events() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let logger = RunLogger::create(&root, "run/one").unwrap();
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
        fs::remove_dir_all(root).unwrap();
    }
}

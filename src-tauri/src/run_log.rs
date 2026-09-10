use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, thiserror::Error)]
pub enum RunLogError {
    #[error("could not create run directory: {0}")]
    CreateDirectory(std::io::Error),
    #[error("could not write run log: {0}")]
    Write(std::io::Error),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RunEventKind {
    Started,
    Preparing,
    Task,
    Stopping,
    Failure,
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
    path: PathBuf,
    file: Mutex<Option<File>>,
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
        let path = run_dir.join("run.jsonl");
        let file = File::create(&path).map_err(RunLogError::Write)?;
        Ok(Self {
            execution_id: execution_id.to_string(),
            path,
            file: Mutex::new(Some(file)),
            sequence: Mutex::new(0),
        })
    }

    pub fn execution_id(&self) -> &str {
        &self.execution_id
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn run_dir(&self) -> &Path {
        self.path.parent().unwrap_or_else(|| Path::new("."))
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
        let mut bytes = serde_json::to_vec(&event).map_err(|source| {
            RunLogError::Write(std::io::Error::new(std::io::ErrorKind::InvalidData, source))
        })?;
        bytes.push(b'\n');
        let mut file = self.file.lock().expect("run log file lock poisoned");
        let file = file
            .as_mut()
            .expect("run log file remains open for the logger lifetime");
        file.write_all(&bytes).map_err(RunLogError::Write)?;
        file.flush().map_err(RunLogError::Write)?;
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
    fn appends_isolated_jsonl_events() {
        let root =
            std::env::temp_dir().join(format!("maa_tauri_android-run-{}", uuid::Uuid::new_v4()));
        let logger = RunLogger::create(&root, "run/one").unwrap();
        logger
            .append(
                RunEventKind::Preparing,
                RunState::Preparing,
                "prepared",
                None,
                None,
            )
            .unwrap();
        logger
            .append(
                RunEventKind::Task,
                RunState::Running,
                "task failed",
                Some("Login".to_string()),
                None,
            )
            .unwrap();
        let contents = fs::read_to_string(&logger.path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"executionId\":\"run/one\""));
        assert!(lines[0].contains("\"sequence\":1"));
        assert!(lines[1].contains("\"sequence\":2"));
        assert!(lines[1].contains("\"taskName\":\"Login\""));
        fs::remove_dir_all(root).unwrap();
    }
}

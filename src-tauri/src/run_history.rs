//! On-disk run history: one JSONL per run inside `<runs_dir>/<execution_id>/`.
//!
//! The file name (`run_<yyyyMMdd>_<HHmmss>_<task_count>.jsonl`) carries the
//! metadata the list page renders, so listing never reads file contents; the
//! JSONL payload is written by `RunLogger::append` through a single funnel.

use crate::run_log::{sanitize, RunEvent};
use chrono::{Local, TimeZone};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_KEEP_DAYS: u32 = 30;

#[derive(Debug, thiserror::Error)]
pub enum RunHistoryError {
    #[error("run record not found: {0}")]
    NotFound(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHistoryEntry {
    pub execution_id: String,
    pub file_name: String,
    pub started_at_unix_ms: u64,
    pub size_bytes: u64,
    pub task_count: usize,
}

/// `run_<yyyyMMdd>_<HHmmss>_<task_count>.jsonl` in the local timezone.
/// Returns `(started_at_unix_ms, task_count)`.
pub(crate) fn parse_history_file_name(name: &str) -> Option<(u64, usize)> {
    let rest = name.strip_prefix("run_")?.strip_suffix(".jsonl")?;
    let (stamp, task_count) = rest.rsplit_once('_')?;
    let task_count = task_count.parse::<usize>().ok()?;
    let naive = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%d_%H%M%S").ok()?;
    let started = Local.from_local_datetime(&naive).earliest()?;
    Some((
        u64::try_from(started.timestamp_millis()).unwrap_or_default(),
        task_count,
    ))
}

/// The first `run_*.jsonl` inside a run directory, if any. Old run
/// directories from before this feature hold none and are skipped.
fn find_history_file(run_dir: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = fs::read_dir(run_dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("run_") && name.ends_with(".jsonl"))
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

fn modified_at(path: &Path) -> u64 {
    path.metadata()
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Newest first. Corrupted file names still list (mtime fallback, task count
/// 0) so the entry stays readable and deletable.
pub fn list(runs_dir: &Path) -> Vec<RunHistoryEntry> {
    let mut entries = Vec::new();
    let Ok(children) = fs::read_dir(runs_dir) else {
        return entries;
    };
    for child in children.flatten() {
        let run_dir = child.path();
        if !run_dir.is_dir() {
            continue;
        }
        let Some(history) = find_history_file(&run_dir) else {
            continue;
        };
        let file_name = history
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let (started_at_unix_ms, task_count) =
            parse_history_file_name(&file_name).unwrap_or_else(|| (modified_at(&history), 0));
        let size_bytes = history.metadata().map(|meta| meta.len()).unwrap_or(0);
        entries.push(RunHistoryEntry {
            execution_id: run_dir
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            file_name,
            started_at_unix_ms,
            size_bytes,
            task_count,
        });
    }
    entries.sort_by(|left, right| {
        right
            .started_at_unix_ms
            .cmp(&left.started_at_unix_ms)
            .then_with(|| right.file_name.cmp(&left.file_name))
    });
    entries
}

/// Parses the JSONL line by line: empty and corrupt lines (a killed process
/// leaves a truncated final one) are skipped instead of voiding the record.
pub fn read(runs_dir: &Path, execution_id: &str) -> Result<Vec<RunEvent>, RunHistoryError> {
    let run_dir = runs_dir.join(sanitize(execution_id));
    let Some(history) = find_history_file(&run_dir) else {
        return Err(RunHistoryError::NotFound(execution_id.to_string()));
    };
    let content = fs::read_to_string(history)?;
    let mut events = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(event) = serde_json::from_str::<RunEvent>(line) {
            events.push(event);
        }
    }
    Ok(events)
}

/// Removes the whole run directory. `Ok(false)` when it does not exist.
pub fn delete(runs_dir: &Path, execution_id: &str) -> Result<bool, RunHistoryError> {
    let run_dir = runs_dir.join(sanitize(execution_id));
    if !run_dir.is_dir() {
        return Ok(false);
    }
    fs::remove_dir_all(run_dir)?;
    Ok(true)
}

/// Removes entries started before `keep_days` ago, skipping runs reported
/// active by `is_active`. Returns how many directories were removed.
pub fn cleanup(
    runs_dir: &Path,
    keep_days: u32,
    is_active: impl Fn(&str) -> bool,
) -> Result<usize, RunHistoryError> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let cutoff_ms = now_ms.saturating_sub(u64::from(keep_days) * 24 * 60 * 60 * 1000);
    let mut removed = 0;
    for entry in list(runs_dir) {
        if entry.started_at_unix_ms >= cutoff_ms || is_active(&entry.execution_id) {
            continue;
        }
        if fs::remove_dir_all(runs_dir.join(&entry.execution_id)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// A run is active while its logger is the latest one and Maa has not yet
/// returned to `Idle`: the logger still holds the open history file, and on
/// Linux/Android writes after an unlink would land in a deleted inode, so
/// delete/cleanup must refuse.
pub fn is_active_run(
    latest_execution_id: Option<&str>,
    status: crate::runtime::RunState,
    requested: &str,
) -> bool {
    latest_execution_id == Some(requested) && status != crate::runtime::RunState::Idle
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::RunState;

    fn temp_runs_dir() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "maa_tauri_android-history-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_history(runs_dir: &Path, execution_id: &str, file_name: &str, body: &str) {
        let run_dir = runs_dir.join(sanitize(execution_id));
        fs::create_dir_all(run_dir.join("logs")).unwrap();
        fs::write(run_dir.join(file_name), body).unwrap();
    }

    #[test]
    fn parses_stamp_and_task_count() {
        let (started_at, task_count) =
            parse_history_file_name("run_20240601_080509_12.jsonl").unwrap();
        assert_eq!(task_count, 12);
        let naive =
            chrono::NaiveDateTime::parse_from_str("20240601_080509", "%Y%m%d_%H%M%S").unwrap();
        let expected = Local
            .from_local_datetime(&naive)
            .earliest()
            .unwrap()
            .timestamp_millis();
        assert_eq!(started_at, expected as u64);
        assert!(parse_history_file_name("run_garbage.jsonl").is_none());
        assert!(parse_history_file_name("other.jsonl").is_none());
        assert!(parse_history_file_name("run_20240601_080509_x.jsonl").is_none());
    }

    #[test]
    fn lists_directories_only_newest_first_and_skips_empty_ones() {
        let runs_dir = temp_runs_dir();
        write_history(&runs_dir, "older", "run_20240101_120000_3.jsonl", "");
        write_history(&runs_dir, "newer", "run_20240601_080000_2.jsonl", "");
        // A run directory without a JSONL (pre-feature) is skipped,
        // as is a plain file child.
        fs::create_dir_all(runs_dir.join("legacy/logs")).unwrap();
        fs::write(runs_dir.join("stray.jsonl"), "").unwrap();

        let entries = list(&runs_dir);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].execution_id, "newer");
        assert_eq!(entries[0].task_count, 2);
        assert_eq!(entries[1].execution_id, "older");
        assert_eq!(entries[1].task_count, 3);
        fs::remove_dir_all(runs_dir).unwrap();
    }

    #[test]
    fn corrupt_file_name_falls_back_to_mtime() {
        let runs_dir = temp_runs_dir();
        write_history(&runs_dir, "odd", "run_garbage.jsonl", "");
        let entries = list(&runs_dir);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].task_count, 0);
        assert!(entries[0].started_at_unix_ms > 0);
        fs::remove_dir_all(runs_dir).unwrap();
    }

    #[test]
    fn read_skips_empty_and_corrupt_lines() {
        let runs_dir = temp_runs_dir();
        let valid = serde_json::json!({
            "executionId": "run-1",
            "sequence": 1,
            "atUnixMs": 1_700_000_000_000u64,
            "kind": "started",
            "state": "Running",
            "message": "The run started",
        })
        .to_string();
        write_history(
            &runs_dir,
            "run-1",
            "run_20240601_080000_1.jsonl",
            &format!("{valid}\n\nnot json\n{valid}\ntruncated"),
        );

        let events = read(&runs_dir, "run-1").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, crate::run_log::RunEventKind::Started);
        assert_eq!(events[0].state, RunState::Running);
        assert_eq!(events[0].at_unix_ms, 1_700_000_000_000);

        let missing = read(&runs_dir, "never-started").unwrap_err();
        assert!(matches!(missing, RunHistoryError::NotFound(_)));
        fs::remove_dir_all(runs_dir).unwrap();
    }

    #[test]
    fn delete_removes_the_whole_run_directory() {
        let runs_dir = temp_runs_dir();
        write_history(&runs_dir, "gone", "run_20240601_080000_1.jsonl", "");
        let run_dir = runs_dir.join("gone");
        assert!(run_dir.is_dir());

        assert!(delete(&runs_dir, "gone").unwrap());
        assert!(!run_dir.exists());
        assert!(!delete(&runs_dir, "gone").unwrap());
        fs::remove_dir_all(runs_dir).unwrap();
    }

    #[test]
    fn cleanup_respects_keep_days_and_the_active_guard() {
        let runs_dir = temp_runs_dir();
        let stamp = |days_ago: i64| {
            (Local::now() - chrono::Duration::days(days_ago))
                .format("run_%Y%m%d_%H%M%S_1.jsonl")
                .to_string()
        };
        write_history(&runs_dir, "ancient", &stamp(60), "");
        write_history(&runs_dir, "old", &stamp(31), "");
        write_history(&runs_dir, "recent", &stamp(5), "");
        write_history(&runs_dir, "running", &stamp(60), "");

        let removed = cleanup(&runs_dir, 30, |execution_id| {
            is_active_run(Some("running"), RunState::Running, execution_id)
        })
        .unwrap();
        assert_eq!(removed, 2);
        let remaining: Vec<String> = list(&runs_dir)
            .into_iter()
            .map(|entry| entry.execution_id)
            .collect();
        assert_eq!(remaining, ["recent", "running"]);
        fs::remove_dir_all(runs_dir).unwrap();
    }

    #[test]
    fn active_guard_matches_both_conditions() {
        assert!(is_active_run(Some("run-1"), RunState::Running, "run-1"));
        assert!(is_active_run(Some("run-1"), RunState::Stopping, "run-1"));
        // Not the latest run, or Maa already back to Idle.
        assert!(!is_active_run(Some("run-1"), RunState::Idle, "run-1"));
        assert!(!is_active_run(Some("other"), RunState::Running, "run-1"));
        assert!(!is_active_run(None, RunState::Running, "run-1"));
    }
}

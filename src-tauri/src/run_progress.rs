//! Run progress frames pushed to the Android foreground notification.
//!
//! `run_tasks` reports one frame per task start and the focus sink reports
//! the first line of a focused message as the status sentence. Both travel
//! through RuntimeBridge over JNI and are strictly best-effort: failures are
//! logged and never affect the run itself.

use crate::domain::types::ResolvedTask;
use regex::Regex;
use std::sync::{Mutex, OnceLock};

/// One progress frame. Keys are camelCase and parsed leniently by
/// `RunForegroundService.parseSnapshot` (org.json `opt*` accessors), so an
/// empty `status` simply means "no status sentence".
pub fn progress_payload(done: u32, total: u32, label: &str, status: Option<&str>) -> String {
    serde_json::json!({
        "done": done,
        "total": total,
        "label": label,
        "status": status.unwrap_or(""),
        "indeterminate": false,
    })
    .to_string()
}

struct RichTextPatterns {
    image: Regex,
    link: Regex,
    line_break: Regex,
    html_tag: Regex,
    code: Regex,
    strong: Regex,
    whitespace: Regex,
}

static RICH_TEXT_PATTERNS: OnceLock<RichTextPatterns> = OnceLock::new();

impl RichTextPatterns {
    fn get() -> &'static Self {
        RICH_TEXT_PATTERNS.get_or_init(|| Self {
            image: Regex::new(r"!\[([^\]]*)\]\([^)]*\)").expect("valid image pattern"),
            link: Regex::new(r"\[([^\]]*)\]\([^)]*\)").expect("valid link pattern"),
            line_break: Regex::new(r"(?i)</?br\b[^>]*>").expect("valid line break pattern"),
            html_tag: Regex::new(r"<[^>]*>").expect("valid HTML tag pattern"),
            code: Regex::new(r"`[^`]+`").expect("valid inline code pattern"),
            strong: Regex::new(r"\*\*[^*]+\*\*").expect("valid strong pattern"),
            whitespace: Regex::new(r"\s+").expect("valid whitespace pattern"),
        })
    }
}

/// Notification surfaces show a single plain-text line, while logs and the
/// WebView keep the resource author's inline Markdown and HTML.
pub fn strip_inline_rich_text(content: &str) -> String {
    let patterns = RichTextPatterns::get();
    let image_alt = patterns
        .image
        .replace_all(content, |captures: &regex::Captures| {
            captures[1].to_string()
        })
        .to_string();
    let link_text = patterns
        .link
        .replace_all(&image_alt, |captures: &regex::Captures| {
            captures[1].to_string()
        })
        .to_string();
    let code_content = patterns
        .code
        .replace_all(&link_text, |captures: &regex::Captures| {
            captures[0].trim_matches('`').to_string()
        })
        .to_string();
    let strong_content = patterns
        .strong
        .replace_all(&code_content, |captures: &regex::Captures| {
            captures[0].trim_matches('*').to_string()
        })
        .to_string();
    let without_line_breaks = patterns.line_break.replace_all(&strong_content, " ");
    let without_tags = patterns.html_tag.replace_all(&without_line_breaks, "");
    let without_entities = without_tags.replace("&nbsp;", " ");
    patterns
        .whitespace
        .replace_all(&without_entities.trim(), " ")
        .trim()
        .to_string()
}

/// The notification status sentence is a single line: focus content can be a
/// long multi-line template, and a folded notification hides every later line.
pub fn first_status_line(content: &str) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    truncate_status(line)
}

/// Notification one-liners stay readable; anything longer is cut on a char
/// boundary (focus content is often CJK, so byte truncation would split glyphs).
const MAX_STATUS_CHARS: usize = 100;

fn truncate_status(line: &str) -> String {
    truncate_chars(line, MAX_STATUS_CHARS)
}

fn truncate_chars(line: &str, limit: usize) -> String {
    if line.chars().count() <= limit {
        return line.to_string();
    }
    let mut truncated: String = line.chars().take(limit).collect();
    truncated.push('…');
    truncated
}

/// The notification label for the running task: prefer the human-readable
/// display name, fall back through the identifier and the pipeline entry.
pub fn task_progress_label(task: &ResolvedTask) -> &str {
    let label = task.task.label.trim();
    if !label.is_empty() {
        return label;
    }
    let name = task.task.name.trim();
    if !name.is_empty() {
        return name;
    }
    task.task.entry.trim()
}

/// Focus status → notification status sentence, best-effort. Non-Android
/// builds have no notification surface to update.
pub(crate) fn push_focus_status(status: &str) {
    update_run_overlay_status(status);
    #[cfg(target_os = "android")]
    {
        if let Err(error) =
            crate::call_runtime_bridge_string_with_string("updateRunFocusStatus", status)
        {
            log::warn!("Could not push the focus status to the run notification: {error}");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = status;
    }
}

/// One per-task progress frame. The run notification and the foreground
/// overlay panel mirror the same numbers, so they are pushed together.
pub(crate) fn push_progress(done: u32, total: u32, label: &str) {
    update_run_overlay_progress(done, total, label);
    #[cfg(target_os = "android")]
    {
        let payload = progress_payload(done, total, label, None);
        if let Err(error) =
            crate::call_runtime_bridge_string_with_string("updateRunProgress", &payload)
        {
            log::warn!("Could not update the run progress notification: {error}");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = label;
    }
}

/// Where a run is in its lifecycle, as far as the floating panel is concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOverlayPhase {
    Preparing,
    Running,
    Stopping,
    Finished,
}

impl RunOverlayPhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Running => "running",
            Self::Stopping => "stopping",
            Self::Finished => "finished",
        }
    }
}

/// How many run-log lines ride along in the pushed snapshot. The panel is a
/// glanceable feed, not the archive: the full history is on disk and the
/// export button is the way to get it out.
const MAX_OVERLAY_LOG_LINES: usize = 50;

/// Notification-sized one-liners are too long for a 244dp card; a row holds
/// roughly two lines of text.
const MAX_OVERLAY_LOG_CHARS: usize = 200;

/// One mirrored run-log line. `level` is one of `info` / `warn` / `error` and
/// stays a string for the same reason the phase does: the panel switches on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOverlayLogLine {
    pub at_unix_ms: u64,
    pub level: &'static str,
    pub message: String,
}

/// One log row is one `TextView`, so rich text is flattened exactly like the
/// notification line and long focus templates are cut on a char boundary.
pub fn overlay_log_message(content: &str) -> String {
    truncate_chars(&strip_inline_rich_text(content), MAX_OVERLAY_LOG_CHARS)
}

/// The complete snapshot the Android floating panel renders.
///
/// The panel is pushed a fresh snapshot on every change instead of polling, so
/// this has to stay self-contained: a partial update would render stale data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOverlayState {
    /// Whether the shell should install the panel at all: foreground mode with
    /// the overlay preference on. A background run has no physical screen to
    /// draw over, so the snapshot is pushed for logging alone and never shown.
    pub foreground: bool,
    pub phase: RunOverlayPhase,
    pub done: u32,
    pub total: u32,
    pub label: String,
    pub status: String,
    /// Every task this run will execute, in order, as display labels.
    pub tasks: Vec<String>,
    /// Index into [`Self::tasks`] of the task that started last, or `-1` while
    /// the run is still preparing.
    pub active: i32,
    /// The newest [`MAX_OVERLAY_LOG_LINES`] run events, oldest first.
    pub log: Vec<RunOverlayLogLine>,
}

impl RunOverlayState {
    fn started(foreground: bool, tasks: Vec<String>) -> Self {
        Self {
            foreground,
            phase: RunOverlayPhase::Preparing,
            done: 0,
            total: 0,
            label: String::new(),
            status: String::new(),
            tasks,
            active: -1,
            log: Vec::new(),
        }
    }
}

/// Serialised once per push. Keys are camelCase because the panel parses them
/// with `org.json` (`RunOverlayController.parseSnapshot`), and phases keep the
/// lowercase spelling that parser switches on.
pub fn overlay_payload(state: &RunOverlayState) -> String {
    let log: Vec<serde_json::Value> = state
        .log
        .iter()
        .map(|line| {
            serde_json::json!({
                "at": line.at_unix_ms,
                "level": line.level,
                "message": line.message,
            })
        })
        .collect();
    serde_json::json!({
        "foreground": state.foreground,
        "phase": state.phase.as_str(),
        "done": state.done,
        "total": state.total,
        "label": state.label,
        "status": state.status,
        "tasks": state.tasks,
        "active": state.active,
        "log": log,
    })
    .to_string()
}

/// `None` means no run is mirrored: every mutator below is a no-op until
/// [`begin_run_overlay`] installs a snapshot, so stray late pushes from a
/// finished run cannot pop the panel back up.
static RUN_OVERLAY: Mutex<Option<RunOverlayState>> = Mutex::new(None);

fn overlay_lock() -> std::sync::MutexGuard<'static, Option<RunOverlayState>> {
    RUN_OVERLAY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts mirroring a run into the floating panel. Called once per run, after
/// the foreground service is up and before the session is created; `tasks` is
/// the ordered list of display labels this run will walk through.
pub fn begin_run_overlay(foreground: bool, tasks: Vec<String>) {
    let state = RunOverlayState::started(foreground, tasks);
    *overlay_lock() = Some(state.clone());
    push_overlay(&state);
}

/// The first task started: the panel switches from "preparing" to progress.
pub fn update_run_overlay_progress(done: u32, total: u32, label: &str) {
    update_overlay(|state| {
        state.phase = RunOverlayPhase::Running;
        state.done = done;
        state.total = total;
        state.label = label.to_string();
        // `done` counts the task that just started (1-based), so it doubles as
        // the cursor into the task list the panel renders.
        state.active = done.saturating_sub(1) as i32;
    });
}

/// Mirrors one run-log line. Called from `RunLogger::append` for every event,
/// so a background run pays only the lock check in `update_overlay`.
pub fn record_overlay_log(at_unix_ms: u64, level: &'static str, message: &str) {
    let message = overlay_log_message(message);
    if message.is_empty() {
        return;
    }
    update_overlay(|state| push_log_line(&mut state.log, at_unix_ms, level, message));
}

/// Keeps the feed at the cap by dropping the oldest line, so the payload the
/// panel receives never grows with the length of the run.
fn push_log_line(
    log: &mut Vec<RunOverlayLogLine>,
    at_unix_ms: u64,
    level: &'static str,
    message: String,
) {
    if log.len() >= MAX_OVERLAY_LOG_LINES {
        let overflow = log.len() + 1 - MAX_OVERLAY_LOG_LINES;
        log.drain(..overflow);
    }
    log.push(RunOverlayLogLine {
        at_unix_ms,
        level,
        message,
    });
}

/// Mirrors one focus status sentence, the same line the notification shows.
pub fn update_run_overlay_status(status: &str) {
    update_overlay(|state| state.status = status.to_string());
}

/// Mirrors a lifecycle edge the progress frames do not carry.
pub fn set_run_overlay_phase(phase: RunOverlayPhase) {
    update_overlay(|state| state.phase = phase);
}

/// Live mirror of the settings switch. The preference is documented as taking
/// effect on the next run, but hiding a panel the user just switched off must
/// not wait for one — that frame is the one case [`push_overlay`] would drop
/// on its own, so it goes out through the unguarded sender.
pub fn set_run_overlay_foreground(foreground: bool) {
    let next = {
        let mut guard = overlay_lock();
        let Some(state) = guard.as_mut() else {
            return;
        };
        if state.foreground == foreground {
            return;
        }
        state.foreground = foreground;
        state.clone()
    };
    send_overlay(&next);
}

/// Ends the overlay: pushes the terminal phase so the panel dismisses itself,
/// then forgets the run. Call it once per run, from the same place the run
/// result is finalised.
pub fn finish_run_overlay() {
    #[cfg(target_os = "android")]
    if let Err(error) = crate::call_runtime_bridge_boolean_with_bool("setPipRunActive", false) {
        log::warn!("Could not finish the PiP run state: {error}");
    }
    let finished = overlay_lock().take().map(|mut state| {
        state.phase = RunOverlayPhase::Finished;
        state
    });
    if let Some(state) = finished {
        push_overlay(&state);
    }
}

fn update_overlay(mutate: impl FnOnce(&mut RunOverlayState)) {
    let next = {
        let mut guard = overlay_lock();
        let Some(state) = guard.as_mut() else {
            return;
        };
        mutate(state);
        state.clone()
    };
    push_overlay(&next);
}

/// Best-effort, like the notification path: a failed push is logged and never
/// propagated into the run.
///
/// A background run has no panel to drive, so its frames are dropped here
/// rather than paying for a JNI hop on every progress tick.
fn push_overlay(state: &RunOverlayState) {
    if !state.foreground {
        return;
    }
    send_overlay(state);
}

fn send_overlay(state: &RunOverlayState) {
    // Serialised on every platform so the payload builder stays one code path;
    // only an Android build has a shell to hand it to.
    let payload = overlay_payload(state);
    #[cfg(target_os = "android")]
    {
        if let Err(error) =
            crate::call_runtime_bridge_string_with_string("updateRunOverlay", &payload)
        {
            log::warn!("Could not update the run overlay panel: {error}");
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = payload;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mirrored snapshot is a process-wide static, so the tests that drive
    /// it have to take turns instead of racing on parallel test threads.
    static OVERLAY_TEST_GUARD: Mutex<()> = Mutex::new(());

    fn overlay_test_guard() -> std::sync::MutexGuard<'static, ()> {
        OVERLAY_TEST_GUARD
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn payload_carries_progress_fields() {
        let payload: serde_json::Value =
            serde_json::from_str(&progress_payload(2, 5, "Login", Some("fighting")))
                .expect("payload is valid JSON");
        assert_eq!(payload["done"], 2);
        assert_eq!(payload["total"], 5);
        assert_eq!(payload["label"], "Login");
        assert_eq!(payload["status"], "fighting");
        assert_eq!(payload["indeterminate"], false);
    }

    #[test]
    fn missing_status_is_an_empty_string_for_the_lenient_kotlin_parser() {
        let payload: serde_json::Value =
            serde_json::from_str(&progress_payload(0, 3, "Daily", None))
                .expect("payload is valid JSON");
        assert_eq!(payload["status"], "");
        assert_eq!(payload["done"], 0);
        assert_eq!(payload["total"], 3);
    }

    #[test]
    fn status_takes_the_first_non_blank_line() {
        assert_eq!(first_status_line("first\nsecond"), "first");
        assert_eq!(
            first_status_line("\n  第二步：登录  \ntrailing"),
            "第二步：登录"
        );
        assert_eq!(first_status_line(""), "");
        assert_eq!(first_status_line("   \n\t "), "");
    }

    #[test]
    fn notification_text_strips_inline_rich_text() {
        assert_eq!(
            strip_inline_rich_text(
                "![icon](resource/icon.png) [site](https://example.com) `daily` **ready**"
            ),
            "icon site daily ready"
        );
        assert_eq!(
            strip_inline_rich_text("<span style=\"color: red\">step</span><br>next"),
            "step next"
        );
        assert_eq!(
            strip_inline_rich_text("Emulator <MuMu> startup"),
            "Emulator startup"
        );
        assert_eq!(
            strip_inline_rich_text("\n  第二步：登录  \n"),
            "第二步：登录"
        );
    }

    #[test]
    fn overlong_status_lines_are_truncated_on_char_boundaries() {
        let long = "好".repeat(MAX_STATUS_CHARS + 50);
        let truncated = first_status_line(&long);
        assert_eq!(truncated.chars().count(), MAX_STATUS_CHARS + 1);
        assert!(truncated.ends_with('…'));
    }

    #[test]
    fn label_prefers_the_display_name_over_identifiers() {
        let task = resolved_task("Entry", "Name", "Label");
        assert_eq!(task_progress_label(&task), "Label");
        let task = resolved_task("Entry", "Name", "");
        assert_eq!(task_progress_label(&task), "Name");
        let task = resolved_task("Entry", "", "");
        assert_eq!(task_progress_label(&task), "Entry");
    }

    #[test]
    fn overlay_snapshot_starts_in_preparing_and_stays_foreground() {
        let state = RunOverlayState::started(true, vec!["Daily".to_string()]);

        assert!(state.foreground);
        assert_eq!(state.phase, RunOverlayPhase::Preparing);
        assert_eq!(state.done, 0);
        assert_eq!(state.total, 0);
        assert!(state.label.is_empty());
        assert!(state.status.is_empty());
        assert_eq!(state.tasks, ["Daily"]);
        assert_eq!(state.active, -1);
        assert!(state.log.is_empty());
    }

    #[test]
    fn overlay_payload_carries_every_field_the_panel_renders() {
        let state = RunOverlayState {
            foreground: true,
            phase: RunOverlayPhase::Stopping,
            done: 2,
            total: 5,
            label: "Daily".to_string(),
            status: "fighting".to_string(),
            tasks: vec!["Login".to_string(), "Daily".to_string()],
            active: 1,
            log: vec![RunOverlayLogLine {
                at_unix_ms: 1_700_000_000_000,
                level: "info",
                message: "Maa task Daily started".to_string(),
            }],
        };

        let payload: serde_json::Value =
            serde_json::from_str(&overlay_payload(&state)).expect("payload is valid JSON");

        assert_eq!(payload["foreground"], true);
        assert_eq!(payload["phase"], "stopping");
        assert_eq!(payload["done"], 2);
        assert_eq!(payload["total"], 5);
        assert_eq!(payload["label"], "Daily");
        assert_eq!(payload["status"], "fighting");
        assert_eq!(payload["tasks"], serde_json::json!(["Login", "Daily"]));
        assert_eq!(payload["active"], 1);
        assert_eq!(payload["log"][0]["at"], 1_700_000_000_000u64);
        assert_eq!(payload["log"][0]["level"], "info");
        assert_eq!(payload["log"][0]["message"], "Maa task Daily started");
    }

    /// The Kotlin reader switches on these spellings, so they are part of the
    /// JNI contract rather than an implementation detail.
    #[test]
    fn overlay_phases_keep_their_lowercase_spelling() {
        assert_eq!(RunOverlayPhase::Preparing.as_str(), "preparing");
        assert_eq!(RunOverlayPhase::Running.as_str(), "running");
        assert_eq!(RunOverlayPhase::Stopping.as_str(), "stopping");
        assert_eq!(RunOverlayPhase::Finished.as_str(), "finished");
    }

    #[test]
    fn overlay_transitions_without_a_mirrored_run_are_no_ops() {
        // Late frames from a finished run must not resurrect the panel, so
        // every mutator no-ops once [`finish_run_overlay`] has cleared the
        // snapshot.
        let _guard = overlay_test_guard();
        finish_run_overlay();
        update_run_overlay_progress(1, 2, "Daily");
        update_run_overlay_status("fighting");
        record_overlay_log(1, "info", "orphan line");
        set_run_overlay_phase(RunOverlayPhase::Stopping);
        set_run_overlay_foreground(true);
        set_run_overlay_foreground(false);

        assert!(RUN_OVERLAY.lock().unwrap().is_none());
    }

    #[test]
    fn overlay_transitions_track_the_run_it_mirrors() {
        let _guard = overlay_test_guard();
        finish_run_overlay();
        begin_run_overlay(true, vec!["Login".to_string(), "Daily".to_string()]);
        update_run_overlay_progress(2, 2, "Daily");
        record_overlay_log(7, "warn", "**watch out**");

        let state = RUN_OVERLAY.lock().unwrap().clone().expect("mirrored run");
        assert_eq!(state.tasks, ["Login", "Daily"]);
        assert_eq!(state.active, 1);
        assert_eq!(state.log.len(), 1);
        assert_eq!(state.log[0].at_unix_ms, 7);
        assert_eq!(state.log[0].level, "warn");
        // The panel renders plain text, so the emphasis markers are gone.
        assert_eq!(state.log[0].message, "watch out");

        finish_run_overlay();
        assert!(RUN_OVERLAY.lock().unwrap().is_none());
    }

    #[test]
    fn log_feed_keeps_only_the_newest_lines() {
        let mut log = Vec::new();
        for index in 0..(MAX_OVERLAY_LOG_LINES + 10) {
            push_log_line(&mut log, index as u64, "info", format!("line {index}"));
        }

        assert_eq!(log.len(), MAX_OVERLAY_LOG_LINES);
        assert_eq!(log.first().unwrap().at_unix_ms, 10);
        assert_eq!(
            log.last().unwrap().message,
            format!("line {}", MAX_OVERLAY_LOG_LINES + 9)
        );
    }

    #[test]
    fn log_lines_are_flattened_and_cut_like_the_notification() {
        assert_eq!(overlay_log_message("`daily` **ready**"), "daily ready");
        assert_eq!(overlay_log_message("   "), "");

        let long = "好".repeat(MAX_OVERLAY_LOG_CHARS + 5);
        let line = overlay_log_message(&long);
        assert_eq!(line.chars().count(), MAX_OVERLAY_LOG_CHARS + 1);
        assert!(line.ends_with('…'));
    }

    fn resolved_task(entry: &str, name: &str, label: &str) -> ResolvedTask {
        ResolvedTask {
            task: crate::domain::types::TaskDefinition {
                name: name.to_string(),
                label: label.to_string(),
                entry: entry.to_string(),
                description: None,
                groups: Vec::new(),
                controllers: Vec::new(),
                resources: Vec::new(),
                options: Vec::new(),
                pipeline_override: serde_json::json!({}),
                default_check: true,
                icon: None,
            },
            configured: None,
            enabled: true,
            unavailable_reason: None,
            pipeline_override: serde_json::json!({}),
        }
    }
}

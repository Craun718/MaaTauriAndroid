//! Run progress frames pushed to the Android foreground notification.
//!
//! `run_tasks` reports one frame per task start and the focus sink reports
//! the first line of a focused message as the status sentence. Both travel
//! through RuntimeBridge over JNI and are strictly best-effort: failures are
//! logged and never affect the run itself.

use crate::domain::types::ResolvedTask;
use regex::Regex;
use std::sync::OnceLock;

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
    if line.chars().count() <= MAX_STATUS_CHARS {
        return line.to_string();
    }
    let mut truncated: String = line.chars().take(MAX_STATUS_CHARS).collect();
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

#[cfg(test)]
mod tests {
    use super::*;

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

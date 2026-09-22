//! Run-failure diagnosis for the "empty display / game not running" class of
//! failures. A Maa task that fails because recognition matched nothing used
//! to surface as a bare `Maa task {entry} failed: FAILED`; this module turns
//! the privileged side's knowledge of the controlled display into a concrete,
//! actionable cause at the moment the run loop observes the failure.
//!
//! # Design
//!
//! One privileged query, `targetAppState(displayId)` (AIDL transaction 24),
//! reports which target packages were recorded as launched, whether their
//! tasks still exist and on which display, which package is on top of the
//! controlled display, and whether the virtual display itself is still alive.
//! The run loop consumes that snapshot twice: once before the first task (an
//! informational hint when the display is empty — never a refusal, unlike the
//! MaaFwApp PR #33 gate, because a task that starts the game legitimately
//! begins on an empty display) and once when a task fails (a `Diagnosis:`
//! line classifying the failure).
//!
//! Old surviving privileged service processes lack transaction 24; the probe
//! then returns `None`, `classify` answers [`FailureCause::QueryUnavailable`],
//! and no diagnosis line is appended — the same fallback contract as
//! `gameFps()`.
//!
//! # Miss tracking
//!
//! A second event sink ([`DiagSink`]) records the last unmatched recognition
//! node names (deduplicated, capped). Any success or a fresh task start
//! clears the trail. When a task fails, the trail tells the user *where* the
//! pipeline lost the picture — e.g. `ReturnMain, EnterWilderness`.
//!
//! Everything here is pure logic against a parsed snapshot; the Android JNI
//! probe that produces the JSON lives in `lib.rs`.

use maa_framework::event_sink::EventSink;
use maa_framework::notification::MaaEvent;
use serde::Deserialize;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Mutex, OnceLock};

/// Snapshot of the controlled display reported by the privileged service's
/// `targetAppState(displayId)`. Every field tolerates absence so a partial
/// report degrades to "unknown" instead of failing to parse.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAppState {
    /// The display the snapshot describes (0 = the physical display).
    #[serde(default)]
    pub display_id: i32,
    /// Whether the virtual display backing the run is still alive. Always
    /// true for the physical display.
    #[serde(default = "default_true")]
    pub display_alive: bool,
    /// Packages the privileged service recorded as launched onto the
    /// controlled display during this session. Empty on the physical display:
    /// only virtual-display launches are recorded.
    #[serde(default)]
    pub targets: Vec<String>,
    /// Per-target task state; a `None` value means the package has no
    /// running task anymore.
    #[serde(default)]
    pub tasks: BTreeMap<String, Option<TargetTaskState>>,
    /// The package currently on top of (frontmost on) the controlled display.
    #[serde(default)]
    pub top_package: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Where a recorded target package's task currently sits.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetTaskState {
    pub task_id: Option<i64>,
    pub display_id: Option<i32>,
}

/// The classified reason a Maa task failed, in the order the evidence is
/// trusted: query availability, display liveness, foreground contents, then
/// the recorded targets' task states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureCause {
    /// The privileged service could not be queried (an older surviving
    /// service process, or a binder failure). No diagnosis is reported.
    QueryUnavailable,
    /// The virtual display backing the run was lost.
    DisplayGone,
    /// Nothing was running on the controlled display; the game was never
    /// started.
    ScreenEmpty,
    /// Another app held the foreground of the controlled display.
    ScreenOccupiedBy(String),
    /// A recorded target package no longer has a running task: it exited
    /// during the run (crashed or was stopped).
    TargetExited(String),
    /// A recorded target package is running, but on a different display.
    TargetOffscreen(String),
    /// The game ran normally on the controlled display, but recognition
    /// matched nothing; `missed` names the last unmatched nodes.
    RecognitionMissed { missed: Vec<String> },
}

/// Classifies a task failure from the display snapshot and the recorded
/// recognition-miss trail. `state` being `None` means the query itself was
/// unavailable.
pub fn classify(state: Option<&TargetAppState>, missed: &[String]) -> FailureCause {
    let Some(state) = state else {
        return FailureCause::QueryUnavailable;
    };
    if state.display_id != 0 && !state.display_alive {
        return FailureCause::DisplayGone;
    }
    let task_state = |pkg: &str| state.tasks.get(pkg).and_then(Option::as_ref);
    if state.targets.is_empty() {
        return match &state.top_package {
            Some(top) => FailureCause::ScreenOccupiedBy(top.clone()),
            None => FailureCause::ScreenEmpty,
        };
    }
    if let Some(pkg) = state
        .targets
        .iter()
        .find(|pkg| task_state(pkg).is_some_and(|task| task.display_id == Some(state.display_id)))
    {
        // The game's task is alive on the controlled display. When another
        // app holds the foreground the screen content is wrong all the same;
        // otherwise the failure is recognition-level.
        return match &state.top_package {
            Some(top) if !state.targets.contains(top) => {
                FailureCause::ScreenOccupiedBy(top.clone())
            }
            _ => FailureCause::RecognitionMissed {
                missed: missed.to_vec(),
            },
        };
    }
    if let Some(pkg) = state.targets.iter().find(|pkg| task_state(pkg).is_some()) {
        return FailureCause::TargetOffscreen(pkg.clone());
    }
    // No recorded target has a task anymore: the game exited mid-run.
    FailureCause::TargetExited(state.targets[0].clone())
}

/// Renders the diagnosis as an English run-log line; `None` for
/// [`FailureCause::QueryUnavailable`], where nothing is appended.
pub fn render(cause: &FailureCause) -> Option<String> {
    let detail = match cause {
        FailureCause::QueryUnavailable => return None,
        FailureCause::DisplayGone => {
            "the virtual display was lost; restart the run to recreate it".to_string()
        }
        FailureCause::ScreenEmpty => "no app was running on the controlled display; the game \
            was never started — run a task that starts the game (e.g. StartUp) first"
            .to_string(),
        FailureCause::ScreenOccupiedBy(package) => {
            format!("the controlled display was showing {package} instead of the game")
        }
        FailureCause::TargetExited(package) => {
            format!("the target app {package} exited during the run (crashed or was stopped)")
        }
        FailureCause::TargetOffscreen(package) => {
            format!(
                "the target app {package} was running on another display, not the \
                controlled one"
            )
        }
        FailureCause::RecognitionMissed { missed } => {
            let base = "the game was running normally, but recognition matched nothing; the \
                screen content differs from the pipeline's expectations";
            if missed.is_empty() {
                base.to_string()
            } else {
                format!("{base}. Last unmatched nodes: {}", missed.join(", "))
            }
        }
    };
    Some(format!("Diagnosis: {detail}."))
}

/// Running trail of consecutive unmatched recognition nodes, kept to show the
/// user where the pipeline lost the picture.
pub struct MissTracker {
    entries: VecDeque<String>,
}

impl MissTracker {
    const CAPACITY: usize = 8;

    pub fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(Self::CAPACITY),
        }
    }

    /// Records an unmatched node; consecutive repeats of the same node
    /// collapse into one entry (jump_back retries one list many times).
    pub fn on_miss(&mut self, name: &str) {
        if self.entries.back().map(String::as_str) == Some(name) {
            return;
        }
        if self.entries.len() == Self::CAPACITY {
            self.entries.pop_front();
        }
        self.entries.push_back(name.to_string());
    }

    /// Clears the trail: any matched node (or a fresh task start) means the
    /// picture was found and earlier misses are no longer relevant.
    pub fn on_progress(&mut self) {
        self.entries.clear();
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.entries.iter().cloned().collect()
    }
}

impl Default for MissTracker {
    fn default() -> Self {
        Self::new()
    }
}

fn tracker() -> &'static Mutex<MissTracker> {
    static TRACKER: OnceLock<Mutex<MissTracker>> = OnceLock::new();
    TRACKER.get_or_init(|| Mutex::new(MissTracker::new()))
}

/// Records an unmatched recognition node (called from [`DiagSink`]).
pub fn record_miss(name: &str) {
    tracker()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .on_miss(name);
}

/// Clears the miss trail after any matched node or fresh task start.
pub fn record_progress() {
    tracker()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .on_progress();
}

/// Snapshot of the miss trail for the failure diagnosis.
pub fn missed_nodes() -> Vec<String> {
    tracker()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .snapshot()
}

/// Drops the miss trail; called when a run starts so a stale trail from a
/// previous run can never leak into a diagnosis.
pub fn reset_misses() {
    record_progress();
}

/// Event sink watching recognition outcomes on behalf of the miss trail.
/// Registered next to the focus sink on each run's tasker.
pub struct DiagSink;

impl EventSink for DiagSink {
    fn on_event(&self, _handle: maa_framework::common::MaaId, event: &MaaEvent) {
        match event {
            MaaEvent::NodeRecognitionFailed(detail) => record_miss(&detail.name),
            MaaEvent::NodeRecognitionSucceeded(_)
            | MaaEvent::NodePipelineNodeSucceeded(_)
            | MaaEvent::NodeActionSucceeded(_)
            | MaaEvent::NodeNextListSucceeded(_)
            | MaaEvent::TaskerTaskStarting(_) => record_progress(),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(json: &str) -> TargetAppState {
        serde_json::from_str(json).expect("snapshot should parse")
    }

    fn virtual_state() -> TargetAppState {
        state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": ["com.shenlan.m.reverse1999"],
                "tasks": {
                    "com.shenlan.m.reverse1999": {"taskId": 123, "displayId": 20}
                },
                "topPackage": "com.shenlan.m.reverse1999"
            }"#,
        )
    }

    #[test]
    fn missing_query_classifies_as_unavailable() {
        assert_eq!(classify(None, &[]), FailureCause::QueryUnavailable);
        assert_eq!(render(&FailureCause::QueryUnavailable), None);
    }

    #[test]
    fn lost_virtual_display_outranks_everything() {
        let mut snapshot = virtual_state();
        snapshot.display_alive = false;
        snapshot.top_package = Some("com.other".to_string());
        assert_eq!(
            classify(Some(&snapshot), &["ReturnMain".to_string()]),
            FailureCause::DisplayGone
        );
    }

    #[test]
    fn physical_display_never_reports_display_gone() {
        let snapshot = state(
            r#"{
                "displayId": 0,
                "displayAlive": false,
                "targets": [],
                "tasks": {},
                "topPackage": null
            }"#,
        );
        assert_eq!(classify(Some(&snapshot), &[]), FailureCause::ScreenEmpty);
    }

    #[test]
    fn empty_targets_with_empty_screen_means_game_never_started() {
        let snapshot = state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": [],
                "tasks": {},
                "topPackage": null
            }"#,
        );
        assert_eq!(classify(Some(&snapshot), &[]), FailureCause::ScreenEmpty);
        assert!(render(&FailureCause::ScreenEmpty)
            .unwrap()
            .contains("never started"));
    }

    #[test]
    fn empty_targets_with_a_foreigner_means_occupied() {
        let snapshot = state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": [],
                "tasks": {},
                "topPackage": "com.android.settings"
            }"#,
        );
        assert_eq!(
            classify(Some(&snapshot), &[]),
            FailureCause::ScreenOccupiedBy("com.android.settings".to_string())
        );
    }

    #[test]
    fn running_target_with_clean_foreground_means_recognition_miss() {
        let missed = vec!["ReturnMain".to_string(), "EnterWilderness".to_string()];
        assert_eq!(
            classify(Some(&virtual_state()), &missed),
            FailureCause::RecognitionMissed {
                missed: missed.clone()
            }
        );
        let rendered = render(&FailureCause::RecognitionMissed { missed }).expect("renders");
        assert!(rendered.contains("ReturnMain, EnterWilderness"));
    }

    #[test]
    fn foreign_foreground_over_a_live_target_means_occupied() {
        let mut snapshot = virtual_state();
        snapshot.top_package = Some("com.android.systemui".to_string());
        assert_eq!(
            classify(Some(&snapshot), &[]),
            FailureCause::ScreenOccupiedBy("com.android.systemui".to_string())
        );
    }

    #[test]
    fn target_on_another_display_means_offscreen() {
        let mut snapshot = virtual_state();
        if let Some(task) = snapshot
            .tasks
            .get_mut("com.shenlan.m.reverse1999")
            .and_then(Option::as_mut)
        {
            task.display_id = Some(0);
        }
        assert_eq!(
            classify(Some(&snapshot), &[]),
            FailureCause::TargetOffscreen("com.shenlan.m.reverse1999".to_string())
        );
    }

    #[test]
    fn recorded_target_without_a_task_means_exited() {
        let mut snapshot = virtual_state();
        snapshot.tasks = BTreeMap::new();
        snapshot.top_package = None;
        assert_eq!(
            classify(Some(&snapshot), &[]),
            FailureCause::TargetExited("com.shenlan.m.reverse1999".to_string())
        );
        let cause = FailureCause::TargetExited("com.x".to_string());
        assert!(render(&cause).unwrap().contains("exited during the run"));
    }

    #[test]
    fn partial_snapshots_degrade_instead_of_failing_to_parse() {
        // Fields the reporting side does not send default to "unknown" values;
        // here an empty target list with no top package reads as an empty
        // screen.
        let snapshot = state(r#"{"displayId": 20, "targets": []}"#);
        assert_eq!(classify(Some(&snapshot), &[]), FailureCause::ScreenEmpty);
    }

    #[test]
    fn miss_tracker_dedupes_and_caps() {
        let mut tracker = MissTracker::new();
        for _ in 0..3 {
            tracker.on_miss("ReturnMain");
        }
        tracker.on_miss("EnterWilderness");
        assert_eq!(
            tracker.snapshot(),
            vec!["ReturnMain".to_string(), "EnterWilderness".to_string()]
        );
        for name in ["A", "B", "C", "D", "E", "F", "G"] {
            tracker.on_miss(name);
        }
        // Capacity 8: the oldest entry ("ReturnMain") is evicted first.
        assert_eq!(tracker.snapshot().len(), MissTracker::CAPACITY);
        assert_eq!(tracker.snapshot()[0], "EnterWilderness".to_string());
    }

    #[test]
    fn miss_tracker_clears_on_progress() {
        let mut tracker = MissTracker::new();
        tracker.on_miss("ReturnMain");
        tracker.on_progress();
        assert!(tracker.snapshot().is_empty());
    }

    #[test]
    fn global_trail_round_trips() {
        reset_misses();
        record_miss("ReturnMain");
        record_miss("ReturnMain");
        record_miss("EnterWilderness");
        assert_eq!(
            missed_nodes(),
            vec!["ReturnMain".to_string(), "EnterWilderness".to_string()]
        );
        record_progress();
        assert!(missed_nodes().is_empty());
    }
}

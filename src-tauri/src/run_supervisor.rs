//! Run supervisor: one module that watches the game's health on the
//! controlled display during a Maa run and stops the run early on fatal
//! failures.
//!
//! Replaces the scattered `game_fps` watcher and the post-failure-only
//! diagnosis probe with a single event loop that:
//! - Samples the game FPS once per second and warns on degradation
//! - Polls the target app state once per second and fails fast on:
//!   - Target app exit (crashed or stopped)
//!   - Virtual display loss
//! - Stops a run that reaches the user-configured maximum duration
//!
//! The supervisor does not correct display migration (the game's own
//! decision); it records the offscreen state so a later failure diagnosis
//! can explain it. Fatal findings trigger `request_stop` on the Maa session
//! immediately, before recognition misses accumulate.

#[cfg(any(target_os = "android", test))]
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// Sampling window: one sample per second for 15 seconds.
#[cfg(any(target_os = "android", test))]
pub(crate) const WINDOW_SIZE: usize = 15;
/// Fraction of window samples required below a threshold before advising.
#[cfg(any(target_os = "android", test))]
const MIN_FRACTION: f32 = 0.8;
/// Screen-silent streaks up to this length only pause judgement (loading
/// screens); longer streaks clear the window (menus, black frames).
#[cfg(any(target_os = "android", test))]
const MAX_IDLE_STREAK: usize = 3;
#[cfg(any(target_os = "android", test))]
pub(crate) const LOW_FPS: f32 = 30.0;
#[cfg(any(target_os = "android", test))]
pub(crate) const DEGRADED_FPS: f32 = 50.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(any(target_os = "android", test))]
pub(crate) enum AdviceLevel {
    Low,
    Degraded,
}

#[derive(Debug, Clone, Copy)]
#[cfg(any(target_os = "android", test))]
pub(crate) struct Advice {
    pub level: AdviceLevel,
    pub median_fps: f32,
}

/// Ported from MAA-Meow's `GameFpsAdvisor`: a fraction-based sliding window so
/// a few seconds of transition dips do not trigger, one advice per level, and
/// the two levels are mutually exclusive. After a LOW advice, samples
/// recovering into the 30-50 band satisfy the DEGRADED check and emit the
/// "still degraded" advice once.
#[cfg(any(target_os = "android", test))]
pub(crate) struct FpsAdvisor {
    window: VecDeque<f32>,
    idle_streak: usize,
    low_advised: bool,
    degraded_advised: bool,
    recovered_after_low: bool,
    required_count: usize,
}

#[cfg(any(target_os = "android", test))]
impl FpsAdvisor {
    pub(crate) fn new() -> Self {
        Self {
            window: VecDeque::with_capacity(WINDOW_SIZE),
            idle_streak: 0,
            low_advised: false,
            degraded_advised: false,
            recovered_after_low: false,
            required_count: (WINDOW_SIZE as f32 * MIN_FRACTION).ceil() as usize,
        }
    }

    pub(crate) fn on_sample(&mut self, fps: f32) -> Option<Advice> {
        if fps <= 0.0 {
            self.idle_streak += 1;
            if self.idle_streak > MAX_IDLE_STREAK {
                self.window.clear();
            }
            return None;
        }
        self.idle_streak = 0;
        self.recovered_after_low |= fps >= LOW_FPS;
        self.window.push_back(fps);
        while self.window.len() > WINDOW_SIZE {
            self.window.pop_front();
        }
        if self.window.len() < WINDOW_SIZE {
            return None;
        }

        let below = |threshold: f32| {
            self.window
                .iter()
                .filter(|sample| **sample < threshold)
                .count()
        };
        if below(LOW_FPS) >= self.required_count {
            if self.low_advised {
                return None;
            }
            self.low_advised = true;
            self.recovered_after_low = false;
            return Some(Advice {
                level: AdviceLevel::Low,
                median_fps: self.median(),
            });
        }
        if !self.degraded_advised
            && (!self.low_advised || self.recovered_after_low)
            && below(DEGRADED_FPS) >= self.required_count
        {
            self.degraded_advised = true;
            return Some(Advice {
                level: AdviceLevel::Degraded,
                median_fps: self.median(),
            });
        }
        None
    }

    fn median(&self) -> f32 {
        let mut sorted: Vec<f32> = self.window.iter().copied().collect();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let mid = sorted.len() / 2;
        if sorted.len() % 2 == 0 {
            (sorted[mid - 1] + sorted[mid]) / 2.0
        } else {
            sorted[mid]
        }
    }
}

#[cfg(any(target_os = "android", test))]
impl Default for FpsAdvisor {
    fn default() -> Self {
        Self::new()
    }
}

/// Shared cell holding the last known target app state so a failure
/// diagnosis can use the supervisor's observation instead of making another
/// IPC call after the fact.
struct HealthCell(Mutex<Option<crate::run_diagnosis::TargetAppState>>);

impl HealthCell {
    fn set(&self, state: crate::run_diagnosis::TargetAppState) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(state);
    }

    fn get(&self) -> Option<crate::run_diagnosis::TargetAppState> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

/// Upper bound for a configured run duration (7 days): a hand-edited or
/// corrupt configuration must not overflow the deadline arithmetic.
const MAX_RUN_DURATION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// The configured per-run duration limit, or `None` when it is disabled.
/// `0` means "no limit"; longer values are clamped to [`MAX_RUN_DURATION`].
pub(crate) fn configured_limit(seconds: u64) -> Option<Duration> {
    (seconds > 0).then(|| Duration::from_secs(seconds).min(MAX_RUN_DURATION))
}

/// Human-readable limit for the failure message; whole hours and minutes keep
/// their unit so `1800` is not reported as `1800 s`.
fn describe_duration(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds >= 3600 && seconds % 3600 == 0 {
        format!("{} h", seconds / 3600)
    } else if seconds >= 60 && seconds % 60 == 0 {
        format!("{} min", seconds / 60)
    } else {
        format!("{seconds} s")
    }
}

/// Failure message recorded when a run reaches its configured limit.
fn timeout_message(duration: Duration) -> String {
    format!(
        "the run exceeded the configured maximum duration of {}; stopping the run",
        describe_duration(duration)
    )
}

/// Resolves once the run's deadline passes, or never when it is unlimited.
/// The deadline is absolute, so re-creating this future on every loop
/// iteration does not postpone it.
async fn wait_for_deadline(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

/// RAII guard that owns the supervisor watch task. Dropping it signals the
/// watch loop to stop on every run exit path, including panics.
pub(crate) struct SupervisorGuard {
    stop_tx: tokio::sync::watch::Sender<bool>,
    last_health: Arc<HealthCell>,
}

impl SupervisorGuard {
    pub(crate) fn start(
        app: &tauri::AppHandle,
        logger: Arc<crate::run_log::RunLogger>,
        sessions: Arc<crate::runtime::MaaSessions>,
        execution_id: &str,
        display_id: u32,
        max_run_duration: Option<Duration>,
    ) -> Self {
        let last_health = Arc::new(HealthCell(Mutex::new(None)));
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        tokio::spawn(watch_loop(
            app.clone(),
            logger,
            sessions,
            execution_id.to_string(),
            display_id,
            max_run_duration,
            Arc::clone(&last_health),
            stop_rx,
        ));
        Self {
            stop_tx,
            last_health,
        }
    }

    /// Returns the last known target app state observed by the watch loop,
    /// or `None` if the supervisor has not observed it yet (desktop builds,
    /// or the watch loop just started).
    pub(crate) fn last_target_state(&self) -> Option<crate::run_diagnosis::TargetAppState> {
        self.last_health.get()
    }
}

impl Drop for SupervisorGuard {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(true);
    }
}

/// The kind of health finding from the latest target app state probe.
#[derive(Debug, Clone, PartialEq)]
#[cfg(any(target_os = "android", test))]
enum HealthFinding {
    Healthy,
    /// The virtual display backing the run no longer exists.
    DisplayLost,
    /// A recorded target package no longer has a running task.
    TargetExited(String),
    /// A recorded target package is running, but on a different display.
    TargetOffscreen(String),
    /// The probe itself failed (binder error, service down); not fatal.
    ProbeUnavailable,
}

#[cfg(any(target_os = "android", test))]
fn assess_health(state: &crate::run_diagnosis::TargetAppState) -> HealthFinding {
    if state.display_id != 0 && !state.display_alive {
        return HealthFinding::DisplayLost;
    }
    for package in &state.targets {
        match state.tasks.get(package) {
            None | Some(None) => return HealthFinding::TargetExited(package.clone()),
            Some(Some(task)) => {
                if let Some(task_display) = task.display_id {
                    if task_display != state.display_id {
                        return HealthFinding::TargetOffscreen(package.clone());
                    }
                }
            }
        }
    }
    HealthFinding::Healthy
}

#[cfg(target_os = "android")]
async fn watch_loop(
    app: tauri::AppHandle,
    logger: Arc<crate::run_log::RunLogger>,
    sessions: Arc<crate::runtime::MaaSessions>,
    execution_id: String,
    display_id: u32,
    max_run_duration: Option<Duration>,
    health_cell: Arc<HealthCell>,
    mut stop_rx: tokio::sync::watch::Receiver<bool>,
) {
    let mut advisor = FpsAdvisor::new();
    let mut last_frame_count: Option<i64> = None;
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let deadline = max_run_duration.map(|duration| tokio::time::Instant::now() + duration);

    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = stop_rx.changed() => break,
            _ = wait_for_deadline(deadline) => {
                if let Some(duration) = max_run_duration {
                    fatal(&app, &logger, &sessions, &execution_id, timeout_message(duration));
                }
                break;
            }
        }

        // FPS sample → advisor → event + warn.
        let fps = sample_fps(&mut last_frame_count);
        let advice = advisor.on_sample(fps.unwrap_or(0.0));
        let _ = app.emit("virtual-display-fps", serde_json::json!({ "fps": fps }));
        if let (Some(fps), Some(advice)) = (fps, advice) {
            warn_fps(&app, &logger, fps, advice);
        }

        // Target app state probe → health assessment.
        let state = crate::probe_target_app_state();
        if let Some(state) = &state {
            health_cell.set(state.clone());
        }
        let finding = state
            .as_ref()
            .map_or(HealthFinding::ProbeUnavailable, assess_health);
        match finding {
            HealthFinding::Healthy | HealthFinding::ProbeUnavailable => {}
            HealthFinding::DisplayLost => {
                fatal(
                    &app,
                    &logger,
                    &sessions,
                    &execution_id,
                    "the virtual display backing the run was lost; stopping the run".to_string(),
                );
                break;
            }
            HealthFinding::TargetExited(package) => {
                fatal(
                    &app,
                    &logger,
                    &sessions,
                    &execution_id,
                    format!("the target app {package} exited during the run; stopping the run"),
                );
                break;
            }
            HealthFinding::TargetOffscreen(package) => {
                warn_health(
                    &app,
                    &logger,
                    format!(
                        "the target app {package} moved to another display; recognition may fail"
                    ),
                );
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
async fn watch_loop(
    app: tauri::AppHandle,
    logger: Arc<crate::run_log::RunLogger>,
    sessions: Arc<crate::runtime::MaaSessions>,
    execution_id: String,
    _display_id: u32,
    max_run_duration: Option<Duration>,
    _health_cell: Arc<HealthCell>,
    mut stop_rx: tokio::sync::watch::Receiver<bool>,
) {
    let deadline = max_run_duration.map(|duration| tokio::time::Instant::now() + duration);
    tokio::select! {
        _ = stop_rx.changed() => {}
        _ = wait_for_deadline(deadline) => {
            if let Some(duration) = max_run_duration {
                fatal(&app, &logger, &sessions, &execution_id, timeout_message(duration));
            }
        }
    }
}

#[cfg(target_os = "android")]
fn sample_fps(last_frame_count: &mut Option<i64>) -> Option<f32> {
    if let Ok(fps) = crate::call_runtime_bridge_float("gameFps") {
        if fps >= 0.0 {
            return Some(fps);
        }
    }
    // Fallback: difference the native capture frame counter once per second.
    let values = crate::call_runtime_bridge_int_array("virtualDisplayStatus").ok()?;
    let active = values.first().copied().unwrap_or(0) == 1;
    let count = values.get(4).copied().unwrap_or(0) as i64;
    let difference = match (*last_frame_count, active) {
        (Some(previous), true) if count > previous => count - previous,
        _ => {
            *last_frame_count = active.then_some(count);
            return None;
        }
    };
    *last_frame_count = Some(count);
    Some(difference as f32)
}

#[cfg(target_os = "android")]
fn warn_fps(
    app: &tauri::AppHandle,
    logger: &Arc<crate::run_log::RunLogger>,
    fps: f32,
    advice: Advice,
) {
    let message = match advice.level {
        AdviceLevel::Low => format!(
            "Low game frame rate: median {:.0} FPS over the last {WINDOW_SIZE} seconds \
             (threshold {LOW_FPS:.0} FPS), current sample {fps:.0} FPS.",
            advice.median_fps,
        ),
        AdviceLevel::Degraded => format!(
            "Degraded game frame rate: median {:.0} FPS over the last {WINDOW_SIZE} seconds \
             (threshold {DEGRADED_FPS:.0} FPS), current sample {fps:.0} FPS.",
            advice.median_fps,
        ),
    };
    let data = serde_json::json!({
        "diagnostic": "gameFps",
        "level": match advice.level {
            AdviceLevel::Low => "low",
            AdviceLevel::Degraded => "degraded",
        },
        "windowSeconds": WINDOW_SIZE,
        "medianFps": advice.median_fps,
        "thresholdFps": match advice.level {
            AdviceLevel::Low => LOW_FPS,
            AdviceLevel::Degraded => DEGRADED_FPS,
        },
    });
    if let Ok(event) = logger.append(
        crate::run_log::RunEventKind::Warning,
        crate::runtime::RunState::Running,
        message,
        None,
        Some(data),
    ) {
        let _ = app.emit("run-event", &event);
    }
}

#[cfg(target_os = "android")]
fn warn_health(app: &tauri::AppHandle, logger: &Arc<crate::run_log::RunLogger>, message: String) {
    if let Ok(event) = logger.append(
        crate::run_log::RunEventKind::Warning,
        crate::runtime::RunState::Running,
        message,
        None,
        None,
    ) {
        let _ = app.emit("run-event", &event);
    }
}

fn fatal(
    app: &tauri::AppHandle,
    logger: &Arc<crate::run_log::RunLogger>,
    sessions: &Arc<crate::runtime::MaaSessions>,
    execution_id: &str,
    message: String,
) {
    log::warn!("run supervisor: {message}");
    if let Ok(event) = logger.append(
        crate::run_log::RunEventKind::Failure,
        crate::runtime::RunState::Running,
        message.clone(),
        None,
        None,
    ) {
        let _ = app.emit("run-event", &event);
    }
    // The run will terminate when the tasker processes the stop request.
    // The supervisor break exits the watch loop; the run's normal completion
    // path handles the final state and cleanup.
    let _ = sessions.request_stop(Some(execution_id));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(advisor: &mut FpsAdvisor, fps: f32, count: usize) -> Option<Advice> {
        let mut first = None;
        for _ in 0..count {
            let advice = advisor.on_sample(fps);
            if first.is_none() {
                first = advice;
            }
        }
        first
    }

    #[test]
    fn window_must_fill_before_advising() {
        let mut advisor = FpsAdvisor::new();
        assert!(feed(&mut advisor, 25.0, WINDOW_SIZE - 1).is_none());
        let advice = advisor.on_sample(25.0).expect("the window is full");
        assert_eq!(advice.level, AdviceLevel::Low);
        assert_eq!(advice.median_fps, 25.0);
    }

    #[test]
    fn each_level_advises_once() {
        let mut advisor = FpsAdvisor::new();
        assert!(feed(&mut advisor, 25.0, WINDOW_SIZE).is_some());
        assert!(feed(&mut advisor, 25.0, WINDOW_SIZE * 3).is_none());
    }

    #[test]
    fn insufficient_low_fraction_skips_advice() {
        let mut advisor = FpsAdvisor::new();
        for _ in 0..11 {
            advisor.on_sample(25.0);
        }
        for _ in 0..4 {
            advisor.on_sample(60.0);
        }
        assert!(advisor.on_sample(60.0).is_none());
    }

    #[test]
    fn short_idle_streaks_pause_but_longer_ones_clear_the_window() {
        let mut advisor = FpsAdvisor::new();
        for _ in 0..10 {
            advisor.on_sample(25.0);
        }
        for _ in 0..3 {
            assert!(advisor.on_sample(0.0).is_none());
        }
        for _ in 0..4 {
            advisor.on_sample(25.0);
        }
        assert!(advisor.on_sample(25.0).is_some());

        let mut advisor = FpsAdvisor::new();
        for _ in 0..14 {
            advisor.on_sample(25.0);
        }
        for _ in 0..4 {
            advisor.on_sample(0.0);
        }
        for _ in 0..4 {
            advisor.on_sample(60.0);
        }
        assert!(advisor.on_sample(60.0).is_none());
    }

    #[test]
    fn recovery_into_the_moderate_band_advises_degraded() {
        let mut advisor = FpsAdvisor::new();
        assert_eq!(
            feed(&mut advisor, 25.0, WINDOW_SIZE)
                .expect("low advice fired")
                .level,
            AdviceLevel::Low
        );
        let advice = feed(&mut advisor, 40.0, WINDOW_SIZE).expect("degraded advice fired");
        assert_eq!(advice.level, AdviceLevel::Degraded);
        assert!(advice.median_fps >= 25.0 && advice.median_fps <= 40.0);
    }

    #[test]
    fn levels_are_mutually_exclusive() {
        let mut advisor = FpsAdvisor::new();
        assert_eq!(
            feed(&mut advisor, 40.0, WINDOW_SIZE)
                .expect("degraded advice fired")
                .level,
            AdviceLevel::Degraded
        );
        assert!(feed(&mut advisor, 40.0, WINDOW_SIZE).is_none());
        assert_eq!(
            feed(&mut advisor, 25.0, WINDOW_SIZE)
                .expect("low advice fired")
                .level,
            AdviceLevel::Low
        );
        assert!(feed(&mut advisor, 25.0, WINDOW_SIZE).is_none());
    }

    fn health_state(json: &str) -> crate::run_diagnosis::TargetAppState {
        serde_json::from_str(json).expect("snapshot should parse")
    }

    #[test]
    fn healthy_target_is_not_fatal() {
        let state = health_state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": ["com.game.pkg"],
                "tasks": {"com.game.pkg": {"taskId": 1, "displayId": 20}},
                "topPackage": "com.game.pkg"
            }"#,
        );
        assert_eq!(assess_health(&state), HealthFinding::Healthy);
    }

    #[test]
    fn lost_display_is_fatal() {
        let state = health_state(
            r#"{
                "displayId": 20,
                "displayAlive": false,
                "targets": ["com.game.pkg"],
                "tasks": {"com.game.pkg": {"taskId": 1, "displayId": 20}},
                "topPackage": "com.game.pkg"
            }"#,
        );
        assert_eq!(assess_health(&state), HealthFinding::DisplayLost);
    }

    #[test]
    fn exited_target_is_fatal() {
        let state = health_state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": ["com.game.pkg"],
                "tasks": {},
                "topPackage": null
            }"#,
        );
        assert_eq!(
            assess_health(&state),
            HealthFinding::TargetExited("com.game.pkg".to_string())
        );
    }

    #[test]
    fn offscreen_target_is_a_warning() {
        let state = health_state(
            r#"{
                "displayId": 20,
                "displayAlive": true,
                "targets": ["com.game.pkg"],
                "tasks": {"com.game.pkg": {"taskId": 1, "displayId": 0}},
                "topPackage": null
            }"#,
        );
        assert_eq!(
            assess_health(&state),
            HealthFinding::TargetOffscreen("com.game.pkg".to_string())
        );
    }

    #[test]
    fn physical_display_never_reports_display_lost() {
        let state = health_state(
            r#"{
                "displayId": 0,
                "displayAlive": false,
                "targets": [],
                "tasks": {},
                "topPackage": null
            }"#,
        );
        assert_eq!(assess_health(&state), HealthFinding::Healthy);
    }

    #[test]
    fn zero_seconds_disables_the_run_duration_limit() {
        assert_eq!(configured_limit(0), None);
    }

    #[test]
    fn configured_limits_are_clamped_to_the_upper_bound() {
        assert_eq!(configured_limit(90), Some(Duration::from_secs(90)));
        assert_eq!(configured_limit(u64::MAX), Some(MAX_RUN_DURATION));
    }

    #[test]
    fn the_timeout_message_keeps_the_configured_unit() {
        assert_eq!(describe_duration(Duration::from_secs(45)), "45 s");
        assert_eq!(describe_duration(Duration::from_secs(1_800)), "30 min");
        assert_eq!(describe_duration(Duration::from_secs(5_400)), "90 min");
        assert_eq!(describe_duration(Duration::from_secs(7_200)), "2 h");
        assert_eq!(
            timeout_message(Duration::from_secs(1_800)),
            "the run exceeded the configured maximum duration of 30 min; stopping the run"
        );
    }

    #[tokio::test]
    async fn an_unlimited_run_never_reaches_the_deadline() {
        assert!(
            tokio::time::timeout(Duration::from_millis(50), wait_for_deadline(None))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_limited_run_resolves_at_its_deadline() {
        let deadline = Some(tokio::time::Instant::now() + Duration::from_millis(10));

        assert!(
            tokio::time::timeout(Duration::from_secs(5), wait_for_deadline(deadline))
                .await
                .is_ok()
        );
    }
}

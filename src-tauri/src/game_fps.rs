//! Game frame-rate sampling for the Android virtual display.
//!
//! One sample per second while a run is active. The primary source is the
//! privileged service's `gameFps()` (Android 13+ `registerTaskFpsCallback`);
//! when that is unavailable the native virtual-display frame counter is
//! differenced instead, which under-reports under load because the capture
//! loop drops backlogged frames — accepted, and labeled "approximate" in
//! warnings. Samples feed [`FpsAdvisor`]; warnings always go to the run log,
//! while the per-second event drives the optional on-screen badge only.

use std::collections::VecDeque;

/// Sampling window: one sample per second for 15 seconds.
pub(crate) const WINDOW_SIZE: usize = 15;
/// Fraction of window samples required below a threshold before advising.
const MIN_FRACTION: f32 = 0.8;
/// Screen-silent streaks up to this length only pause judgement (loading
/// screens); longer streaks clear the window (menus, black frames).
const MAX_IDLE_STREAK: usize = 3;
pub(crate) const LOW_FPS: f32 = 30.0;
pub(crate) const DEGRADED_FPS: f32 = 50.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdviceLevel {
    Low,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Advice {
    pub level: AdviceLevel,
    pub median_fps: f32,
}

/// Ported from MAA-Meow's `GameFpsAdvisor`: a fraction-based sliding window so
/// a few seconds of transition dips do not trigger, one advice per level, and
/// the two levels are mutually exclusive. After a LOW advice, samples
/// recovering into the 30–50 band satisfy the DEGRADED check and emit the
/// "still degraded" advice once.
pub(crate) struct FpsAdvisor {
    window: VecDeque<f32>,
    idle_streak: usize,
    low_advised: bool,
    degraded_advised: bool,
    required_count: usize,
}

impl FpsAdvisor {
    pub(crate) fn new() -> Self {
        Self {
            window: VecDeque::with_capacity(WINDOW_SIZE),
            idle_streak: 0,
            low_advised: false,
            degraded_advised: false,
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
            return Some(Advice {
                level: AdviceLevel::Low,
                median_fps: self.median(),
            });
        }
        if below(DEGRADED_FPS) >= self.required_count {
            if self.degraded_advised {
                return None;
            }
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

impl Default for FpsAdvisor {
    fn default() -> Self {
        Self::new()
    }
}

/// Stops the per-second watcher when the run task ends for any reason,
/// including panics and early returns from the failure branches.
pub(crate) struct RunGuard {
    /// Never read; holding it is the point — dropping it stops the watcher
    /// on every run exit path, including panics.
    #[allow(dead_code)]
    inner: RunGuardInner,
}

pub(crate) fn run_guard(
    app: &tauri::AppHandle,
    logger: std::sync::Arc<crate::run_log::RunLogger>,
) -> RunGuard {
    RunGuard {
        inner: RunGuardInner::new(app, logger),
    }
}

#[cfg(target_os = "android")]
mod watcher {
    use super::{Advice, AdviceLevel, FpsAdvisor, DEGRADED_FPS, LOW_FPS, WINDOW_SIZE};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::Duration;
    use tauri::Emitter;

    #[derive(Clone, Copy, PartialEq)]
    enum FpsSource {
        TaskCallback,
        FrameCount,
    }

    struct Sample {
        fps: f32,
        source: FpsSource,
    }

    struct WatchSender(Mutex<Option<tokio::sync::watch::Sender<bool>>>);

    fn watcher() -> &'static WatchSender {
        static WATCHER: OnceLock<WatchSender> = OnceLock::new();
        WATCHER.get_or_init(|| WatchSender(Mutex::new(None)))
    }

    pub(super) struct RunGuardInner;

    impl RunGuardInner {
        pub(super) fn new(app: &tauri::AppHandle, logger: Arc<crate::run_log::RunLogger>) -> Self {
            stop();
            let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
            *watcher().0.lock().expect("watcher mutex poisoned") = Some(stop_tx);
            let app = app.clone();
            tokio::spawn(async move {
                watch_loop(app, logger, stop_rx).await;
            });
            RunGuardInner
        }
    }

    impl Drop for RunGuardInner {
        fn drop(&mut self) {
            stop();
        }
    }

    fn stop() {
        if let Some(sender) = watcher().0.lock().expect("watcher mutex poisoned").take() {
            let _ = sender.send(true);
        }
    }

    async fn watch_loop(
        app: tauri::AppHandle,
        logger: Arc<crate::run_log::RunLogger>,
        mut stop_rx: tokio::sync::watch::Receiver<bool>,
    ) {
        let mut advisor = FpsAdvisor::new();
        let mut last_frame_count: Option<i64> = None;
        // Skip behaves like the one-per-second cadence the advisor expects; a
        // delayed tick must not pile up back-to-back samples.
        let mut ticker = tokio::time::interval(Duration::from_secs(1));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = stop_rx.changed() => break,
            }
            let sample = sample_fps(&mut last_frame_count);
            let advice = advisor.on_sample(sample.as_ref().map_or(0.0, |sample| sample.fps));
            // The event always flows; the badge visibility is gated on the
            // frontend by the user configuration switch.
            let _ = app.emit(
                "virtual-display-fps",
                serde_json::json!({ "fps": sample.as_ref().map(|sample| sample.fps) }),
            );
            if let (Some(sample), Some(advice)) = (sample, advice) {
                warn(&app, &logger, sample.source, advice);
            }
        }
    }

    fn sample_fps(last_frame_count: &mut Option<i64>) -> Option<Sample> {
        if let Ok(fps) = super::super::call_runtime_bridge_float("gameFps") {
            if fps >= 0.0 {
                return Some(Sample {
                    fps,
                    source: FpsSource::TaskCallback,
                });
            }
        }

        // Fallback: difference the native capture frame counter once per
        // second. Invalid when the counter went backwards, was capped, or
        // this is the first tick.
        let values = super::super::call_runtime_bridge_int_array("virtualDisplayStatus").ok()?;
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
        Some(Sample {
            fps: difference as f32,
            source: FpsSource::FrameCount,
        })
    }

    fn warn(
        app: &tauri::AppHandle,
        logger: &Arc<crate::run_log::RunLogger>,
        source: FpsSource,
        advice: Advice,
    ) {
        let source_description = match source {
            FpsSource::TaskCallback => "the system frame-rate callback",
            FpsSource::FrameCount => "the approximate frame counter",
        };
        let message = match advice.level {
            AdviceLevel::Low => format!(
                "Low game frame rate: median {:.0} FPS over the last {WINDOW_SIZE} seconds \
                 (threshold {LOW_FPS:.0} FPS), reported by {source_description}.",
                advice.median_fps,
            ),
            AdviceLevel::Degraded => format!(
                "Degraded game frame rate: median {:.0} FPS over the last {WINDOW_SIZE} seconds \
                 (threshold {DEGRADED_FPS:.0} FPS), reported by {source_description}.",
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
            "source": match source {
                FpsSource::TaskCallback => "taskCallback",
                FpsSource::FrameCount => "frameCounter",
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
}

#[cfg(target_os = "android")]
use watcher::RunGuardInner;

#[cfg(not(target_os = "android"))]
struct RunGuardInner;

#[cfg(not(target_os = "android"))]
impl RunGuardInner {
    fn new(_app: &tauri::AppHandle, _logger: std::sync::Arc<crate::run_log::RunLogger>) -> Self {
        RunGuardInner
    }
}

#[cfg(test)]
mod tests {
    use super::{AdviceLevel, FpsAdvisor, WINDOW_SIZE};

    fn feed(advisor: &mut FpsAdvisor, fps: f32, count: usize) -> Option<super::Advice> {
        // Advice fires the moment the fraction threshold is met, which can be
        // mid-feed during a level transition; surface the first advice.
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
        // 11 of 15 samples below 30 (needs 12); the rest are healthy.
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
        // Window still holds the 10 low samples; filling to 15 advises LOW.
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
        // The window was cleared; four healthy samples are not enough.
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
        // The advice fires as soon as the recovering window satisfies the
        // degraded fraction, so its median still reflects the transition mix.
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
}

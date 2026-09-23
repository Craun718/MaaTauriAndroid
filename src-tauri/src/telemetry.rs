use crate::domain::types::TelemetryConfig;
use sentry::ClientInitGuard;
use sentry::Transaction;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static ENABLED: AtomicBool = AtomicBool::new(false);
static TRACING: AtomicBool = AtomicBool::new(false);
static CLIENT: Mutex<Option<ClientInitGuard>> = Mutex::new(None);
static RUN_TRANSACTION: Mutex<Option<Transaction>> = Mutex::new(None);

/// Whether telemetry is currently allowed to send anything. Kept off until the
/// resource project declares a DSN, the user consents, and the build is release.
pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Applies the project's telemetry declaration and the user's consent.
pub fn configure(telemetry: Option<&TelemetryConfig>, user_enabled: bool) {
    let allowed = !cfg!(debug_assertions) && user_enabled;
    let mut client = CLIENT.lock().expect("telemetry client lock poisoned");
    *client = None;
    let Some(config) = telemetry.filter(|_| allowed) else {
        ENABLED.store(false, Ordering::SeqCst);
        TRACING.store(false, Ordering::SeqCst);
        return;
    };
    let Some(dsn) = config
        .dsn
        .as_deref()
        .filter(|dsn| !dsn.is_empty())
        .and_then(|dsn| dsn.parse::<sentry::types::Dsn>().ok())
    else {
        ENABLED.store(false, Ordering::SeqCst);
        TRACING.store(false, Ordering::SeqCst);
        return;
    };
    ENABLED.store(true, Ordering::SeqCst);
    TRACING.store(config.tracing, Ordering::SeqCst);
    let options = sentry::ClientOptions {
        release: Some(format!("mta@{}", env!("CARGO_PKG_VERSION")).into()),
        environment: config.environment.clone().map(std::borrow::Cow::Owned),
        traces_sample_rate: config.traces_sample_rate.clamp(0.0, 1.0) as f32,
        ..Default::default()
    };
    *client = Some(sentry::init((dsn, options)));
}

/// Tags every report with the loaded resource project so events are easy to tell apart.
pub fn tag_project(name: Option<&str>, version: Option<&str>) {
    if !enabled() {
        return;
    }
    if let Some(name) = name {
        sentry::configure_scope(|scope| scope.set_tag("project.name", name.to_string()));
    }
    if let Some(version) = version {
        sentry::configure_scope(|scope| scope.set_tag("project.version", version.to_string()));
    }
}

/// Starts one transaction for each run. Focus tracing adds child spans to it.
pub fn run_started(execution_id: &str) {
    if !enabled() || !TRACING.load(Ordering::SeqCst) {
        return;
    }
    let transaction = sentry::start_transaction(sentry::TransactionContext::new("Maa run", "run"));
    transaction.set_data(
        "executionId",
        sentry::protocol::Value::String(execution_id.to_string()),
    );
    let mut current = RUN_TRANSACTION
        .lock()
        .expect("run transaction lock poisoned");
    if let Some(previous) = current.replace(transaction) {
        previous.set_status(sentry::protocol::SpanStatus::Cancelled);
        previous.finish();
    }
}

/// Finishes the active run transaction with the terminal outcome.
pub fn run_finished(outcome: &str) {
    if !enabled() || !TRACING.load(Ordering::SeqCst) {
        return;
    }
    let transaction = RUN_TRANSACTION
        .lock()
        .expect("run transaction lock poisoned")
        .take();
    let Some(transaction) = transaction else {
        return;
    };
    transaction.set_data(
        "outcome",
        sentry::protocol::Value::String(outcome.to_string()),
    );
    transaction.set_status(match outcome {
        "completed" => sentry::protocol::SpanStatus::Ok,
        "failed" => sentry::protocol::SpanStatus::UnknownError,
        _ => sentry::protocol::SpanStatus::Cancelled,
    });
    transaction.finish();
}

/// Records a traced node as a child span of the active run transaction.
pub fn node_trace(message_type: &str, content: Option<&str>, name: Option<&str>) {
    if !enabled() || !TRACING.load(Ordering::SeqCst) {
        return;
    }
    let transaction = RUN_TRANSACTION
        .lock()
        .expect("run transaction lock poisoned")
        .clone();
    let Some(transaction) = transaction else {
        return;
    };
    let span = transaction.start_child("task.node", name.unwrap_or(message_type));
    span.set_data(
        "messageType",
        sentry::protocol::Value::String(message_type.to_string()),
    );
    if let Some(content) = content {
        if !content.is_empty() {
            span.set_data(
                "focus",
                sentry::protocol::Value::String(content.to_string()),
            );
        }
    }
    if message_type.ends_with(".Failed") {
        span.set_status(sentry::protocol::SpanStatus::UnknownError);
    } else {
        span.set_status(sentry::protocol::SpanStatus::Ok);
    }
    span.finish();
}

/// Reports a run lifecycle event; failures can carry a diagnostic screenshot
/// attachment (the caller already applied the failure attachment sample rate).
pub fn run_event(outcome: &str, message: &str, attachment_path: Option<&str>) {
    if !enabled() {
        return;
    }
    sentry::with_scope(
        |scope| {
            scope.set_tag("run.outcome", outcome.to_string());
            if let Some(path) = attachment_path {
                if let Ok(buffer) = std::fs::read(path) {
                    let filename = std::path::Path::new(path)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "failure.png".to_string());
                    scope.add_attachment(sentry::protocol::Attachment {
                        buffer,
                        filename,
                        content_type: None,
                        ty: None,
                    });
                }
            }
        },
        || {
            let level = if outcome == "failed" {
                sentry::Level::Error
            } else {
                sentry::Level::Info
            };
            sentry::capture_message(message, level);
        },
    );
}

/// Deterministic-ish coarse sampler for attachment rates in the 0..1 range.
pub fn sample(rate: f64) -> bool {
    if rate >= 1.0 {
        return true;
    }
    if rate <= 0.0 {
        return false;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos() as f64 / 1_000_000_000.0)
        .unwrap_or(0.0);
    now < rate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configure_requires_release_build_with_dsn_and_consent() {
        ENABLED.store(false, Ordering::SeqCst);
        let config = TelemetryConfig {
            dsn: Some("https://example@sentry.example/1".to_string()),
            ..Default::default()
        };
        configure(Some(&config), false);
        assert!(!enabled());
        configure(Some(&config), true);
        assert!(!enabled());
    }

    #[test]
    fn configure_ignores_empty_dsn() {
        ENABLED.store(false, Ordering::SeqCst);
        let config = TelemetryConfig {
            dsn: Some("".to_string()),
            ..Default::default()
        };
        configure(Some(&config), true);
        assert!(!enabled());
    }

    #[test]
    fn sample_includes_and_excludes_boundaries() {
        assert!(sample(1.0));
        assert!(!sample(0.0));
    }
}

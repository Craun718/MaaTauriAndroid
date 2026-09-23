use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

use crate::atomic_io::write_atomic;

const TRIGGER_LOG_LIMIT: usize = 200;

fn default_rule_id() -> String {
    Uuid::new_v4().to_string()
}

#[derive(Debug, Error)]
pub enum ScheduleError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("invalid schedule rule: {0}")]
    Validation(String),
    #[error("schedule rule was not found")]
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRule {
    #[serde(default = "default_rule_id")]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub run_configuration_id: String,
    // Nested (not flattened) so the wire shape matches the frontend's
    // `ScheduleRule.trigger` discriminated union exactly.
    pub trigger: ScheduleTrigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScheduleTrigger {
    FixedTime {
        days: Vec<u32>,
        times: Vec<String>,
    },
    Interval {
        start_epoch_ms: i64,
        interval_days: u32,
        interval_hours: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRuleStatus {
    #[serde(flatten)]
    pub rule: ScheduleRule,
    pub next_trigger_epoch_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSummary {
    pub rule_count: usize,
    pub enabled_count: usize,
    pub next_trigger_epoch_ms: Option<i64>,
    pub last_trigger: Option<ScheduleTriggerLogEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleTriggerResult {
    Started,
    Duplicate,
    RejectedActive,
    FailedValidation,
    FailedServiceStart,
    ForegroundServiceDenied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTriggerLogEntry {
    pub rule_id: String,
    pub scheduled_epoch_ms: i64,
    pub actual_epoch_ms: i64,
    pub result: ScheduleTriggerResult,
    pub detail: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ScheduleDocument {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    rules: Vec<ScheduleRule>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TriggerLogDocument {
    #[serde(default)]
    entries: Vec<ScheduleTriggerLogEntry>,
}

pub struct ScheduleStore {
    rules_path: PathBuf,
    log_path: PathBuf,
}

impl ScheduleStore {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Self {
            rules_path: data_dir.as_ref().join("schedules.json"),
            log_path: data_dir.as_ref().join("schedule-triggers.json"),
        }
    }

    pub fn list(&self) -> Result<Vec<ScheduleRuleStatus>, ScheduleError> {
        Ok(self
            .rules()?
            .into_iter()
            .map(|rule| ScheduleRuleStatus {
                next_trigger_epoch_ms: next_trigger_epoch_ms(&rule, Local::now()),
                rule,
            })
            .collect())
    }

    pub fn save(&self, input: ScheduleRule) -> Result<ScheduleRule, ScheduleError> {
        let mut rule = input;
        rule.name = rule.name.trim().to_string();
        validate(&rule)?;
        if rule.id.is_empty() {
            rule.id = Uuid::new_v4().to_string();
        }
        let mut document = self.read_rules()?;
        match document.rules.iter_mut().find(|item| item.id == rule.id) {
            Some(existing) => *existing = rule.clone(),
            None => document.rules.push(rule.clone()),
        }
        self.write_rules(&document)?;
        Ok(rule)
    }

    pub fn delete(&self, id: &str) -> Result<(), ScheduleError> {
        let mut document = self.read_rules()?;
        let original = document.rules.len();
        document.rules.retain(|rule| rule.id != id);
        if document.rules.len() == original {
            return Err(ScheduleError::NotFound);
        }
        self.write_rules(&document)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<ScheduleRule, ScheduleError> {
        let mut document = self.read_rules()?;
        let rule = document
            .rules
            .iter_mut()
            .find(|rule| rule.id == id)
            .ok_or(ScheduleError::NotFound)?;
        rule.enabled = enabled;
        let rule = rule.clone();
        validate(&rule)?;
        self.write_rules(&document)?;
        Ok(rule)
    }

    pub fn find(&self, id: &str) -> Result<Option<ScheduleRule>, ScheduleError> {
        Ok(self.rules()?.into_iter().find(|rule| rule.id == id))
    }

    pub fn summary(&self) -> Result<ScheduleSummary, ScheduleError> {
        let statuses = self.list()?;
        let enabled: Vec<_> = statuses
            .iter()
            .filter(|status| status.rule.enabled)
            .collect();
        let last_trigger = self.trigger_log()?.into_iter().next();
        Ok(ScheduleSummary {
            rule_count: statuses.len(),
            enabled_count: enabled.len(),
            next_trigger_epoch_ms: enabled
                .iter()
                .filter_map(|status| status.next_trigger_epoch_ms)
                .min(),
            last_trigger,
        })
    }

    pub fn record_trigger(&self, entry: ScheduleTriggerLogEntry) -> Result<(), ScheduleError> {
        let mut document = self.read_trigger_log()?;
        document.entries.insert(0, entry);
        document.entries.truncate(TRIGGER_LOG_LIMIT);
        write_atomic(&self.log_path, &serde_json::to_vec_pretty(&document)?)?;
        Ok(())
    }

    pub fn is_duplicate(
        &self,
        rule_id: &str,
        scheduled_epoch_ms: i64,
    ) -> Result<bool, ScheduleError> {
        Ok(self.trigger_log()?.iter().any(|entry| {
            entry.rule_id == rule_id && entry.scheduled_epoch_ms == scheduled_epoch_ms
        }))
    }

    fn rules(&self) -> Result<Vec<ScheduleRule>, ScheduleError> {
        Ok(self.read_rules()?.rules)
    }

    fn read_rules(&self) -> Result<ScheduleDocument, ScheduleError> {
        read_document(&self.rules_path)
    }

    fn read_trigger_log(&self) -> Result<TriggerLogDocument, ScheduleError> {
        read_document(&self.log_path)
    }

    fn trigger_log(&self) -> Result<Vec<ScheduleTriggerLogEntry>, ScheduleError> {
        Ok(self.read_trigger_log()?.entries)
    }

    fn write_rules(&self, document: &ScheduleDocument) -> Result<(), ScheduleError> {
        write_atomic(&self.rules_path, &serde_json::to_vec_pretty(document)?)?;
        Ok(())
    }
}

fn read_document<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, ScheduleError> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub fn next_trigger_epoch_ms(rule: &ScheduleRule, after: DateTime<Local>) -> Option<i64> {
    match &rule.trigger {
        ScheduleTrigger::FixedTime { days, times } => next_fixed_time(days, times, after),
        ScheduleTrigger::Interval {
            start_epoch_ms,
            interval_days,
            interval_hours,
        } => {
            let interval_minutes =
                i64::from(*interval_days) * 24 * 60 + i64::from(*interval_hours) * 60;
            if interval_minutes == 0 || after.timestamp_millis() < *start_epoch_ms {
                return Some(*start_epoch_ms);
            }
            let elapsed = after.timestamp_millis() - start_epoch_ms;
            let interval_ms = interval_minutes.checked_mul(60_000)?;
            let steps = elapsed / interval_ms + 1;
            start_epoch_ms.checked_add(steps.checked_mul(interval_ms)?)
        }
    }
}

fn next_fixed_time(days: &[u32], times: &[String], after: DateTime<Local>) -> Option<i64> {
    let mut candidates = Vec::new();
    for day in 0..=8 {
        let date = after.date_naive() + Duration::days(day);
        if !days.contains(&date.weekday().number_from_monday()) {
            continue;
        }
        for time in times {
            let Ok(naive_time) = parse_time(time) else {
                continue;
            };
            let naive = date.and_time(naive_time);
            let Some(value) = Local
                .from_local_datetime(&naive)
                .earliest()
                .filter(|value| *value > after)
            else {
                continue;
            };
            candidates.push(value.timestamp_millis());
        }
    }
    candidates.into_iter().min()
}

fn parse_time(value: &str) -> Result<NaiveTime, ScheduleError> {
    let parts = value.split(':').collect::<Vec<_>>();
    if parts.len() != 2 {
        return Err(ScheduleError::Validation("time must use HH:mm".to_string()));
    }
    let hour = parts[0]
        .parse::<u32>()
        .map_err(|_| ScheduleError::Validation("invalid hour".to_string()))?;
    let minute = parts[1]
        .parse::<u32>()
        .map_err(|_| ScheduleError::Validation("invalid minute".to_string()))?;
    NaiveTime::from_hms_opt(hour, minute, 0)
        .ok_or_else(|| ScheduleError::Validation("invalid clock time".to_string()))
}

fn validate(rule: &ScheduleRule) -> Result<(), ScheduleError> {
    if rule.name.trim().is_empty() {
        return Err(ScheduleError::Validation("name is required".to_string()));
    }
    if rule.run_configuration_id.trim().is_empty() {
        return Err(ScheduleError::Validation(
            "a run configuration is required".to_string(),
        ));
    }
    match &rule.trigger {
        ScheduleTrigger::FixedTime { days, times } => {
            let valid = !days.is_empty()
                && days.iter().all(|day| (1..=7).contains(day))
                && days.len() == days.iter().collect::<std::collections::HashSet<_>>().len();
            if !valid {
                return Err(ScheduleError::Validation(
                    "select at least one weekday".to_string(),
                ));
            }
            if times.is_empty()
                || times.len() != times.iter().collect::<std::collections::HashSet<_>>().len()
            {
                return Err(ScheduleError::Validation(
                    "select at least one time".to_string(),
                ));
            }
            for time in times {
                parse_time(time)?;
            }
        }
        ScheduleTrigger::Interval {
            start_epoch_ms,
            interval_days,
            interval_hours,
        } => {
            if *start_epoch_ms < 0 {
                return Err(ScheduleError::Validation(
                    "the interval start is invalid".to_string(),
                ));
            }
            if *interval_days == 0 && *interval_hours == 0 {
                return Err(ScheduleError::Validation(
                    "the interval must be greater than zero".to_string(),
                ));
            }
            i64::from(*interval_days)
                .checked_mul(24 * 60)
                .and_then(|days| days.checked_add(i64::from(*interval_hours) * 60))
                .ok_or_else(|| {
                    ScheduleError::Validation("the interval must be greater than zero".to_string())
                })?;
        }
    }
    Ok(())
}

fn default_true() -> bool {
    true
}

fn default_schema_version() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_rule() -> ScheduleRule {
        ScheduleRule {
            id: "rule".to_string(),
            name: "Daily".to_string(),
            enabled: true,
            run_configuration_id: "run".to_string(),
            trigger: ScheduleTrigger::FixedTime {
                days: vec![1, 2, 3, 4, 5, 6, 7],
                times: vec!["12:00".to_string()],
            },
        }
    }

    #[test]
    fn fixed_time_finds_the_next_occurrence() {
        let after = Local::now();
        let next = next_trigger_epoch_ms(&fixed_rule(), after).unwrap();
        let parsed = Local.timestamp_millis_opt(next).single().unwrap();
        assert!(next > after.timestamp_millis());
        assert_eq!(parsed.time(), NaiveTime::from_hms_opt(12, 0, 0).unwrap());
    }

    #[test]
    fn interval_moves_to_the_next_multiple() {
        let after = Local::now();
        let rule = ScheduleRule {
            trigger: ScheduleTrigger::Interval {
                start_epoch_ms: after.timestamp_millis() - 90 * 60_000,
                interval_days: 0,
                interval_hours: 1,
            },
            ..fixed_rule()
        };
        let next = next_trigger_epoch_ms(&rule, after).unwrap();
        // Strictly-future next multiple: 90 minutes into a 1-hour interval
        // means one completed step plus one, landing 30 minutes from `after`
        // (matches the FixedTime branch's `> after` semantics).
        assert_eq!(next, after.timestamp_millis() + 30 * 60_000);
    }

    #[test]
    fn fixed_time_requires_unique_days_and_times() {
        let mut rule = fixed_rule();
        rule.trigger = ScheduleTrigger::FixedTime {
            days: vec![1, 1],
            times: vec!["07:30".to_string(), "07:30".to_string()],
        };
        assert!(validate(&rule).is_err());
        rule.trigger = ScheduleTrigger::FixedTime {
            days: vec![1, 2],
            times: vec!["07:30".to_string(), "08:30".to_string()],
        };
        assert!(validate(&rule).is_ok());
    }

    #[test]
    fn corrupted_documents_report_an_error() {
        let dir = std::env::temp_dir().join(format!("mta-schedule-bad-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("schedules.json"), b"{").unwrap();
        let store = ScheduleStore::new(&dir);
        assert!(store.list().is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn validation_rejects_invalid_rules() {
        let mut rule = fixed_rule();
        rule.name = " ".to_string();
        assert!(validate(&rule).is_err());
        rule.name = "Daily".to_string();
        rule.run_configuration_id = String::new();
        assert!(validate(&rule).is_err());
    }

    #[test]
    fn persistence_round_trips_and_deduplicates_triggers() -> Result<(), ScheduleError> {
        let dir = std::env::temp_dir().join(format!("mta-schedule-{}", Uuid::new_v4()));
        let store = ScheduleStore::new(&dir);
        let saved = store.save(fixed_rule())?;
        assert_eq!(store.list()?.len(), 1);
        assert_eq!(store.find(&saved.id)?.unwrap().id, saved.id);
        let entry = ScheduleTriggerLogEntry {
            rule_id: saved.id.clone(),
            scheduled_epoch_ms: 123,
            actual_epoch_ms: 124,
            result: ScheduleTriggerResult::Started,
            detail: None,
        };
        store.record_trigger(entry.clone())?;
        assert!(store.is_duplicate(&saved.id, 123)?);
        assert!(!store.is_duplicate(&saved.id, 124)?);
        store.delete(&saved.id)?;
        assert!(store.find(&saved.id)?.is_none());
        std::fs::remove_dir_all(dir).ok();
        Ok(())
    }

    #[test]
    fn wire_format_nests_the_trigger_for_the_frontend() {
        // The frontend models the trigger as a nested discriminated union
        // (`ScheduleRule.trigger.kind`); the IPC payload must round-trip
        // exactly that shape, with no `kind` leaking to the rule top level.
        let rule = fixed_rule();
        let json = serde_json::to_value(&rule).expect("serialize rule");
        assert!(json.get("trigger").is_some(), "trigger must be nested");
        assert!(json.get("kind").is_none(), "kind must stay inside trigger");

        let fixed_json = serde_json::json!({
            "id": "rule",
            "name": "Daily",
            "enabled": true,
            "runConfigurationId": "run",
            "trigger": {
                "kind": "fixedTime",
                "days": [1, 2, 3, 4, 5, 6, 7],
                "times": ["12:00"],
            },
        });
        let parsed: ScheduleRule =
            serde_json::from_value(fixed_json).expect("parse frontend fixedTime rule");
        match parsed.trigger {
            ScheduleTrigger::FixedTime { days, times } => {
                assert_eq!(days, vec![1, 2, 3, 4, 5, 6, 7]);
                assert_eq!(times, vec!["12:00".to_string()]);
            }
            ScheduleTrigger::Interval { .. } => panic!("unexpected trigger variant"),
        }

        let interval_json = serde_json::json!({
            "id": "rule-2",
            "runConfigurationId": "run",
            "trigger": {
                "kind": "interval",
                "startEpochMs": 1_000,
                "intervalDays": 1,
                "intervalHours": 0,
            },
        });
        let parsed: ScheduleRule =
            serde_json::from_value(interval_json).expect("parse frontend interval rule");
        assert!(matches!(parsed.trigger, ScheduleTrigger::Interval { .. }));
    }
}

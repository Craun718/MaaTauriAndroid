import type { MessageKey } from "./i18n";
import type { ScheduleRule, ScheduleTriggerResult } from "./types";

const RESULT_KEYS: Record<ScheduleTriggerResult, MessageKey> = {
  started: "scheduleResultStarted",
  duplicate: "scheduleResultDuplicate",
  rejectedActive: "scheduleResultRejectedActive",
  failedValidation: "scheduleResultFailedValidation",
  failedServiceStart: "scheduleResultFailedServiceStart",
  foregroundServiceDenied: "scheduleResultForegroundServiceDenied",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createScheduleRule(runConfigurationId: string): ScheduleRule {
  return {
    id: "",
    name: "",
    enabled: true,
    runConfigurationId,
    trigger: {
      kind: "fixedTime",
      days: [1, 2, 3, 4, 5, 6, 7],
      times: [],
    },
  };
}

export function scheduleRuleErrors(rule: ScheduleRule): string[] {
  const errors: string[] = [];
  if (!rule.name.trim()) errors.push("nameRequired");
  if (!rule.runConfigurationId) errors.push("runConfigurationRequired");
  if (rule.trigger.kind === "fixedTime") {
    if (!rule.trigger.days.length) errors.push("weekdayRequired");
    if (rule.trigger.days.some((day) => day < 1 || day > 7)) {
      errors.push("weekdayRequired");
    }
    if (!rule.trigger.times.length) errors.push("timeRequired");
    if (rule.trigger.times.some((time) => !TIME_PATTERN.test(time))) {
      errors.push("timeInvalid");
    }
  } else if (
    !Number.isFinite(rule.trigger.startEpochMs) ||
    rule.trigger.startEpochMs < 0 ||
    (rule.trigger.intervalDays <= 0 && rule.trigger.intervalHours <= 0)
  ) {
    errors.push("intervalInvalid");
  }
  return errors;
}

export function isScheduleRuleValid(rule: ScheduleRule): boolean {
  return scheduleRuleErrors(rule).length === 0;
}

export function scheduleTriggerResultKey(
  result: ScheduleTriggerResult,
): MessageKey {
  return RESULT_KEYS[result];
}

export function epochMsToDateTimeLocal(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateTimeLocalToEpochMs(value: string): number {
  const epochMs = new Date(value).getTime();
  return Number.isFinite(epochMs) ? epochMs : -1;
}

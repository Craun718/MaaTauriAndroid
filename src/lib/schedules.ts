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

export interface DateTimeParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31，随年月取值 */
  day: number;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
}

/** 指定年月的天数（month 为 1-12），自动处理闰年。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** epoch 毫秒 → 本地时区的年月日时分各分量。 */
export function epochMsToDateTimeParts(epochMs: number): DateTimeParts {
  const date = new Date(epochMs);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** 本地时区的年月日时分各分量 → epoch 毫秒；入参含非有限值时返回 -1。 */
export function dateTimePartsToEpochMs(parts: DateTimeParts): number {
  const epochMs = new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  ).getTime();
  return Number.isFinite(epochMs) ? epochMs : -1;
}

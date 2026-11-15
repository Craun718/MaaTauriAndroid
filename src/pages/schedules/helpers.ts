import type { MessageKey } from "../../lib/i18n";
import type { ScheduleRuleStatus } from "../../lib/types";

export const WEEKDAY_KEYS: MessageKey[] = [
  "scheduleWeekdayMonday",
  "scheduleWeekdayTuesday",
  "scheduleWeekdayWednesday",
  "scheduleWeekdayThursday",
  "scheduleWeekdayFriday",
  "scheduleWeekdaySaturday",
  "scheduleWeekdaySunday",
];

export const ERROR_KEYS: Record<string, MessageKey> = {
  nameRequired: "scheduleErrorNameRequired",
  runConfigurationRequired: "scheduleErrorRunConfigurationRequired",
  weekdayRequired: "scheduleErrorWeekdayRequired",
  timeRequired: "scheduleErrorTimeRequired",
  timeInvalid: "scheduleErrorTimeInvalid",
  intervalInvalid: "scheduleErrorIntervalInvalid",
};

export function currentTimeValue(date = new Date()): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export interface TimeEditorState {
  hour: number;
  minute: number;
  originalTime?: string;
}

export function timeValue({ hour, minute }: TimeEditorState): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function describeTrigger(
  rule: ScheduleRuleStatus,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
) {
  if (rule.trigger.kind === "interval") {
    const hours = rule.trigger.intervalDays * 24 + rule.trigger.intervalHours;
    return t("scheduleIntervalSummary", { hours });
  }
  return rule.trigger.times.join(", ");
}

export function nonNegative(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

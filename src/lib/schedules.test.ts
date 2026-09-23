import { describe, expect, it } from "vitest";
import {
  createScheduleRule,
  dateTimePartsToEpochMs,
  daysInMonth,
  epochMsToDateTimeParts,
  scheduleRuleErrors,
  scheduleTriggerResultKey,
} from "./schedules";
import type { ScheduleRule } from "./types";

describe("schedule rules", () => {
  it("rejects incomplete fixed-time rules", () => {
    const rule = createScheduleRule("");
    expect(scheduleRuleErrors(rule)).toContain("nameRequired");
    expect(scheduleRuleErrors(rule)).toContain("runConfigurationRequired");
    expect(scheduleRuleErrors(rule)).toContain("timeRequired");
  });

  it("accepts fixed and interval rules with valid values", () => {
    const fixed: ScheduleRule = {
      ...createScheduleRule("run"),
      name: "Daily",
      trigger: { kind: "fixedTime", days: [1], times: ["07:30"] },
    };
    expect(scheduleRuleErrors(fixed)).toEqual([]);

    const interval: ScheduleRule = {
      ...createScheduleRule("run"),
      name: "Every day",
      trigger: {
        kind: "interval",
        startEpochMs: 1767225600000,
        intervalDays: 1,
        intervalHours: 0,
      },
    };
    expect(scheduleRuleErrors(interval)).toEqual([]);
  });

  it("rejects zero intervals", () => {
    const rule: ScheduleRule = {
      ...createScheduleRule("run"),
      name: "Every hour",
      trigger: {
        kind: "interval",
        startEpochMs: 1767225600000,
        intervalDays: 0,
        intervalHours: 0,
      },
    };
    expect(scheduleRuleErrors(rule)).toContain("intervalInvalid");
  });

  it("round-trips local date-time parts and derives message keys", () => {
    const epochMs = new Date(2026, 0, 2, 3, 4).getTime();
    expect(epochMsToDateTimeParts(epochMs)).toEqual({
      year: 2026,
      month: 1,
      day: 2,
      hour: 3,
      minute: 4,
    });
    expect(
      dateTimePartsToEpochMs({
        year: 2026,
        month: 1,
        day: 2,
        hour: 3,
        minute: 4,
      }),
    ).toBe(epochMs);
    expect(scheduleTriggerResultKey("rejectedActive")).toBe(
      "scheduleResultRejectedActive",
    );
  });

  it("derives month lengths including leap years", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

import { describe, expect, it } from "vitest";
import {
  createScheduleRule,
  dateTimeLocalToEpochMs,
  epochMsToDateTimeLocal,
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

  it("rejects zero intervals and local time input", () => {
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
    expect(dateTimeLocalToEpochMs("not-a-date")).toBe(-1);
  });

  it("round-trips local input values and derives message keys", () => {
    const epochMs = Date.UTC(2026, 0, 2, 3, 4);
    const local = epochMsToDateTimeLocal(epochMs);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(scheduleTriggerResultKey("rejectedActive")).toBe(
      "scheduleResultRejectedActive",
    );
  });
});

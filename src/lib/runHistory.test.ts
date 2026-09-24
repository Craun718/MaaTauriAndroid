import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatDuration,
  runDurationMs,
  runEventCategory,
  runHistoryDateGroups,
  runOutcome,
  runTasks,
} from "./runHistory";
import type { RunEvent, RunEventKind } from "./types";

function event(
  kind: RunEventKind,
  atUnixMs: number,
  data?: Record<string, unknown>,
): RunEvent {
  return {
    executionId: "run-1",
    sequence: atUnixMs,
    atUnixMs,
    kind,
    state: "Running",
    message: "message",
    data,
  };
}

describe("runOutcome", () => {
  it("derives the outcome from the last terminal event", () => {
    expect(
      runOutcome([
        event("started", 1),
        event("completed", 2),
        event("failure", 3),
      ]),
    ).toBe("failed");
    expect(
      runOutcome([
        event("started", 1),
        event("failure", 2),
        event("completed", 3),
      ]),
    ).toBe("completed");
    expect(runOutcome([event("started", 1), event("cancelled", 2)])).toBe(
      "cancelled",
    );
  });

  it("reports interrupted runs without a terminal event", () => {
    expect(runOutcome([event("started", 1), event("task", 2)])).toBe(
      "interrupted",
    );
    expect(runOutcome([])).toBe("interrupted");
  });
});

describe("runTasks", () => {
  it("extracts the task snapshot from the Started event", () => {
    const events = [
      event("started", 1, { tasks: ["Daily", "Arena"] }),
      event("task", 2),
    ];
    expect(runTasks(events)).toEqual(["Daily", "Arena"]);
  });

  it("returns an empty list without a usable snapshot", () => {
    expect(runTasks([event("started", 1)])).toEqual([]);
    expect(runTasks([event("started", 1, { tasks: "nope" })])).toEqual([]);
    expect(runTasks([event("started", 1, { tasks: ["a", 3, null] })])).toEqual([
      "a",
    ]);
    expect(runTasks([])).toEqual([]);
  });
});

describe("runDurationMs", () => {
  it("spans the first to the last event", () => {
    expect(
      runDurationMs([event("started", 1_000), event("completed", 4_500)]),
    ).toBe(3_500);
  });

  it("is zero for empty or single-event runs", () => {
    expect(runDurationMs([])).toBe(0);
    expect(runDurationMs([event("started", 1_000)])).toBe(0);
  });
});

describe("runEventCategory", () => {
  it("maps kinds and agent source to categories", () => {
    expect(runEventCategory(event("started", 1))).toBe("status");
    expect(runEventCategory(event("task", 1))).toBe("task");
    expect(runEventCategory(event("focus", 1))).toBe("focus");
    expect(runEventCategory(event("task", 1, { source: "python-agent" }))).toBe(
      "agent",
    );
  });
});

describe("formatBytes", () => {
  it("scales to the largest fitting unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});

describe("formatDuration", () => {
  it("formats compact durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_600_000 + 65_000)).toBe("1:01:05");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("runHistoryDateGroups", () => {
  it("groups runs from the same local calendar day and keeps order", () => {
    const groups = runHistoryDateGroups(
      [
        entry("run-2", new Date(2026, 8, 25, 23, 0).getTime()),
        entry("run-1", new Date(2026, 8, 25, 1, 0).getTime()),
        entry("run-0", new Date(2026, 8, 24, 1, 0).getTime()),
      ],
      "en",
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe("2026-09-25");
    expect(groups[0].entries.map(({ executionId }) => executionId)).toEqual([
      "run-2",
      "run-1",
    ]);
    expect(groups[1].dateKey).toBe("2026-09-24");
    expect(groups[1].entries[0].executionId).toBe("run-0");
  });

  it("keeps invalid timestamps in their own group", () => {
    const groups = runHistoryDateGroups(
      [
        entry("run-1", Number.NaN),
        entry("run-0", new Date(2026, 8, 25).getTime()),
      ],
      "zh",
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].dateKey).toBe("");
    expect(groups[0].label).toBe("—");
    expect(groups[0].entries[0].executionId).toBe("run-1");
  });
});

function entry(executionId: string, startedAtUnixMs: number) {
  return {
    executionId,
    fileName: "run_20260925_000000_1.jsonl",
    startedAtUnixMs,
    sizeBytes: 0,
    taskCount: 1,
  };
}

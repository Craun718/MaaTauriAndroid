import { beforeEach, describe, expect, it } from "vitest";
import type { RunEvent, RunEventKind } from "../lib/types";
import {
  type RunEventLogEntry,
  type RunLogEntry,
  useRunLogStore,
} from "./runLogStore";

function runEntries(entries: RunLogEntry[]): RunEventLogEntry[] {
  return entries.filter(
    (entry): entry is RunEventLogEntry => entry.type === "run",
  );
}

function runEvent(
  executionId: string,
  sequence: number,
  kind: RunEventKind = "task",
): RunEvent {
  return {
    executionId,
    sequence,
    atUnixMs: sequence,
    kind,
    state: "Running",
    message: `event ${executionId} ${sequence}`,
  };
}

describe("runLogStore", () => {
  beforeEach(() => {
    useRunLogStore.setState({ entries: [], executionId: undefined });
  });

  it("keeps the log pinned to the first execution until a session reset", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 1));
    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 1));
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 2));

    expect(useRunLogStore.getState().executionId).toBe("run-1");
    expect(useRunLogStore.getState().entries).toHaveLength(2);
  });

  it("drops the previous session and accepts the next execution after reset", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 1));
    useRunLogStore.getState().resetRunLog();

    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 1));
    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 2));

    expect(useRunLogStore.getState().executionId).toBe("run-2");
    expect(
      runEntries(useRunLogStore.getState().entries).map(
        (entry) => entry.event.sequence,
      ),
    ).toEqual([1, 2]);
  });

  it("starts a fresh session when a new run begins preparing", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 1));

    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 1, "preparing"));
    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 2));

    expect(useRunLogStore.getState().executionId).toBe("run-2");
    expect(
      runEntries(useRunLogStore.getState().entries).map(
        (entry) => entry.event.executionId,
      ),
    ).toEqual(["run-2", "run-2"]);
  });

  it("deduplicates repeated run events", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 1));
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 1));

    expect(useRunLogStore.getState().entries).toHaveLength(1);
  });

  it("hydrates persisted events for the latest run", () => {
    useRunLogStore
      .getState()
      .hydrateRunEvents([
        runEvent("run-1", 1, "started"),
        runEvent("run-1", 2, "task"),
        runEvent("run-1", 3, "screenshot"),
      ]);

    expect(useRunLogStore.getState().executionId).toBe("run-1");
    expect(
      runEntries(useRunLogStore.getState().entries).map(
        (entry) => entry.event.sequence,
      ),
    ).toEqual([1, 2]);
  });

  it("merges history with live events that arrived first", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-1", 2));

    useRunLogStore
      .getState()
      .hydrateRunEvents([
        runEvent("run-1", 1, "started"),
        runEvent("run-1", 2, "task"),
        runEvent("run-1", 3, "task"),
      ]);

    expect(
      runEntries(useRunLogStore.getState().entries).map(
        (entry) => entry.event.sequence,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("ignores history for a different active execution", () => {
    useRunLogStore.getState().appendRunEvent(runEvent("run-2", 1, "preparing"));

    useRunLogStore.getState().hydrateRunEvents([runEvent("run-1", 1)]);

    expect(useRunLogStore.getState().executionId).toBe("run-2");
    expect(
      runEntries(useRunLogStore.getState().entries).map(
        (entry) => entry.event.executionId,
      ),
    ).toEqual(["run-2"]);
  });
});

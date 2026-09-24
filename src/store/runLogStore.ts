import { create } from "zustand";
import type { RunEvent } from "../lib/types";

export interface RunEventLogEntry {
  type: "run";
  event: RunEvent;
}

export interface NotificationLogEntry {
  type: "notification";
  id: string;
  atUnixMs: number;
  tone: "warning" | "error";
  message: string;
}

export type RunLogEntry = RunEventLogEntry | NotificationLogEntry;

interface RunLogStore {
  entries: RunLogEntry[];
  /** Execution the current log session is locked to. */
  executionId?: string;
  /** Changes when the user explicitly starts a new log session. */
  sessionEpoch: number;
  appendRunEvent: (event: RunEvent) => void;
  /** Restores the persisted events for one run into an empty live session. */
  hydrateRunEvents: (events: RunEvent[]) => void;
  /** Starts a fresh log session, dropping entries from the previous run. */
  resetRunLog: () => void;
  appendNotification: (
    entry: Omit<NotificationLogEntry, "type" | "id">,
  ) => void;
}

const maxRunLogEntries = 300;
let nextNotificationLogId = 1;

function runEventKey(event: RunEvent): string {
  return `${event.executionId}:${event.sequence}`;
}

function entryTime(entry: RunLogEntry): number {
  return entry.type === "run" ? entry.event.atUnixMs : entry.atUnixMs;
}

function mergeRunEvents(
  existing: RunLogEntry[],
  events: RunEvent[],
): RunLogEntry[] {
  const historical = events
    .filter((event) => event.kind !== "screenshot")
    .map((event) => ({ type: "run", event }) satisfies RunEventLogEntry);
  const historicalKeys = new Set(
    historical.map(({ event }) => runEventKey(event)),
  );
  const liveRunEntries = existing.filter(
    (entry): entry is RunEventLogEntry =>
      entry.type === "run" && !historicalKeys.has(runEventKey(entry.event)),
  );
  const otherLiveEntries = existing.filter((entry) => entry.type !== "run");
  return [...historical, ...liveRunEntries, ...otherLiveEntries]
    .sort((left, right) => entryTime(left) - entryTime(right))
    .slice(-maxRunLogEntries);
}

export const useRunLogStore = create<RunLogStore>((set) => ({
  entries: [],
  executionId: undefined,
  sessionEpoch: 0,
  appendRunEvent(event) {
    set((state) => {
      const differentExecution = state.executionId !== event.executionId;
      const opensSession =
        state.executionId === undefined ||
        (event.kind === "preparing" && differentExecution);
      if (differentExecution && !opensSession) {
        return state;
      }
      const baseEntries =
        event.kind === "preparing" && differentExecution ? [] : state.entries;
      const last = baseEntries.at(-1);
      if (
        last?.type === "run" &&
        last.event.executionId === event.executionId &&
        last.event.sequence === event.sequence
      ) {
        return state;
      }

      return {
        entries: [
          ...baseEntries,
          { type: "run", event } satisfies RunEventLogEntry,
        ].slice(-maxRunLogEntries),
        executionId: event.executionId,
      };
    });
  },
  hydrateRunEvents(events) {
    set((state) => {
      const first = events.find((event) => event.kind !== "screenshot");
      if (
        !first ||
        (state.executionId && state.executionId !== first.executionId)
      ) {
        return state;
      }
      return {
        entries: mergeRunEvents(state.entries, events),
        executionId: first.executionId,
      };
    });
  },
  resetRunLog() {
    set((state) => ({
      entries: [],
      executionId: undefined,
      sessionEpoch: state.sessionEpoch + 1,
    }));
  },
  appendNotification(entry) {
    const logEntry: NotificationLogEntry = {
      type: "notification",
      id: `notification-${nextNotificationLogId++}`,
      ...entry,
    };
    set((state) => ({
      entries: [...state.entries, logEntry].slice(-maxRunLogEntries),
    }));
  },
}));

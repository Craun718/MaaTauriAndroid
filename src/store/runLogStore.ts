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
  appendRunEvent: (event: RunEvent) => void;
  /** Starts a fresh log session, dropping entries from the previous run. */
  resetRunLog: () => void;
  appendNotification: (
    entry: Omit<NotificationLogEntry, "type" | "id">,
  ) => void;
}

const maxRunLogEntries = 300;
let nextNotificationLogId = 1;

export const useRunLogStore = create<RunLogStore>((set) => ({
  entries: [],
  executionId: undefined,
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
  resetRunLog() {
    set({ entries: [], executionId: undefined });
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

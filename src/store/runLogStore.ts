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
  appendRunEvent: (event: RunEvent) => void;
  appendNotification: (
    entry: Omit<NotificationLogEntry, "type" | "id">,
  ) => void;
}

const maxRunLogEntries = 300;
let nextNotificationLogId = 1;

export const useRunLogStore = create<RunLogStore>((set) => ({
  entries: [],
  appendRunEvent(event) {
    set((state) => {
      const last = state.entries.at(-1);
      if (
        last?.type === "run" &&
        last.event.executionId === event.executionId &&
        last.event.sequence === event.sequence
      ) {
        return state;
      }

      return {
        entries: [
          ...state.entries,
          { type: "run", event } satisfies RunEventLogEntry,
        ].slice(-maxRunLogEntries),
      };
    });
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

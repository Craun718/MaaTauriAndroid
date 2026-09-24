import type { RunEvent } from "./types";

/** Derived from the last terminal event; no terminal event means the
 * process died mid-run (killed, crash, battery), not a user stop. */
export type RunOutcome = "completed" | "cancelled" | "failed" | "interrupted";

export type RunEventCategory = "agent" | "focus" | "task" | "status";

const TERMINAL_KINDS: ReadonlyArray<RunEvent["kind"]> = [
  "completed",
  "cancelled",
  "failure",
];

export function runOutcome(events: RunEvent[]): RunOutcome {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const kind = events[index].kind;
    if (kind === "completed") return "completed";
    if (kind === "cancelled") return "cancelled";
    if (kind === "failure") return "failed";
  }
  return "interrupted";
}

/** Task-name snapshot carried by the Started event's `data.tasks`. */
export function runTasks(events: RunEvent[]): string[] {
  const started = events.find((event) => event.kind === "started");
  const tasks = started?.data?.tasks;
  return Array.isArray(tasks)
    ? tasks.filter((task): task is string => typeof task === "string")
    : [];
}

/** Last minus first event timestamp; 0 when there is nothing to compare. */
export function runDurationMs(events: RunEvent[]): number {
  const first = events.at(0);
  const last = events.at(-1);
  if (!first || !last) return 0;
  return Math.max(0, last.atUnixMs - first.atUnixMs);
}

export function runEventCategory(event: RunEvent): RunEventCategory {
  if (event.data?.source === "python-agent") return "agent";
  if (event.kind === "focus") return "focus";
  if (event.kind === "task") return "task";
  return "status";
}

export function isTerminalEvent(event: RunEvent): boolean {
  return TERMINAL_KINDS.includes(event.kind);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.floor(bytes))} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** `m:ss` (or `h:mm:ss` past an hour), matching the live log's compact style. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${tail}` : tail.replace(/^0/, "");
}

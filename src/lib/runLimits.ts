/** Longest limit the settings field accepts, in minutes (24 hours). */
export const MAX_RUN_DURATION_MINUTES = 1440;

/** Field text for a stored limit; empty means "no limit". */
export function formatRunLimitMinutes(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  return String(Math.round(seconds / 60));
}

export type RunLimitInput =
  | { kind: "unlimited" }
  | { kind: "minutes"; minutes: number }
  | { kind: "invalid" };

/** Parses the settings field: blank or `0` clears the limit, whole minutes up
 * to `MAX_RUN_DURATION_MINUTES` set it, anything else is rejected. */
export function parseRunLimitInput(input: string): RunLimitInput {
  const text = input.trim();
  if (text === "") return { kind: "unlimited" };
  if (!/^\d+$/.test(text)) return { kind: "invalid" };
  const minutes = Number(text);
  if (!Number.isSafeInteger(minutes) || minutes > MAX_RUN_DURATION_MINUTES) {
    return { kind: "invalid" };
  }
  return minutes === 0 ? { kind: "unlimited" } : { kind: "minutes", minutes };
}

/** Configuration value for a parsed field: seconds, `0` meaning no limit. */
export function runLimitSeconds(input: RunLimitInput): number {
  return input.kind === "minutes" ? input.minutes * 60 : 0;
}

import type { MessageKey } from "../../lib/i18n";
import type { RunEventCategory, RunOutcome } from "../../lib/runHistory";

export const OUTCOME_KEYS: Record<RunOutcome, MessageKey> = {
  completed: "runHistoryOutcomeCompleted",
  cancelled: "runHistoryOutcomeCancelled",
  failed: "runHistoryOutcomeFailed",
  interrupted: "runHistoryOutcomeInterrupted",
};

export const OUTCOME_TONES: Record<RunOutcome, string> = {
  completed: "border-accent/40 bg-accent/10 text-accent",
  cancelled: "border-warning/40 bg-warning/10 text-warning",
  interrupted: "border-warning/40 bg-warning/10 text-warning",
  failed: "border-error/40 bg-error/10 text-error",
};

export const CATEGORY_KEYS: Record<RunEventCategory, MessageKey> = {
  agent: "runLogAgent",
  focus: "runLogFocus",
  task: "runLogTask",
  status: "runLogStatus",
};

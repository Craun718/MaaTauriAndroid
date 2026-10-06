import { useCallback, useRef } from "react";
import { getPrivilegedStatus, requestPrivilegedAccess, startRun } from "./api";
import {
  canRequestPrivilegedAccess,
  isControlUnitStartingDiagnostic,
  isPermissionRequiredDiagnostic,
  runStartPermissionNotices,
} from "./i18n";
import type {
  PrivilegedStatus,
  StartRunStatus,
  TaskRunSelection,
} from "./types";

/** Notices and results of a start attempt; the messages double as run-log keys. */
interface RunStartRetryCallbacks {
  /** Called when an attempt starts and when it is rejected, so the caller can
   * tell a failure of this attempt from a failure of an accepted run. */
  onAttemptReset: () => void;
  onStarted: (result: StartRunStatus) => void;
  onNotice: (message: string) => void;
  onFailure: (error: unknown) => Promise<void> | void;
  /** How long to keep waiting for the control unit to come up. */
  readyTimeoutMs?: number;
  /** Delay between readiness polls; tests drive it down to zero. */
  readyPollIntervalMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 5_000;
const DEFAULT_READY_POLL_INTERVAL_MS = 150;

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPrivilegedStatus(): Promise<PrivilegedStatus | undefined> {
  // A synchronous mock, or a backend that answers immediately, must not break
  // the awaited chain.
  return Promise.resolve(getPrivilegedStatus()).catch(() => undefined);
}

/**
 * Starts a run and recovers automatically from a privileged control unit that
 * is not usable yet:
 *
 * - still coming up (the backend reports it "starting"): wait for it to
 *   connect and start again, instead of asking the user to retry by hand;
 * - not authorized: ask for the grant once, then start again.
 *
 * Either recovery is spent once per start click, so a second rejection (the
 * control unit stayed down, a denied prompt, or a grant that does not fix the
 * run) is reported instead of looping. The backend never prompts on its own,
 * and states a wait or a prompt cannot fix — Shizuku missing, the service
 * disconnected, the service rejecting the display — keep their own error.
 *
 * A rejected start can also reach the UI only as a run event, in which case the
 * failure listener calls `retryAfterRunFailure` with the raw backend message;
 * both entry points share the single recovery budget.
 */
export function useRunStartRetry({
  onAttemptReset,
  onStarted,
  onNotice,
  onFailure,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyPollIntervalMs = DEFAULT_READY_POLL_INTERVAL_MS,
}: RunStartRetryCallbacks): {
  startRunWithAccess: (selection?: TaskRunSelection) => Promise<void>;
  retryAfterRunFailure: (message: string) => Promise<void>;
  resetRetry: () => void;
} {
  const retriedRef = useRef(false);
  const pendingSelection = useRef<TaskRunSelection | undefined>(undefined);
  const latest = useRef<RunStartRetryCallbacks>({
    onAttemptReset,
    onStarted,
    onNotice,
    onFailure,
  });
  latest.current = { onAttemptReset, onStarted, onNotice, onFailure };

  /**
   * Waits for a control unit that is still starting to connect. Called only
   * once per click, right after the rejection that asked for it.
   */
  const waitForControlUnit = useCallback(async () => {
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      await delay(readyPollIntervalMs);
      const status = await readPrivilegedStatus();
      if (status && status.status !== "starting") return;
      if (Date.now() >= deadline) return;
    }
  }, [readyPollIntervalMs, readyTimeoutMs]);

  /**
   * Runs the start, waiting for the control unit and asking for the missing
   * grant at most once before trying again. `alreadyReported` says the caller
   * (the run-event listener) already alerted the rejection that bought this
   * recovery, so the first failure below is not alerted again.
   */
  const performStart = useCallback(
    async (
      selection: TaskRunSelection | undefined,
      alreadyReported = false,
    ) => {
      // Once this loop has bought its recovery, a rejection after the retry is
      // the outcome and is reported rather than recovered from again.
      let retried = false;
      for (;;) {
        latest.current.onAttemptReset();
        try {
          const result = await startRun(selection);
          retriedRef.current = false;
          latest.current.onStarted(result);
          return;
        } catch (error) {
          latest.current.onAttemptReset();
          if (retried) {
            await latest.current.onFailure(error);
            return;
          }
          // The listener owns this rejection's alert; recovering is all that is
          // left here. That path only ever carries a recovery-worthy message.
          const report = !alreadyReported;
          alreadyReported = false;
          const raw = rawMessage(error);
          if (isControlUnitStartingDiagnostic(raw)) {
            retried = true;
            retriedRef.current = true;
            await waitForControlUnit();
            continue;
          }
          if (isPermissionRequiredDiagnostic(raw)) {
            const status = await readPrivilegedStatus();
            // A grant can only be requested while the control unit reports a
            // missing permission; anything else would prompt for nothing.
            if (status && canRequestPrivilegedAccess(status)) {
              retried = true;
              retriedRef.current = true;
              latest.current.onNotice(runStartPermissionNotices.requesting);
              try {
                await requestPrivilegedAccess();
              } catch (requestError) {
                // The prompt failure is what the user needs to act on, and the
                // original rejection only adds why the run did not start.
                latest.current.onNotice(runStartPermissionNotices.failed);
                await latest.current.onFailure(requestError);
                await latest.current.onFailure(error);
                return;
              }
              latest.current.onNotice(runStartPermissionNotices.succeeded);
              continue;
            }
          }
          if (report) await latest.current.onFailure(error);
          return;
        }
      }
    },
    [waitForControlUnit],
  );

  const startRunWithAccess = useCallback(
    async (selection?: TaskRunSelection) => {
      pendingSelection.current = selection;
      await performStart(selection);
    },
    [performStart],
  );

  const retryAfterRunFailure = useCallback(
    async (message: string) => {
      // An asynchronously rejected start may surface only as a run event. Wait
      // or ask for the control unit here too, but never for a failure that
      // already spent the recovery, and never for a diagnostic neither fixes.
      if (
        retriedRef.current ||
        !(
          isPermissionRequiredDiagnostic(message) ||
          isControlUnitStartingDiagnostic(message)
        )
      ) {
        return;
      }
      await performStart(pendingSelection.current, true);
    },
    [performStart],
  );

  const resetRetry = useCallback(() => {
    retriedRef.current = false;
    pendingSelection.current = undefined;
  }, []);

  return { startRunWithAccess, retryAfterRunFailure, resetRetry };
}

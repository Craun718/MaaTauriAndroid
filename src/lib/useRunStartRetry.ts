import { useCallback, useRef } from "react";
import { getPrivilegedStatus, requestPrivilegedAccess, startRun } from "./api";
import {
  canRequestPrivilegedAccess,
  isPermissionRequiredDiagnostic,
  runStartPermissionNotices,
} from "./i18n";
import type { StartRunStatus } from "./types";

/** Notices and results of a start attempt; the messages double as run-log keys. */
interface RunStartRetryCallbacks {
  /** Called when an attempt starts and when it is rejected, so the caller can
   * tell a failure of this attempt from a failure of an accepted run. */
  onAttemptReset: () => void;
  onStarted: (result: StartRunStatus) => void;
  onNotice: (message: string) => void;
  onFailure: (error: unknown) => Promise<void> | void;
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a run and recovers once from a missing privileged grant: a start
 * rejected with the Shizuku "not granted" diagnostic asks for privileged
 * access and then starts again. The prompt and its retry are spent once per
 * start click, so a second rejection (a denied prompt, or a grant that does not
 * fix the run) is reported instead of prompting again. The backend never
 * prompts on its own, and only the missing grant can be advanced by asking: an
 * uninstalled, disconnected, or failed control unit keeps its own error.
 *
 * A rejected start can also reach the UI only as a run event, in which case the
 * failure listener calls `retryAfterRunFailure` with the raw backend message;
 * both entry points share the single prompt budget.
 */
export function useRunStartRetry({
  onAttemptReset,
  onStarted,
  onNotice,
  onFailure,
}: RunStartRetryCallbacks): {
  startRunWithAccess: () => Promise<void>;
  retryAfterRunFailure: (message: string) => Promise<void>;
  resetRetry: () => void;
} {
  const askedRef = useRef(false);
  const latest = useRef<RunStartRetryCallbacks>({
    onAttemptReset,
    onStarted,
    onNotice,
    onFailure,
  });
  latest.current = { onAttemptReset, onStarted, onNotice, onFailure };

  /**
   * Runs the start, asking for the missing grant once and starting again after
   * it is granted. `alreadyReported` says the caller (the run-event listener)
   * already alerted the rejection that bought this retry, so the first failure
   * below is not alerted again.
   */
  const performStart = useCallback(async (alreadyReported = false) => {
    // A rejection that follows the prompt is the outcome of the retry, not a
    // new missing grant, so it is reported instead of prompting again.
    let promptedHere = false;
    for (;;) {
      latest.current.onAttemptReset();
      try {
        const result = await startRun();
        askedRef.current = false;
        latest.current.onStarted(result);
        return;
      } catch (error) {
        latest.current.onAttemptReset();
        if (promptedHere) {
          await latest.current.onFailure(error);
          return;
        }
        if (alreadyReported) {
          // The listener owns this rejection's alert; asking and retrying is
          // all that is left here. `performStart` is only reached on the
          // event path for the missing-grant diagnostic.
          alreadyReported = false;
        } else if (!isPermissionRequiredDiagnostic(rawMessage(error))) {
          await latest.current.onFailure(error);
          return;
        }
        const status = await Promise.resolve(getPrivilegedStatus()).catch(
          () => undefined,
        );
        // A grant can only be requested while the control unit reports a
        // missing permission; anything else would prompt for nothing.
        if (!status || !canRequestPrivilegedAccess(status)) {
          await latest.current.onFailure(error);
          return;
        }
        // Spend the one prompt this click gets before asking, so the retry
        // below cannot prompt again.
        promptedHere = true;
        askedRef.current = true;
        latest.current.onNotice(runStartPermissionNotices.requesting);
        try {
          await requestPrivilegedAccess();
        } catch (requestError) {
          // The prompt failure is what the user needs to act on, and the
          // original rejection only adds the reason the run did not start.
          latest.current.onNotice(runStartPermissionNotices.failed);
          await latest.current.onFailure(requestError);
          await latest.current.onFailure(error);
          return;
        }
        latest.current.onNotice(runStartPermissionNotices.succeeded);
      }
    }
  }, []);

  const startRunWithAccess = useCallback(async () => {
    await performStart();
  }, [performStart]);

  const retryAfterRunFailure = useCallback(
    async (message: string) => {
      // An asynchronously rejected start may surface only as a run event. Ask
      // for the grant here too, but never for a failure that already spent the
      // prompt, and never for a diagnostic a prompt cannot fix.
      if (askedRef.current || !isPermissionRequiredDiagnostic(message)) {
        return;
      }
      await performStart(true);
    },
    [performStart],
  );

  const resetRetry = useCallback(() => {
    askedRef.current = false;
  }, []);

  return { startRunWithAccess, retryAfterRunFailure, resetRetry };
}

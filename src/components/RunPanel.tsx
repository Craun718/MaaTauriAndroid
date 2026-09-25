import { listen } from "@tauri-apps/api/event";
import {
  Camera,
  Download,
  MoreVertical,
  Play,
  Square,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureManualScreenshot,
  getRunStatus,
  pressVirtualDisplayBack,
  requestNotificationPermission,
  resolveCurrent,
  startRun,
  stopRun,
} from "../lib/api";
import {
  localizeDiagnostic,
  localizeRunEvent,
  useTranslation,
} from "../lib/i18n";
import { canAcceptRunEvent } from "../lib/runEvents";
import type { ResolvedRun, RunEvent } from "../lib/types";
import { useLogExport } from "../lib/useLogExport";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { BottomDrawer } from "./ui/BottomDrawer";

/**
 * Run controls for the active run configuration. Rendered inside the Tasks panel
 * rather than on a page of its own: the queue it drives is the task list below it,
 * and keeping them apart meant showing the same tasks twice. The individual
 * actions live in a bottom drawer opened by the standalone "task actions" button.
 */
export function RunPanel({
  onRunStarted,
  onRunActiveChange,
}: {
  onRunStarted?: () => void;
  /** Reports whether a run is active (`Preparing` / `Running` / `Stopping`). */
  onRunActiveChange?: (active: boolean) => void;
}) {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const saving = useAppStore((state) => state.saving);
  const { t, language } = useTranslation();
  const [run, setRun] = useState<ResolvedRun>();
  const [status, setStatus] = useState<string>();
  const [executionId, setExecutionId] = useState<string>();
  const [runState, setRunState] = useState("Idle");
  const [starting, setStarting] = useState(false);
  const executionIdRef = useRef<string | undefined>(undefined);
  const projectRoot = snapshot?.project?.root;
  const { exportLogs, exporting } = useLogExport();
  const [capturing, setCapturing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const notify = useNotificationStore((state) => state.notify);
  const notifyOnce = useNotificationStore((state) => state.notifyOnce);
  const reportError = useCallback(
    (error: unknown) => {
      notify(
        localizeDiagnostic(
          error instanceof Error ? error.message : String(error),
          language,
        ),
        { tone: "error" },
      );
    },
    [notify, language],
  );

  const pressBack = useCallback(async () => {
    try {
      await pressVirtualDisplayBack();
    } catch (error) {
      reportError(error);
    }
  }, [reportError]);

  // A preparing failure reaches the UI twice: the backend emits the failure
  // run-event before `startRun` rejects, so the catch below and the listener
  // would both alert. When the run result already carries this exact failure,
  // share the listener's execution-scoped key so only one alert shows;
  // failures recorded nowhere else keep the direct report. Deduplication
  // compares the raw backend text while the alert shows the localized one.
  const reportStartFailure = useCallback(
    async (error: unknown) => {
      const raw = error instanceof Error ? error.message : String(error);
      const result = await getRunStatus().catch(() => undefined);
      if (
        result?.executionId &&
        result.severity === "error" &&
        result.message === raw
      ) {
        notifyOnce(
          `run-failure:${result.executionId}`,
          localizeDiagnostic(raw, language),
          {
            tone: "error",
            logToActivity: false,
          },
        );
        return;
      }
      notify(localizeDiagnostic(raw, language), { tone: "error" });
    },
    [notify, notifyOnce, language],
  );

  useEffect(() => {
    if (!snapshot) return;
    resolveCurrent().then(setRun).catch(reportError);
  }, [snapshot, reportError]);

  // Restoring the latest error is a mount-time recovery path. Sharing the
  // execution-scoped notification key with live failures prevents route
  // changes from replaying an old result as a second alert.
  useEffect(() => {
    if (!projectRoot) return;
    getRunStatus()
      .then((result) => {
        if (!result.executionId) return;
        executionIdRef.current = result.executionId;
        setExecutionId(result.executionId);
        setRunState(result.state);
        if (result.severity === "error") {
          notifyOnce(
            `run-failure:${result.executionId}`,
            localizeDiagnostic(result.message, language),
            {
              tone: "error",
            },
          );
          setStatus(undefined);
          return;
        }
        setStatus(result.message);
      })
      .catch(() => undefined);
  }, [projectRoot, notifyOnce, language]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen<RunEvent>("run-event", (event) => {
      const payload = event.payload;
      if (!canAcceptRunEvent(executionIdRef.current, event.payload.executionId))
        return;
      executionIdRef.current = payload.executionId;
      if (payload.state) setRunState(payload.state);
      setExecutionId(payload.executionId);
      if (payload.kind === "screenshot") return;
      if (payload.kind === "failure" || payload.kind === "warning") {
        const diagnostic = localizeRunEvent(payload, language);
        const message = payload.taskName
          ? `${payload.taskName}: ${diagnostic}`
          : diagnostic;
        if (payload.kind === "failure") {
          notifyOnce(`run-failure:${payload.executionId}`, message, {
            tone: "error",
            logToActivity: false,
          });
        } else {
          notify(message, {
            tone: "warning",
            logToActivity: false,
          });
        }
        setStatus(undefined);
        return;
      }
      setStatus(undefined);
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(reportError);

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [notify, notifyOnce, reportError, language]);

  const running = Boolean(executionId) && runState !== "Idle";

  useEffect(() => {
    onRunActiveChange?.(running);
  }, [running, onRunActiveChange]);

  if (!snapshot?.project) return null;
  const enabled =
    run?.tasks.filter((task) => task.enabled && !task.unavailableReason) ?? [];
  const startUnavailable =
    !running && (enabled.length === 0 || busy || saving || starting);

  async function start() {
    onRunStarted?.();
    setStarting(true);
    try {
      // Once-per-install OS prompt (no-op once granted): backend focus
      // `display: "notification"` messages only reach the OS notification
      // center with POST_NOTIFICATIONS granted.
      void requestNotificationPermission();
      const result = await startRun();
      executionIdRef.current = result.executionId;
      setExecutionId(result.executionId);
      // The first run-event may trail the invoke response, so the task list
      // locks as soon as the backend has accepted the run.
      setRunState("Preparing");
      notify(result.message);
    } catch (error) {
      await reportStartFailure(error);
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    try {
      notify(await stopRun(executionIdRef.current ?? executionId));
    } catch (error) {
      reportError(error);
    }
  }

  async function captureScreenshot() {
    setCapturing(true);
    try {
      await captureManualScreenshot(executionIdRef.current ?? executionId);
      notify(t("screenshotSavedNotice"));
    } catch (error) {
      reportError(error);
    } finally {
      setCapturing(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            aria-disabled={startUnavailable}
            onClick={() => {
              if (running) void stop();
              else if (busy || saving || starting)
                notify(t("startUnavailableNotice"));
              else if (enabled.length === 0) notify(t("noRunnableTasksNotice"));
              else void start();
            }}
            className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-line text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {running ? <Square size="1rem" /> : <Play size="1rem" />}
            {t(running ? "stopRun" : "startRun")}
          </button>
          <button
            type="button"
            aria-label={t("taskOperations")}
            className="flex h-9 w-9 flex-none cursor-pointer items-center justify-center rounded-md border border-line text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => setActionsOpen(true)}
          >
            <MoreVertical size="1rem" />
          </button>
        </div>
        {status && <p className="break-all text-sm text-ink-muted">{status}</p>}
      </div>
      <BottomDrawer
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={t("taskOperations")}
      >
        <button
          type="button"
          disabled={exporting}
          onClick={() => {
            setActionsOpen(false);
            void exportLogs();
          }}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Download size="1rem" />
          {exporting ? t("exportingLogs") : t("exportLogs")}
        </button>
        <button
          type="button"
          disabled={!executionId || capturing}
          onClick={() => {
            setActionsOpen(false);
            void captureScreenshot();
          }}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Camera size="1rem" />
          {t("captureScreenshot")}
        </button>
        <button
          type="button"
          onClick={() => {
            setActionsOpen(false);
            void pressBack();
          }}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <Undo2 size="1rem" />
          {t("back")}
        </button>
      </BottomDrawer>
    </>
  );
}

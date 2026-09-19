import { listen } from "@tauri-apps/api/event";
import { Camera, ChevronDown, Download, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureManualScreenshot,
  getRunStatus,
  resolveCurrent,
  startRun,
  stopRun,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { canAcceptRunEvent } from "../lib/runEvents";
import type { ResolvedRun, RunEvent } from "../lib/types";
import { useLogExport } from "../lib/useLogExport";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";

/**
 * Run controls for the active run configuration. Rendered inside the Tasks panel
 * rather than on a page of its own: the queue it drives is the task list below it,
 * and keeping them apart meant showing the same tasks twice.
 */
export function RunPanel({ onRunStarted }: { onRunStarted?: () => void }) {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const { t } = useTranslation();
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
  const actionsRef = useRef<HTMLDivElement>(null);
  const notify = useNotificationStore((state) => state.notify);
  const reportError = useCallback(
    (error: unknown) => {
      notify(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    },
    [notify],
  );

  useEffect(() => {
    if (!snapshot) return;
    resolveCurrent().then(setRun).catch(reportError);
  }, [snapshot, reportError]);

  // Restoring the latest error is a mount-time recovery path. Re-running it on
  // every configuration save would resurface an old failure whenever a task
  // checkbox changes.
  useEffect(() => {
    if (!projectRoot) return;
    getRunStatus()
      .then((result) => {
        if (!result.executionId) return;
        executionIdRef.current = result.executionId;
        setExecutionId(result.executionId);
        setRunState(result.state);
        if (result.severity === "error") {
          notify(result.message, { tone: "error" });
          setStatus(undefined);
          return;
        }
        setStatus(result.message);
      })
      .catch(() => undefined);
  }, [projectRoot, notify]);

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
        notify(
          payload.taskName
            ? `${payload.taskName}: ${payload.message}`
            : payload.message,
          {
            tone: payload.kind === "failure" ? "error" : "warning",
            logToActivity: false,
          },
        );
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
  }, [notify, reportError]);

  useEffect(() => {
    if (!actionsOpen) return;

    function closeActions(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActionsOpen(false);
    }

    document.addEventListener("pointerdown", closeActions);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeActions);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsOpen]);

  if (!snapshot?.project) return null;
  const enabled =
    run?.tasks.filter((task) => task.enabled && !task.unavailableReason) ?? [];
  const running = Boolean(executionId) && runState !== "Idle";

  async function start() {
    onRunStarted?.();
    setStarting(true);
    try {
      const result = await startRun();
      executionIdRef.current = result.executionId;
      setExecutionId(result.executionId);
      notify(result.message);
    } catch (error) {
      reportError(error);
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
      <section className="rounded-lg border border-line bg-raised p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {t("tasksReady", { count: enabled.length })}
          </h2>
          <div ref={actionsRef} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={actionsOpen}
              aria-haspopup="menu"
              onClick={() => setActionsOpen((value) => !value)}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {t("taskOperations")}
              <ChevronDown
                size={14}
                className={`text-ink-muted transition-transform ${
                  actionsOpen ? "" : "-rotate-90"
                }`}
              />
            </button>
            {actionsOpen && (
              <div
                role="menu"
                aria-label={t("taskOperations")}
                className="absolute top-10 right-0 z-30 w-40 rounded-lg border border-line bg-raised p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    (running ? false : enabled.length === 0) || busy || starting
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    if (running) void stop();
                    else void start();
                  }}
                  className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  {running ? <Square size={16} /> : <Play size={16} />}
                  {t(running ? "stop" : "start")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={exporting}
                  onClick={() => {
                    setActionsOpen(false);
                    void exportLogs();
                  }}
                  className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Download size={16} />
                  {exporting ? t("exportingLogs") : t("exportLogs")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!executionId || capturing}
                  onClick={() => {
                    setActionsOpen(false);
                    void captureScreenshot();
                  }}
                  className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Camera size={16} />
                  {t("captureScreenshot")}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
      {status && <p className="break-all text-sm text-ink-muted">{status}</p>}
    </>
  );
}

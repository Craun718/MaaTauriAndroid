import { listen } from "@tauri-apps/api/event";
import { Camera, Download, Play, Square } from "lucide-react";
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
  const { exportLogs, exporting } = useLogExport();
  const [capturing, setCapturing] = useState(false);
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
  }, [snapshot, notify, reportError]);

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
          { tone: payload.kind === "failure" ? "error" : "warning" },
        );
        setStatus(undefined);
        return;
      }
      if (payload.taskName) {
        setStatus(`${payload.taskName}: ${payload.message}`);
      } else {
        setStatus(payload.message);
      }
      if (payload.data && typeof payload.data === "object") {
        const data = event.payload.data as Partial<{
          partialReasons: string[];
        }>;
        if (
          Array.isArray(data.partialReasons) &&
          data.partialReasons.length > 0
        ) {
          setStatus(
            `${event.payload.message} (${data.partialReasons.join("; ")})`,
          );
        }
      }
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
        <h2 className="text-xl font-semibold">
          {t("tasksReady", { count: enabled.length })}
        </h2>
        <button
          type="button"
          disabled={
            (running ? false : enabled.length === 0) || busy || starting
          }
          onClick={running ? stop : () => void start()}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent font-semibold text-white disabled:opacity-50"
        >
          {running ? <Square size={16} /> : <Play size={16} />}
          {t(running ? "stop" : "start")}
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => {
              void exportLogs();
            }}
            className="flex h-11 items-center justify-center gap-2 rounded-md border border-line font-semibold disabled:opacity-50"
          >
            <Download size={16} />
            {exporting ? t("exportingLogs") : t("exportLogs")}
          </button>
          <button
            type="button"
            disabled={!executionId || capturing}
            onClick={captureScreenshot}
            className="flex h-11 items-center justify-center gap-2 rounded-md border border-line font-semibold disabled:opacity-50"
          >
            <Camera size={16} />
            {t("captureScreenshot")}
          </button>
        </div>
      </section>
      {/* Rust reports absolute paths back; without break-all a long one widens the
          page and the fixed bottom nav drifts sideways when the page is panned. */}
      {status && <p className="break-all text-sm text-ink-muted">{status}</p>}
    </>
  );
}

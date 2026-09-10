import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, Play, Square } from "lucide-react";
import { exportDiagnostics, getRunStatus, resolveCurrent, startRun, stopRun } from "../lib/api";
import { EmptyProject } from "./SetupPage";
import { useAppStore } from "../store/appStore";
import type { DiagnosticExport, ResolvedRun, RunEvent } from "../lib/types";
import { canAcceptRunEvent } from "../lib/runEvents";

export function RunPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const [run, setRun] = useState<ResolvedRun>();
  const [status, setStatus] = useState<string>();
  const [executionId, setExecutionId] = useState<string>();
  const [runState, setRunState] = useState("Idle");
  const [diagnostic, setDiagnostic] = useState<DiagnosticExport>();
  const executionIdRef = useRef<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
      resolveCurrent()
      .then(setRun)
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
    getRunStatus()
      .then((result) => {
        if (!result.executionId) return;
        executionIdRef.current = result.executionId;
        setExecutionId(result.executionId);
        setRunState(result.state);
      })
      .catch(() => undefined);
  }, [snapshot]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen<RunEvent>("run-event", (event) => {
      if (!canAcceptRunEvent(executionIdRef.current, event.payload.executionId)) return;
      executionIdRef.current = event.payload.executionId;
      if (event.payload.state) setRunState(event.payload.state);
      setExecutionId(event.payload.executionId);
      if (event.payload.taskName) {
        setStatus(`${event.payload.taskName}: ${event.payload.message}`);
      } else {
        setStatus(event.payload.message);
      }
      if (event.payload.data && typeof event.payload.data === "object") {
        const data = event.payload.data as Partial<DiagnosticExport["manifest"]>;
        if (Array.isArray(data.partialReasons) && data.partialReasons.length > 0) {
          setStatus(`${event.payload.message} (${data.partialReasons.join("; ")})`);
        }
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  if (!snapshot?.project) return <EmptyProject />;
  const enabled = run?.tasks.filter((task) => task.enabled && !task.unavailableReason) ?? [];

  async function start() {
    try {
      const result = await startRun();
      executionIdRef.current = result.executionId;
      setExecutionId(result.executionId);
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function stop() {
    try {
      setStatus(await stopRun(executionId));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportBundle() {
    const confirmed = window.confirm(
      "Export a full diagnostic package? It includes screenshots, device logs and a complete bug report.",
    );
    if (!confirmed) return;
    setExporting(true);
    try {
      const result = await exportDiagnostics(executionId);
      setDiagnostic(result);
      setStatus(
        result.manifest.status === "complete"
          ? `Diagnostics exported: ${result.path}`
          : `Diagnostics exported with gaps: ${result.manifest.partialReasons.join("; ")}`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Run</h1>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <p className="text-sm text-[var(--text-muted)]">{run?.resource.label ?? "Resource"}</p>
        <h2 className="mt-1 text-xl font-semibold">{enabled.length} tasks ready</h2>
        <button
          type="button"
          disabled={enabled.length === 0 || busy}
          onClick={start}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] font-semibold text-white disabled:opacity-50"
        >
          <Play size={18} />
          Start
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!executionId || runState === "Idle"}
            onClick={stop}
            className="flex h-12 items-center justify-center gap-2 rounded-md border border-[var(--border)] font-semibold disabled:opacity-50"
          >
            <Square size={18} />
            Stop
          </button>
          <button
            type="button"
            disabled={!executionId || exporting}
            onClick={exportBundle}
            className="flex h-12 items-center justify-center gap-2 rounded-md border border-[var(--border)] font-semibold disabled:opacity-50"
          >
            <Download size={18} />
            Export
          </button>
        </div>
      </section>
      {diagnostic && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-sm">
          <p className="font-medium">Diagnostics: {diagnostic.manifest.status}</p>
          <p className="mt-1 break-all text-[var(--text-muted)]">{diagnostic.path}</p>
        </section>
      )}
      {status && <p className="text-sm text-[var(--text-muted)]">{status}</p>}
      <section className="space-y-2">
        <h2 className="font-medium">Queue</h2>
        {run?.tasks.map((item) => (
          <div
            key={item.configured?.instanceId ?? item.task.name}
            className="flex min-h-12 items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3"
          >
            <span>{item.task.label}</span>
            <span className="text-sm text-[var(--text-muted)]">
              {item.unavailableReason ?? (item.enabled ? "Enabled" : "Disabled")}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

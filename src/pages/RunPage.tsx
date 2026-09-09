import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { resolveCurrent, startRun } from "../lib/api";
import { EmptyProject } from "./SetupPage";
import { useAppStore } from "../store/appStore";
import type { ResolvedRun } from "../lib/types";

export function RunPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const [run, setRun] = useState<ResolvedRun>();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    if (!snapshot) return;
    resolveCurrent()
      .then(setRun)
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [snapshot]);

  if (!snapshot?.project) return <EmptyProject />;
  const enabled = run?.tasks.filter((task) => task.enabled && !task.unavailableReason) ?? [];

  async function start() {
    try {
      const result = await startRun();
      setStatus(result.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
      </section>
      {status && <p className="text-sm text-[var(--text-muted)]">{status}</p>}
      <section className="space-y-2">
        <h2 className="font-medium">Queue</h2>
        {run?.tasks.map((item) => (
          <div
            key={item.task.name}
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

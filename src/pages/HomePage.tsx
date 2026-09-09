import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw, ShieldAlert } from "lucide-react";
import { getPrivilegedStatus, resolveCurrent } from "../lib/api";
import type { ResolvedRun } from "../lib/types";
import { activeRun, configuredTask } from "../lib/options";
import { useAppStore } from "../store/appStore";

export function HomePage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const [run, setRun] = useState<ResolvedRun>();
  const [privileged, setPrivileged] = useState<string>();
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      const [nextRun, status] = await Promise.all([resolveCurrent(), getPrivilegedStatus()]);
      setRun(nextRun);
      setPrivileged(status.message);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, [snapshot]);

  if (!snapshot?.project) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Project</h1>
        <p className="text-[var(--text-muted)]">No project is loaded.</p>
      </div>
    );
  }

  const { project, configuration } = snapshot;
  const runConfig = activeRun(configuration);
  const enabled = project.tasks.filter((task) => configuredTask(configuration, task).enabled);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-[var(--text-muted)]">{project.version ?? "PI v2"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{project.label}</h1>
      </header>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Current selection</h2>
          <button
            type="button"
            onClick={refresh}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)]"
            aria-label="Refresh status"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[var(--text-muted)]">Controller</dt>
            <dd>{run?.controller.label ?? configuration.activeController}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Resource</dt>
            <dd>{run?.resource.label ?? configuration.activeResource}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Preset</dt>
            <dd>{runConfig?.name ?? "Default"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">Enabled</dt>
            <dd>{enabled.length} tasks</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-500" />
          <h2 className="font-medium">Privileged host</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{privileged ?? "Checking"}</p>
      </section>

      {error && (
        <section className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          <CircleAlert size={18} />
          <span>{error}</span>
        </section>
      )}
      {busy && <p className="text-sm text-[var(--text-muted)]">Saving</p>}
    </div>
  );
}

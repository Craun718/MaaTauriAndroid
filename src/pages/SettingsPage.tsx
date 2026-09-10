import { useEffect, useState } from "react";
import { CircleAlert, FolderInput, Trash2 } from "lucide-react";
import { clearDiagnosticData, getPrivilegedStatus } from "../lib/api";
import { useAppStore } from "../store/appStore";

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const load = useAppStore((state) => state.loadProject);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const busy = useAppStore((state) => state.busy);
  const [path, setPath] = useState(snapshot?.projectPath ?? "");
  const [status, setStatus] = useState<string>();
  const [cleanupStatus, setCleanupStatus] = useState<string>();
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    getPrivilegedStatus()
      .then((result) => setStatus(result.message))
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h2 className="font-medium">Project directory</h2>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/storage/emulated/0/TTFlow"
            className="h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] px-3"
          />
          <button
            type="button"
            disabled={!path || busy}
            onClick={() => void load(path, "zh_cn")}
            className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--accent)] text-white disabled:opacity-50"
            aria-label="Load project"
          >
            <FolderInput size={18} />
          </button>
        </div>
        {snapshot?.project && (
          <p className="text-sm text-[var(--text-muted)]">
            {snapshot.project.name} {snapshot.project.version ?? ""}
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h2 className="font-medium">Run behavior</h2>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            checked={snapshot?.configuration.forceStopTargetApp ?? false}
            disabled={busy || !snapshot}
            onChange={(event) => {
              if (!snapshot) return;
              const next = structuredClone(snapshot.configuration);
              next.forceStopTargetApp = event.target.checked;
              void saveConfiguration(next);
            }}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          <span className="font-medium">Force stop target app</span>
        </label>
      </section>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h2 className="font-medium">Diagnostics</h2>
        <button
          type="button"
          disabled={busy || cleaning || !snapshot}
          onClick={async () => {
            const confirmed = window.confirm(
              "Delete all stored run directories? Diagnostic exports inside them will also be removed.",
            );
            if (!confirmed) return;
            setCleaning(true);
            setCleanupStatus(undefined);
            try {
              const result = await clearDiagnosticData();
              setCleanupStatus(`Deleted ${result.deletedRunCount} run directories`);
            } catch (error) {
              setCleanupStatus(
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              setCleaning(false);
            }
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-md border border-red-300 font-semibold text-red-600 disabled:opacity-50"
        >
          <Trash2 size={18} />
          {cleaning ? "Deleting" : "Delete runs"}
        </button>
        {cleanupStatus && <p className="text-sm text-[var(--text-muted)]">{cleanupStatus}</p>}
      </section>
      <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex items-center gap-2">
          <CircleAlert size={18} className="text-amber-500" />
          <h2 className="font-medium">Privileges</h2>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{status ?? "Checking"}</p>
      </section>
    </div>
  );
}

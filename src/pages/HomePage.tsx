import { useEffect, useState } from "react";
import { CircleAlert, RefreshCw, ShieldAlert } from "lucide-react";
import { getPrivilegedStatus, resolveCurrent } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { ResolvedRun } from "../lib/types";
import { activeController, activeResource, activeRun, configuredTask } from "../lib/options";
import { useAppStore } from "../store/appStore";

export function HomePage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const [run, setRun] = useState<ResolvedRun>();
  const [privileged, setPrivileged] = useState<string>();
  const [error, setError] = useState<string>();
  const { t } = useTranslation();

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
        <h1 className="text-2xl font-semibold">{t("project")}</h1>
        <p className="text-[var(--text-muted)]">{t("noProject")}</p>
      </div>
    );
  }

  const { project, configuration } = snapshot;
  const resource = activeResource(project, configuration);
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
          <h2 className="font-medium">{t("currentSelection")}</h2>
          <button
            type="button"
            onClick={refresh}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)]"
            aria-label={t("refreshStatus")}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[var(--text-muted)]">{t("controller")}</dt>
            <dd>
              {run?.controller.label ??
                activeController(project)?.label ??
                t("unavailable")}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{t("resource")}</dt>
            <dd>{run?.resource.label ?? resource?.label ?? t("unavailable")}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{t("preset")}</dt>
            <dd>{runConfig?.name ?? t("defaultRunName")}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-muted)]">{t("enabled")}</dt>
            <dd>{t("enabledTasks", { count: enabled.length })}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-500" />
          <h2 className="font-medium">{t("privilegedHost")}</h2>
        </div>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{privileged ?? t("checking")}</p>
      </section>

      {error && (
        <section className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          <CircleAlert size={18} className="shrink-0" />
          <span className="min-w-0 break-all">{error}</span>
        </section>
      )}
      {busy && <p className="text-sm text-[var(--text-muted)]">{t("saving")}</p>}
    </div>
  );
}

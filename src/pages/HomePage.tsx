import { PrivilegeStatusCard } from "../components/PrivilegeStatusCard";
import { useTranslation } from "../lib/i18n";
import type { VersionInfo } from "../lib/types";
import { useAppStore } from "../store/appStore";

export function HomePage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const busy = useAppStore((state) => state.busy);
  const { t } = useTranslation();

  if (!snapshot?.project) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("project")}</h1>
        <p className="text-ink-muted">{t("noProject")}</p>
      </div>
    );
  }

  const { project, versions } = snapshot;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-ink-muted">{project.version ?? "PI v2"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {project.label}
        </h1>
      </header>

      <PrivilegeStatusCard title="privilegedHost" />

      {versions && <VersionCard versions={versions} />}

      {busy && <p className="text-sm text-ink-muted">{t("saving")}</p>}
    </div>
  );
}

/**
 * The versions and device facts the diagnostic export collects, so a run report
 * can be attributed to a build without opening Settings.
 */
function VersionCard({ versions }: { versions: VersionInfo }) {
  const { t } = useTranslation();
  const environment = versions.environment;

  return (
    <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
      <h2 className="font-medium">{t("versions")}</h2>
      <dl className="space-y-2 text-sm">
        <Row label={t("appName")} value={versions.appTag} />
        <Row label={t("aboutFramework")} value={versions.frameworkVersion} />
        {versions.resourceTag && (
          <Row label={t("resource")} value={versions.resourceTag} />
        )}
        {environment && (
          <>
            <Row label={t("device")} value={environment.device} />
            <Row
              label={t("androidVersion")}
              value={`${environment.android} (API ${environment.sdkInt})`}
            />
            <Row label={t("abi")} value={environment.abi} />
          </>
        )}
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

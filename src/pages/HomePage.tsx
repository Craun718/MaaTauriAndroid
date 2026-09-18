import { useTranslation } from "../lib/i18n";
import { PrivilegeStatusCard } from "../components/PrivilegeStatusCard";
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

  const { project } = snapshot;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-ink-muted">
          {project.version ?? "PI v2"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{project.label}</h1>
      </header>

      <PrivilegeStatusCard title="privilegedHost" />

      {busy && <p className="text-sm text-ink-muted">{t("saving")}</p>}
    </div>
  );
}

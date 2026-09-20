import { PrivilegeStatusCard } from "../components/PrivilegeStatusCard";
import { VersionCard } from "../components/VersionCard";
import { useTranslation } from "../lib/i18n";
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
        <h1 className="text-3xl font-semibold tracking-tight">
          {project.label}
        </h1>
      </header>

      <VersionCard
        title="versions"
        variant="about"
        project={project}
        versions={versions}
      />

      <PrivilegeStatusCard title="privilegedHost" />

      {busy && <p className="text-sm text-ink-muted">{t("saving")}</p>}
    </div>
  );
}

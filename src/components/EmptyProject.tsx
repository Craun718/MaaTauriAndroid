import { useTranslation } from "../lib/i18n";

/** Shown by every project page until a project directory has been loaded. */
export function EmptyProject() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("project")}</h1>
      <p className="mt-2 text-[var(--text-muted)]">{t("loadProjectHint")}</p>
    </div>
  );
}

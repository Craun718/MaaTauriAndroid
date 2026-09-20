import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "../lib/i18n";
import type { Project, VersionInfo } from "../lib/types";

export function VersionCard({
  title,
  variant,
  project,
  versions,
  footer,
}: {
  title: MessageKey;
  variant: "about" | "summary";
  project: Project;
  versions?: VersionInfo;
  footer?: string;
}) {
  const { t } = useTranslation();
  const environment = versions?.environment;

  return (
    <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
      <h2 className="font-medium">{t(title)}</h2>
      <dl className="space-y-2 text-sm">
        {variant === "about" ? (
          <>
            <Row label={t("appName")} value={versions?.appVersion} />
            <Row
              label={t("aboutFramework")}
              value={versions?.frameworkVersion}
            />
            <Row label={t("resourceName")} value={project.label} />
            <Row
              label={t("resourceVersion")}
              value={project.version ?? t("aboutUnknown")}
            />
          </>
        ) : (
          <>
            <Row label={t("appName")} value={versions?.appTag} />
            <Row
              label={t("aboutFramework")}
              value={versions?.frameworkVersion}
            />
            <Row label={t("resourceName")} value={project.label} />
            <Row label={t("resourceVersion")} value={versions?.resourceTag} />
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
          </>
        )}
      </dl>
      {footer && <p className="text-center text-xs text-ink-muted">{footer}</p>}
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value ?? t("aboutUnknown")}</dd>
    </div>
  );
}

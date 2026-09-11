import { useEffect, useState } from "react";
import { CircleAlert, FolderInput, Trash2 } from "lucide-react";
import { Checkbox } from "../components/ui/Checkbox";
import { SegmentGroup } from "../components/ui/SegmentGroup";
import { TextField } from "../components/ui/TextField";
import { clearDiagnosticData, getPrivilegedStatus } from "../lib/api";
import { projectLanguage, useTranslation } from "../lib/i18n";
import { useAppStore } from "../store/appStore";
import type { UiLanguage } from "../lib/types";

function isUiLanguage(value: string): value is UiLanguage {
  return value === "system" || value === "zh" || value === "en";
}

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const load = useAppStore((state) => state.loadProject);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const busy = useAppStore((state) => state.busy);
  const { language, t } = useTranslation();
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
      <h1 className="text-2xl font-semibold">{t("settings")}</h1>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <SegmentGroup
          label={t("language")}
          description={t("languageDescription")}
          value={snapshot?.configuration.uiLanguage ?? "system"}
          items={[
            { value: "system", label: t("languageSystem") },
            { value: "zh", label: t("languageChinese") },
            { value: "en", label: t("languageEnglish") },
          ]}
          onValueChange={(value) => {
            if (!snapshot || !isUiLanguage(value)) return;
            const next = structuredClone(snapshot.configuration);
            next.uiLanguage = value;
            void saveConfiguration(next);
          }}
        />
      </section>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h2 className="font-medium">{t("projectDirectory")}</h2>
        <div className="flex gap-2">
          <TextField
            className="min-w-0 flex-1"
            ariaLabel={t("projectDirectory")}
            value={path}
            onValueChange={setPath}
            placeholder="/storage/emulated/0/MaaTauriAndroid"
          />
          <button
            type="button"
            disabled={!path || busy}
            onClick={() => void load(path, projectLanguage(language))}
            className="flex h-11 w-11 items-center justify-center rounded-md bg-[var(--accent)] text-white disabled:opacity-50"
            aria-label={t("loadProject")}
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
        <h2 className="font-medium">{t("runBehavior")}</h2>
        <Checkbox
          className="min-h-12 gap-3"
          checked={snapshot?.configuration.forceStopTargetApp ?? false}
          disabled={busy || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.forceStopTargetApp = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("forceStopTargetApp")}</span>
        </Checkbox>
      </section>
      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <h2 className="font-medium">{t("diagnostics")}</h2>
        <button
          type="button"
          disabled={busy || cleaning || !snapshot}
          onClick={async () => {
            const confirmed = window.confirm(t("deleteRunsConfirm"));
            if (!confirmed) return;
            setCleaning(true);
            setCleanupStatus(undefined);
            try {
              const result = await clearDiagnosticData();
              setCleanupStatus(t("deletedRuns", { count: result.deletedRunCount }));
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
          {cleaning ? t("deleting") : t("deleteRuns")}
        </button>
        {cleanupStatus && <p className="text-sm text-[var(--text-muted)]">{cleanupStatus}</p>}
      </section>
      <section className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4">
        <div className="flex items-center gap-2">
          <CircleAlert size={18} className="text-amber-500" />
          <h2 className="font-medium">{t("privileges")}</h2>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{status ?? t("checking")}</p>
      </section>
    </div>
  );
}

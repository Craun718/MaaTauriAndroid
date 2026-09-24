import { ChevronRight, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AboutLinks } from "../components/AboutLinks";
import { OptionEditor } from "../components/OptionEditor";
import { UpdateCard } from "../components/UpdateCard";
import { Checkbox } from "../components/ui/Checkbox";
import { Select } from "../components/ui/Select";
import { VersionCard } from "../components/VersionCard";
import { clearDiagnosticData, restartApp } from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "../lib/i18n";
import {
  activeResource,
  defaultOptionValue,
  visibleOptions,
} from "../lib/options";
import type { OptionValue, UiLanguage, UserConfiguration } from "../lib/types";
import { useLogExport } from "../lib/useLogExport";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";

function isUiLanguage(value: string): value is UiLanguage {
  return value === "system" || value === "zh" || value === "en";
}

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const busy = useAppStore((state) => state.busy);
  const notify = useNotificationStore((state) => state.notify);
  const { t } = useTranslation();
  const [cleaning, setCleaning] = useState(false);
  const { exportLogs, exporting } = useLogExport();
  const [languageDraft, setLanguageDraft] = useState<UiLanguage>();

  const project = snapshot?.project;
  const resource =
    project && snapshot
      ? activeResource(project, snapshot.configuration)
      : undefined;

  function update(
    mutate: (configuration: UserConfiguration) => UserConfiguration,
  ) {
    if (!snapshot) return;
    void saveConfiguration(mutate(structuredClone(snapshot.configuration)));
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">{t("settings")}</h1>
      <UpdateCard />
      <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
        <h2 id="language-select-label" className="font-medium">
          {t("language")}
        </h2>
        <div className="flex gap-2">
          <Select
            className="min-w-0 flex-1"
            labelledBy="language-select-label"
            items={[
              { value: "system", label: t("languageSystem") },
              { value: "zh", label: t("languageChinese") },
              { value: "en", label: t("languageEnglish") },
            ]}
            value={
              languageDraft ?? snapshot?.configuration.uiLanguage ?? "system"
            }
            onValueChange={(value) => {
              if (isUiLanguage(value)) setLanguageDraft(value);
            }}
          />
          <button
            type="button"
            disabled={
              busy ||
              !snapshot ||
              languageDraft === undefined ||
              languageDraft === snapshot.configuration.uiLanguage
            }
            onClick={async () => {
              if (!snapshot || languageDraft === undefined) return;
              const next = structuredClone(snapshot.configuration);
              next.uiLanguage = languageDraft;
              await saveConfiguration(next);
              setLanguageDraft(undefined);
            }}
            className="h-9 shrink-0 rounded-md bg-accent px-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("apply")}
          </button>
        </div>
      </section>
      {project && snapshot && (
        <>
          <ScopedOptions
            title="globalOptions"
            compact
            names={project.globalOptions}
            values={snapshot.configuration.globalOptionValues}
            onChange={(name, value) =>
              update((current) => ({
                ...current,
                globalOptionValues: {
                  ...current.globalOptionValues,
                  [name]: value,
                },
              }))
            }
          />
          <ScopedOptions
            title="resourceOptions"
            compact
            names={resource?.options ?? []}
            values={
              snapshot.configuration.resourceOptionValues[
                resource?.name ?? ""
              ] ?? {}
            }
            onChange={(name, value) =>
              update((current) => ({
                ...current,
                resourceOptionValues: {
                  ...current.resourceOptionValues,
                  [resource?.name ?? ""]: {
                    ...(current.resourceOptionValues[resource?.name ?? ""] ??
                      {}),
                    [name]: value,
                  },
                },
              }))
            }
          />
        </>
      )}
      <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
        <h2 className="font-medium">{t("runBehavior")}</h2>
        <Checkbox
          className="min-h-10 gap-2"
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
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.closeTargetAppAfterRun ?? true}
          disabled={busy || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.closeTargetAppAfterRun = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("closeTargetAppAfterRun")}</span>
        </Checkbox>
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.showVirtualDisplayTouches ?? true}
          disabled={busy || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.showVirtualDisplayTouches = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("showTouchPositions")}</span>
        </Checkbox>
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.showVirtualDisplayFps ?? true}
          disabled={busy || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.showVirtualDisplayFps = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("showVirtualDisplayFps")}</span>
        </Checkbox>
      </section>
      <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
        <h2 className="font-medium">{t("diagnostics")}</h2>
        <div className="space-y-1">
          <Checkbox
            className="min-h-10 gap-2"
            checked={snapshot?.configuration.debugMode ?? false}
            disabled={busy || !snapshot}
            onCheckedChange={(next) => {
              if (!snapshot) return;
              // 开启需要重启（对齐 MaaFwApp）：确认后落盘再重启；关闭即时生效不重启
              if (next && !window.confirm(t("debugModeRestartConfirm"))) return;
              const nextConfiguration = structuredClone(snapshot.configuration);
              nextConfiguration.debugMode = next;
              void (async () => {
                await saveConfiguration(nextConfiguration);
                // 保存失败（store 会展示 error）时不重启，避免重启后丢改动
                if (!next || useAppStore.getState().error) return;
                try {
                  await restartApp();
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    {
                      tone: "error",
                    },
                  );
                }
              })();
            }}
          >
            <span className="font-medium">{t("debugMode")}</span>
          </Checkbox>
          <p className="text-sm text-ink-muted">{t("debugModeDescription")}</p>
        </div>
        <Link
          to="/runs"
          className="flex h-9 items-center justify-between rounded-md border border-line px-2.5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("runHistoryTitle")}
          <ChevronRight size="1rem" className="text-ink-muted" />
        </Link>
        <button
          type="button"
          disabled={exporting}
          onClick={() => {
            void exportLogs();
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
        >
          <Download size="1rem" />
          {exporting ? t("exportingLogs") : t("exportLogs")}
        </button>
        <button
          type="button"
          disabled={busy || cleaning || !snapshot}
          onClick={async () => {
            const confirmed = window.confirm(t("deleteRunsConfirm"));
            if (!confirmed) return;
            setCleaning(true);
            try {
              const result = await clearDiagnosticData();
              notify(t("deletedRuns", { count: result.deletedRunCount }));
              // The restart re-arms the app log file handle that survives a
              // plain deletion; a failed restart still leaves the cleanup done.
              await restartApp();
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), {
                tone: "error",
              });
            } finally {
              setCleaning(false);
            }
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-red-300 px-2.5 font-semibold text-red-600 disabled:opacity-50"
        >
          <Trash2 size="1rem" />
          {cleaning ? t("deleting") : t("deleteRuns")}
        </button>
      </section>
      {project?.metadata.telemetry?.dsn && (
        <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
          <h2 className="font-medium">{t("telemetry")}</h2>
          <p className="text-sm text-ink-muted">{t("telemetryDescription")}</p>
          <Checkbox
            className="min-h-10 gap-2"
            checked={snapshot?.configuration.telemetryEnabled ?? false}
            disabled={busy || !snapshot}
            onCheckedChange={(next) => {
              if (!snapshot) return;
              const nextConfiguration = structuredClone(snapshot.configuration);
              nextConfiguration.telemetryEnabled = next;
              void saveConfiguration(nextConfiguration);
            }}
          >
            <span className="font-medium">{t("telemetryEnabled")}</span>
          </Checkbox>
        </section>
      )}
      {project && (
        <VersionCard
          title="about"
          variant="summary"
          project={project}
          versions={snapshot?.versions}
          footer={t("aboutSummaryHint")}
          actions={<AboutLinks metadata={project.metadata} />}
        />
      )}
    </div>
  );
}

/** The project-scoped option blocks (global and per-resource), moved here from
 * the setup page so every project-level knob lives in one place. */
function ScopedOptions({
  title,
  compact,
  names,
  values,
  onChange,
}: {
  title: MessageKey;
  compact?: boolean;
  names: string[];
  values: Record<string, OptionValue>;
  onChange: (name: string, value: OptionValue) => void;
}) {
  const project = useAppStore((state) => state.snapshot?.project);
  const { t } = useTranslation();
  if (names.length === 0) return null;
  const definitions = project?.options ?? {};
  return (
    <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
      <h2 className="font-medium">{t(title)}</h2>
      {visibleOptions(definitions, names, values).map(({ name, depth }) => {
        const option = definitions[name];
        if (!option) return null;
        return (
          <div
            key={name}
            className={depth > 0 ? "border-l-2 border-line pl-3" : undefined}
          >
            <OptionEditor
              option={option}
              compact={compact}
              value={defaultOptionValue(option, values[name])}
              onChange={(value) => onChange(name, value)}
            />
          </div>
        );
      })}
    </section>
  );
}

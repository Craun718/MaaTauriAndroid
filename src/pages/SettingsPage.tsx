import {
  Download,
  Globe,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AboutLinks } from "../components/AboutLinks";
import { PretaskSettings } from "../components/PretaskSettings";
import { UpdateCard } from "../components/UpdateCard";
import { Select } from "../components/ui/Select";
import { SettingRow, SettingToggle } from "../components/ui/SettingRow";
import { VersionCard } from "../components/VersionCard";
import {
  clearDiagnosticData,
  exportConfiguration,
  getOverlayPermissionStatus,
  requestOverlayPermission,
  restartApp,
} from "../lib/api";
import { localizeDiagnostic, useTranslation } from "../lib/i18n";
import {
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
} from "../lib/language";
import { activeResource } from "../lib/options";

import type { UiLanguage, UserConfiguration } from "../lib/types";
import { useLogExport } from "../lib/useLogExport";
import { useAppStore } from "../store/appStore";
import { useGuideStore } from "../store/guideStore";
import { useNotificationStore } from "../store/notificationStore";
import {
  CustomBackgroundCard,
  RunDurationField,
  ScopedOptions,
} from "./settings/sections/cards";

function isUiLanguage(value: string): value is UiLanguage {
  return value === "system" || value === "zh" || value === "en";
}

export function SettingsPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const setProjectLanguage = useAppStore((state) => state.setProjectLanguage);
  const reinstallResources = useAppStore((state) => state.reinstallResources);
  const importConfiguration = useAppStore((state) => state.importConfiguration);
  const busy = useAppStore((state) => state.busy);
  const saving = useAppStore((state) => state.saving);
  const notify = useNotificationStore((state) => state.notify);
  const { t, language } = useTranslation();
  const [cleaning, setCleaning] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const [overlayPermission, setOverlayPermission] = useState(false);
  const { exportLogs, exporting } = useLogExport();
  const [languageDraft, setLanguageDraft] = useState<UiLanguage>();

  // The overlay permission lives in system settings, so it can change while
  // this page stays open: re-check every time the app returns to the front.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getOverlayPermissionStatus()
        .then((granted) => {
          if (!cancelled) setOverlayPermission(granted);
        })
        .catch(() => undefined);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

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
    <div className="space-y-card-gap">
      <h1 className="text-xl font-semibold">{t("settings")}</h1>
      <UpdateCard />
      <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
        <h2
          id="language-select-label"
          className="flex items-center gap-2 font-medium"
        >
          <Globe size="1rem" />
          {t("language")}
        </h2>
        <SettingRow>
          <div className="flex flex-wrap gap-2">
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
                saving ||
                restartPending ||
                !snapshot ||
                languageDraft === undefined ||
                languageDraft === snapshot.configuration.uiLanguage
              }
              onClick={async () => {
                if (!snapshot || languageDraft === undefined) return;
                const next = structuredClone(snapshot.configuration);
                next.uiLanguage = languageDraft;
                await saveConfiguration(next);
                await setProjectLanguage(
                  projectLanguage(
                    resolveLanguage(languageDraft, systemLanguageTags()),
                  ),
                );
                setLanguageDraft(undefined);
              }}
              className="h-9 shrink-0 rounded-md bg-accent px-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("apply")}
            </button>
          </div>
        </SettingRow>
      </section>
      {project && snapshot && (
        <>
          <PretaskSettings
            project={project}
            configuration={snapshot.configuration}
            onChange={(configuration) => {
              void saveConfiguration(configuration);
            }}
          />
          {project.settingSections.length > 0 &&
            project.globalOptions.length > 0 && (
              <h2 className="text-lg font-semibold">{t("taskSettings")}</h2>
            )}
          <ScopedOptions
            title="globalOptions"
            compact
            sections={project.settingSections}
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
      <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
        <h2 className="font-medium">{t("backupRestore")}</h2>
        <p className="text-sm text-ink-muted">
          {t("backupRestoreDescription")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={
              busy ||
              saving ||
              restartPending ||
              exportingBackup ||
              importingBackup ||
              !snapshot
            }
            onClick={async () => {
              setExportingBackup(true);
              try {
                const result = await exportConfiguration();
                if (result.fileName) {
                  notify(t("configurationExported", { name: result.fileName }));
                } else {
                  notify(t("configurationExportedPath", { path: result.path }));
                }
              } catch (error) {
                notify(error instanceof Error ? error.message : String(error), {
                  tone: "error",
                });
              } finally {
                setExportingBackup(false);
              }
            }}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
          >
            <Download size="1rem" />
            {exportingBackup
              ? t("exportingConfiguration")
              : t("exportConfiguration")}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              saving ||
              restartPending ||
              exportingBackup ||
              importingBackup ||
              !snapshot
            }
            onClick={async () => {
              if (!window.confirm(t("configurationImportConfirm"))) return;
              setImportingBackup(true);
              try {
                const result = await importConfiguration();
                if (result.imported) notify(t("configurationImported"));
              } catch (error) {
                notify(
                  localizeDiagnostic(
                    error instanceof Error ? error.message : String(error),
                    language,
                  ),
                  {
                    tone: "error",
                  },
                );
              } finally {
                setImportingBackup(false);
              }
            }}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
          >
            <Upload size="1rem" />
            {importingBackup
              ? t("importingConfiguration")
              : t("importConfiguration")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy || saving || restartPending || cleaning || !snapshot}
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
          <button
            type="button"
            data-guide-target="settings-export-logs"
            disabled={exporting}
            onClick={() => {
              void exportLogs();
            }}
            className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
          >
            <Download size="1rem" />
            {exporting ? t("exportingLogs") : t("exportLogs")}
          </button>
        </div>
        <button
          type="button"
          disabled={
            busy || saving || restartPending || reinstalling || !snapshot
          }
          onClick={async () => {
            setReinstalling(true);
            await reinstallResources();
            setReinstalling(false);
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
        >
          <RefreshCw size="1rem" />
          {reinstalling ? t("reinstallingResources") : t("reinstallResources")}
        </button>
      </section>
      <CustomBackgroundCard restartPending={restartPending} />
      <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
        <h2 className="font-medium">{t("runBehavior")}</h2>
        <SettingToggle
          title={t("forceStopTargetApp")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.forceStopTargetApp ?? false}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.forceStopTargetApp = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("foregroundMode")}
          description={t("foregroundModeDescription")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.foregroundMode ?? false}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.foregroundMode = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("foregroundOverlay")}
          description={t("foregroundOverlayDescription")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.foregroundOverlay ?? false}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.foregroundOverlay = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        {!snapshot?.configuration.foregroundMode && (
          <p className="text-xs text-ink-muted">
            {t("foregroundOverlayForegroundOnly")}
          </p>
        )}
        {snapshot?.configuration.foregroundOverlay && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-muted">
              {t("foregroundOverlayPermission")}:{" "}
              {overlayPermission
                ? t("permissionGranted")
                : t("permissionRequiredStatus")}
            </span>
            {!overlayPermission && (
              <button
                type="button"
                onClick={() => {
                  void requestOverlayPermission().catch(() => undefined);
                }}
                className="h-8 shrink-0 rounded-md border border-line px-2.5 text-sm font-semibold"
              >
                {t("foregroundOverlayGrant")}
              </button>
            )}
          </div>
        )}
        <SettingToggle
          title={t("closeTargetAppAfterRun")}
          description={t("closeTargetAppAfterRunDescription")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.closeTargetAppAfterRun ?? true}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.closeTargetAppAfterRun = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("exitAppAfterRun")}
          description={t("exitAppAfterRunDescription")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.exitAppAfterRun ?? false}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.exitAppAfterRun = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <RunDurationField
          seconds={snapshot?.configuration.maxRunDurationSeconds}
          disabled={restartPending || !snapshot}
          onSave={(seconds) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.maxRunDurationSeconds = seconds;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("showTouchPositions")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.showVirtualDisplayTouches ?? true}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.showVirtualDisplayTouches = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("pipOnHome")}
          description={t("pipOnHomeDescription")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.pipOnHome ?? true}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.pipOnHome = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
        <SettingToggle
          title={t("showVirtualDisplayFps")}
          icon={<Settings2 size="1rem" />}
          checked={snapshot?.configuration.showVirtualDisplayFps ?? true}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.showVirtualDisplayFps = next;
            void saveConfiguration(nextConfiguration);
          }}
        />
      </section>
      <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
        <h2 className="font-medium">{t("diagnostics")}</h2>
        <div className="space-y-1">
          <SettingToggle
            title={t("debugMode")}
            description={t("debugModeDescription")}
            icon={<Settings2 size="1rem" />}
            checked={snapshot?.configuration.debugMode ?? false}
            disabled={restartPending || !snapshot}
            onCheckedChange={(next) => {
              if (!snapshot) return;
              // 开启需要重启（对齐 MaaFwApp）：确认后落盘再重启；关闭即时生效不重启
              if (next && !window.confirm(t("debugModeRestartConfirm"))) return;
              const nextConfiguration = structuredClone(snapshot.configuration);
              nextConfiguration.debugMode = next;
              setRestartPending(true);
              void (async () => {
                try {
                  await saveConfiguration(nextConfiguration);
                  // 保存失败（store 会展示 error）时不重启，避免重启后丢改动
                  if (!next || useAppStore.getState().error) return;
                  await restartApp();
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : String(error),
                    {
                      tone: "error",
                    },
                  );
                } finally {
                  setRestartPending(false);
                }
              })();
            }}
          />
        </div>
      </section>
      {project?.metadata.telemetry?.dsn && (
        <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
          <h2 className="font-medium">{t("telemetry")}</h2>
          <p className="text-sm text-ink-muted">{t("telemetryDescription")}</p>
          <SettingToggle
            title={t("telemetryEnabled")}
            icon={<Settings2 size="1rem" />}
            checked={snapshot?.configuration.telemetryEnabled ?? false}
            disabled={restartPending || !snapshot}
            onCheckedChange={(next) => {
              if (!snapshot) return;
              const nextConfiguration = structuredClone(snapshot.configuration);
              nextConfiguration.telemetryEnabled = next;
              void saveConfiguration(nextConfiguration);
            }}
          />
        </section>
      )}
      {project && (
        <VersionCard
          title="about"
          variant="summary"
          project={project}
          versions={snapshot?.versions}
          footer={t("aboutSummaryHint")}
          actions={
            <>
              <AboutLinks metadata={project.metadata} />
              <button
                type="button"
                data-guide-target="settings-about"
                onClick={() => useGuideStore.getState().start()}
                className="btn btn-sm w-full"
              >
                {t("guideReplay")}
              </button>
              <button
                type="button"
                className="btn btn-sm w-full"
                onClick={() => useGuideStore.getState().openDemo()}
              >
                {t("demoReplay")}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

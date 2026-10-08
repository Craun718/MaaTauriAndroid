import {
  ChevronDown,
  Download,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { AboutLinks } from "../components/AboutLinks";
import { OptionEditor } from "../components/OptionEditor";
import { ProjectImage } from "../components/ProjectImage";
import { RichDescription } from "../components/RichDescription";
import { UpdateCard } from "../components/UpdateCard";
import { Checkbox } from "../components/ui/Checkbox";
import { Select } from "../components/ui/Select";
import { TextField } from "../components/ui/TextField";
import { VersionCard } from "../components/VersionCard";
import {
  clearDiagnosticData,
  exportConfiguration,
  restartApp,
} from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "../lib/i18n";
import {
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
} from "../lib/language";
import type { VisibleOption } from "../lib/options";
import {
  activeResource,
  defaultOptionValue,
  groupedVisibleOptions,
} from "../lib/options";
import {
  formatRunLimitMinutes,
  parseRunLimitInput,
  runLimitSeconds,
} from "../lib/runLimits";
import type {
  OptionDefinition,
  OptionValue,
  SettingSection,
  UiLanguage,
  UserConfiguration,
} from "../lib/types";
import { useLogExport } from "../lib/useLogExport";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";

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
  const { t } = useTranslation();
  const [cleaning, setCleaning] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
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
      </section>
      {project && snapshot && (
        <>
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
      <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
        <h2 className="font-medium">{t("backupRestore")}</h2>
        <p className="text-sm text-ink-muted">
          {t("backupRestoreDescription")}
        </p>
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
              notify(error instanceof Error ? error.message : String(error), {
                tone: "error",
              });
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
      </section>
      <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
        <h2 className="font-medium">{t("runBehavior")}</h2>
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.forceStopTargetApp ?? false}
          disabled={restartPending || !snapshot}
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
          checked={snapshot?.configuration.foregroundMode ?? false}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.foregroundMode = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("foregroundMode")}</span>
        </Checkbox>
        <p className="text-sm text-ink-muted">
          {t("foregroundModeDescription")}
        </p>
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.closeTargetAppAfterRun ?? true}
          disabled={restartPending || !snapshot}
          onCheckedChange={(next) => {
            if (!snapshot) return;
            const nextConfiguration = structuredClone(snapshot.configuration);
            nextConfiguration.closeTargetAppAfterRun = next;
            void saveConfiguration(nextConfiguration);
          }}
        >
          <span className="font-medium">{t("closeTargetAppAfterRun")}</span>
        </Checkbox>
        <p className="text-sm text-ink-muted">
          {t("closeTargetAppAfterRunDescription")}
        </p>
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
        <Checkbox
          className="min-h-10 gap-2"
          checked={snapshot?.configuration.showVirtualDisplayTouches ?? true}
          disabled={restartPending || !snapshot}
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
          disabled={restartPending || !snapshot}
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
          >
            <span className="font-medium">{t("debugMode")}</span>
          </Checkbox>
          <p className="text-sm text-ink-muted">{t("debugModeDescription")}</p>
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
      </section>
      {project?.metadata.telemetry?.dsn && (
        <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
          <h2 className="font-medium">{t("telemetry")}</h2>
          <p className="text-sm text-ink-muted">{t("telemetryDescription")}</p>
          <Checkbox
            className="min-h-10 gap-2"
            checked={snapshot?.configuration.telemetryEnabled ?? false}
            disabled={restartPending || !snapshot}
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

/** 单轮运行时长上限：以分钟输入，留空表示不限制，失焦时校验并落盘。 */
function RunDurationField({
  seconds,
  disabled,
  onSave,
}: {
  seconds?: number;
  disabled: boolean;
  onSave: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const text = draft ?? formatRunLimitMinutes(seconds);

  return (
    <TextField
      label={t("maxRunDuration")}
      description={t("maxRunDurationDescription")}
      error={invalid ? t("maxRunDurationInvalid") : undefined}
      inputMode="numeric"
      disabled={disabled}
      value={text}
      onValueChange={(value) => {
        setDraft(value);
        setInvalid(false);
      }}
      onBlur={() => {
        const parsed = parseRunLimitInput(text);
        if (parsed.kind === "invalid") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        setDraft(undefined);
        const next = runLimitSeconds(parsed);
        if (next !== (seconds ?? 0)) onSave(next);
      }}
    />
  );
}

/** The project-scoped option blocks (global and per-resource), moved here from
 * the setup page so every project-level knob lives in one place. */
function ScopedOptions({
  title,
  compact,
  sections = [],
  names,
  values,
  onChange,
}: {
  title: MessageKey;
  compact?: boolean;
  sections?: SettingSection[];
  names: string[];
  values: Record<string, OptionValue>;
  onChange: (name: string, value: OptionValue) => void;
}) {
  const project = useAppStore((state) => state.snapshot?.project);
  const { t } = useTranslation();
  if (names.length === 0) return null;
  const definitions = project?.options ?? {};
  const groups = groupedVisibleOptions(sections, definitions, names, values);

  return (
    <>
      {groups.map((group) =>
        group.section ? (
          <TaskSettingSection
            key={group.section.name}
            section={group.section}
            compact={compact}
            definitions={definitions}
            options={group.options}
            values={values}
            onChange={onChange}
          />
        ) : (
          <section
            key={`${title}-ungrouped`}
            className="space-y-2 rounded-lg border border-line bg-raised p-3"
          >
            <h3 className="font-medium">{t(title)}</h3>
            <VisibleOptionList
              compact={compact}
              definitions={definitions}
              options={group.options}
              values={values}
              onChange={onChange}
            />
          </section>
        ),
      )}
    </>
  );
}

function TaskSettingSection({
  section,
  compact,
  definitions,
  options,
  values,
  onChange,
}: {
  section: SettingSection;
  compact?: boolean;
  definitions: Record<string, OptionDefinition>;
  options: VisibleOption[];
  values: Record<string, OptionValue>;
  onChange: (name: string, value: OptionValue) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(section.defaultExpand);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-raised">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-0.25rem] focus-visible:outline-accent"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ProjectImage
            path={section.icon}
            alt=""
            className="h-5 w-5 shrink-0 object-contain"
            fallback={
              <SlidersHorizontal
                size="1.25rem"
                className="shrink-0 text-accent"
              />
            }
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{section.label}</span>
          </span>
        </span>
        <ChevronDown
          size="1.25rem"
          className={`flex-none text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {section.description && (
        <RichDescription
          text={section.description}
          className="px-3 py-2 text-xs text-ink-muted"
        />
      )}
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {options.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("taskSettingsEmpty")}</p>
          ) : (
            <VisibleOptionList
              compact={compact}
              definitions={definitions}
              options={options}
              values={values}
              onChange={onChange}
            />
          )}
        </div>
      )}
    </section>
  );
}

function VisibleOptionList({
  compact,
  definitions,
  options,
  values,
  onChange,
}: {
  compact?: boolean;
  definitions: Record<string, OptionDefinition>;
  options: VisibleOption[];
  values: Record<string, OptionValue>;
  onChange: (name: string, value: OptionValue) => void;
}) {
  return (
    <>
      {options.map(({ name, depth }) => {
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
    </>
  );
}

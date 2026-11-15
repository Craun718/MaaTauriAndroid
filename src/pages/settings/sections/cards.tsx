import {
  ChevronDown,
  ImagePlus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { OptionEditor } from "../../../components/OptionEditor";
import { ProjectImage } from "../../../components/ProjectImage";
import { RichDescription } from "../../../components/RichDescription";
import { SettingRow } from "../../../components/ui/SettingRow";
import { Slider } from "../../../components/ui/Slider";
import { TextField } from "../../../components/ui/TextField";
import { useBackgroundImageObjectUrl } from "../../../lib/backgroundImage";
import type { MessageKey } from "../../../lib/i18n";
import { useTranslation } from "../../../lib/i18n";
import type { VisibleOption } from "../../../lib/options";
import {
  defaultOptionValue,
  groupedVisibleOptions,
} from "../../../lib/options";
import {
  formatRunLimitMinutes,
  parseRunLimitInput,
  runLimitSeconds,
} from "../../../lib/runLimits";
import type {
  OptionDefinition,
  OptionValue,
  SettingSection,
} from "../../../lib/types";
import { useAppStore } from "../../../store/appStore";
import { useBackgroundPreviewStore } from "../../../store/backgroundPreviewStore";
import { useNotificationStore } from "../../../store/notificationStore";

/** Local-only background image management; the body never enters a backup. */
export function CustomBackgroundCard({
  restartPending,
}: {
  restartPending: boolean;
}) {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const busy = useAppStore((state) => state.busy);
  const saving = useAppStore((state) => state.saving);
  const importBackgroundImage = useAppStore(
    (state) => state.importBackgroundImage,
  );
  const removeBackgroundImage = useAppStore(
    (state) => state.removeBackgroundImage,
  );
  const notify = useNotificationStore((state) => state.notify);
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const opacityDraft = useBackgroundPreviewStore((state) => state.cardOpacity);
  const previewCardOpacity = useBackgroundPreviewStore(
    (state) => state.previewCardOpacity,
  );
  const clearCardOpacity = useBackgroundPreviewStore(
    (state) => state.clearCardOpacity,
  );
  const image = snapshot?.configuration.backgroundImage;
  const source = useBackgroundImageObjectUrl(image);
  const savedOpacity = snapshot?.configuration.backgroundCardOpacity ?? 100;
  const opacity = opacityDraft ?? savedOpacity;
  const disabled =
    busy || saving || restartPending || importing || removing || !snapshot;

  useEffect(() => () => clearCardOpacity(), [clearCardOpacity]);

  function saveOpacity(value: number): void {
    if (!snapshot || value === savedOpacity) {
      clearCardOpacity();
      return;
    }
    const revision = useBackgroundPreviewStore.getState().revision;
    const next = structuredClone(snapshot.configuration);
    next.backgroundCardOpacity = value;
    void saveConfiguration(next).finally(() => {
      clearCardOpacity(revision);
    });
  }

  return (
    <section className="space-y-2 rounded-lg border border-line bg-raised p-card">
      <SettingRow
        title={<h2 className="font-medium">{t("customBackground")}</h2>}
        description={t("customBackgroundDescription")}
      />
      <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-surface-muted">
        {source ? (
          <img src={source} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-sm text-ink-muted">
            {t("backgroundImageEmpty")}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {t("backgroundCardOpacity")}
          </span>
          <span className="text-sm text-ink-muted">{opacity}%</span>
        </div>
        <Slider
          ariaLabel={t("backgroundCardOpacity")}
          value={opacity}
          min={25}
          max={100}
          step={5}
          disabled={
            busy || restartPending || importing || removing || !snapshot
          }
          onValueChange={previewCardOpacity}
          onValueCommit={saveOpacity}
        />
        <p className="text-xs text-ink-muted">
          {t("backgroundCardOpacityDescription")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={async () => {
            setImporting(true);
            try {
              await importBackgroundImage();
              const nextImage =
                useAppStore.getState().snapshot?.configuration.backgroundImage;
              if (
                nextImage &&
                (nextImage.fileName !== image?.fileName ||
                  nextImage.revision !== image?.revision)
              ) {
                notify(t("backgroundImageImported"));
              }
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), {
                tone: "error",
              });
            } finally {
              setImporting(false);
            }
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
        >
          <ImagePlus size="1rem" />
          {importing
            ? t("backgroundImageImporting")
            : t("backgroundImageImport")}
        </button>
        <button
          type="button"
          disabled={disabled || !image}
          onClick={async () => {
            setRemoving(true);
            try {
              await removeBackgroundImage();
              const configuration =
                useAppStore.getState().snapshot?.configuration;
              if (image && configuration && !configuration.backgroundImage) {
                notify(t("backgroundImageRemoved"));
              }
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error), {
                tone: "error",
              });
            } finally {
              setRemoving(false);
            }
          }}
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50"
        >
          <Trash2 size="1rem" />
          {removing ? t("backgroundImageRemoving") : t("backgroundImageRemove")}
        </button>
      </div>
    </section>
  );
}

/** 单轮运行时长上限：以分钟输入，留空表示不限制，失焦时校验并落盘。 */
export function RunDurationField({
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
export function ScopedOptions({
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
            className="space-y-2 rounded-lg border border-line bg-raised p-card"
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

export function TaskSettingSection({
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
        className="flex w-full cursor-pointer items-center justify-between gap-2 p-card text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-[-0.25rem] focus-visible:outline-accent"
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
          className="px-card py-2 text-xs text-ink-muted"
        />
      )}
      {open && (
        <div className="space-y-2 border-t border-line p-card">
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

export function VisibleOptionList({
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

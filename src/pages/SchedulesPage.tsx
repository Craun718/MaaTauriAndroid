import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../components/ScheduleEntryCard";
import { Checkbox } from "../components/ui/Checkbox";
import { DateTimePickerField } from "../components/ui/DateTimePicker";
import { Select } from "../components/ui/Select";
import { TextField } from "../components/ui/TextField";
import { TimePickerField } from "../components/ui/TimePicker";
import {
  deleteScheduleRule,
  getScheduleStatus,
  listScheduleRules,
  saveScheduleRule,
  setScheduleRuleEnabled,
} from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "../lib/i18n";
import {
  createScheduleRule,
  scheduleRuleErrors,
  scheduleTriggerResultKey,
} from "../lib/schedules";
import type {
  ScheduleRule,
  ScheduleRuleStatus,
  ScheduleSummary,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";

const WEEKDAY_KEYS: MessageKey[] = [
  "scheduleWeekdayMonday",
  "scheduleWeekdayTuesday",
  "scheduleWeekdayWednesday",
  "scheduleWeekdayThursday",
  "scheduleWeekdayFriday",
  "scheduleWeekdaySaturday",
  "scheduleWeekdaySunday",
];

const ERROR_KEYS: Record<string, MessageKey> = {
  nameRequired: "scheduleErrorNameRequired",
  runConfigurationRequired: "scheduleErrorRunConfigurationRequired",
  weekdayRequired: "scheduleErrorWeekdayRequired",
  timeRequired: "scheduleErrorTimeRequired",
  timeInvalid: "scheduleErrorTimeInvalid",
  intervalInvalid: "scheduleErrorIntervalInvalid",
};

function currentTimeValue(date = new Date()): string {
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function SchedulesPage() {
  const { t, language } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);
  const snapshot = useAppStore((state) => state.snapshot);
  const [rules, setRules] = useState<ScheduleRuleStatus[]>([]);
  const [status, setStatus] = useState<ScheduleSummary>();
  const [draft, setDraft] = useState<ScheduleRule>();
  const [timeInput, setTimeInput] = useState(() => currentTimeValue());

  const reload = useCallback(async () => {
    const [nextRules, nextStatus] = await Promise.all([
      listScheduleRules(),
      getScheduleStatus(),
    ]);
    setRules(nextRules);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    void reload().catch((error: unknown) =>
      notify(String(error), { tone: "error" }),
    );
  }, [notify, reload]);

  const runConfigurations = snapshot?.configuration.runConfigurations ?? [];
  const configurationItems = useMemo(
    () =>
      runConfigurations.map((configuration) => ({
        value: configuration.id,
        label: configuration.name,
      })),
    [runConfigurations],
  );

  function startNewRule() {
    setTimeInput(currentTimeValue());
    setDraft(
      createScheduleRule(
        snapshot?.configuration.activeRunConfigurationId ??
          runConfigurations[0]?.id ??
          "",
      ),
    );
  }

  async function persistDraft() {
    if (!draft) return;
    const errors = scheduleRuleErrors(draft);
    if (errors.length) {
      notify(t(ERROR_KEYS[errors[0]]), {
        tone: "error",
      });
      return;
    }
    try {
      await saveScheduleRule(draft);
      setDraft(undefined);
      await reload();
    } catch (error) {
      notify(String(error), { tone: "error" });
    }
  }

  async function removeRule(id: string) {
    try {
      await deleteScheduleRule(id);
      await reload();
    } catch (error) {
      notify(String(error), { tone: "error" });
    }
  }

  async function toggleRule(rule: ScheduleRuleStatus, enabled: boolean) {
    try {
      await setScheduleRuleEnabled(rule.id, enabled);
      await reload();
    } catch (error) {
      notify(String(error), { tone: "error" });
    }
  }

  function toggleDay(day: number, checked: boolean) {
    if (draft?.trigger.kind !== "fixedTime") return;
    setDraft({
      ...draft,
      trigger: {
        ...draft.trigger,
        days: checked
          ? [...draft.trigger.days, day].sort((a, b) => a - b)
          : draft.trigger.days.filter((value) => value !== day),
      },
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("scheduleTitle")}</h1>
          <p className="text-sm text-ink-muted">{t("scheduleDescription")}</p>
        </div>
        <button
          type="button"
          onClick={startNewRule}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white"
        >
          <Plus size="1rem" />
          {t("scheduleNewRule")}
        </button>
      </header>

      {draft ? (
        <section className="space-y-4 rounded-md border border-line bg-raised p-3">
          <TextField
            label={t("scheduleName")}
            value={draft.name}
            onValueChange={(name) => setDraft({ ...draft, name })}
          />
          <span
            id="schedule-run-configuration"
            className="block text-sm text-base-content/60"
          >
            {t("scheduleRunConfiguration")}
          </span>
          <Select
            className="mt-1"
            items={configurationItems}
            value={draft.runConfigurationId}
            onValueChange={(runConfigurationId) =>
              setDraft({ ...draft, runConfigurationId })
            }
            labelledBy="schedule-run-configuration"
          />
          <span
            id="schedule-trigger-type"
            className="block text-sm text-base-content/60"
          >
            {t("scheduleTriggerType")}
          </span>
          <Select
            className="mt-1"
            labelledBy="schedule-trigger-type"
            value={draft.trigger.kind}
            items={[
              { value: "fixedTime", label: t("scheduleFixedTime") },
              { value: "interval", label: t("scheduleInterval") },
            ]}
            onValueChange={(kind) => {
              setDraft({
                ...draft,
                trigger:
                  kind === "fixedTime"
                    ? {
                        kind: "fixedTime",
                        days: [1, 2, 3, 4, 5, 6, 7],
                        times: [],
                      }
                    : {
                        kind: "interval",
                        startEpochMs: Date.now() + 60_000,
                        intervalDays: 1,
                        intervalHours: 0,
                      },
              });
            }}
          />

          {draft.trigger.kind === "fixedTime" ? (
            <div className="space-y-3">
              <span className="block text-sm text-base-content/60">
                {t("scheduleWeekdays")}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {WEEKDAY_KEYS.map((key, index) => (
                  <Checkbox
                    key={key}
                    checked={
                      draft.trigger.kind === "fixedTime" &&
                      draft.trigger.days.includes(index + 1)
                    }
                    onCheckedChange={(checked) => toggleDay(index + 1, checked)}
                  >
                    {t(key)}
                  </Checkbox>
                ))}
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-2">
                <div className="flex items-end gap-2">
                  <TimePickerField
                    label={t("scheduleTime")}
                    value={timeInput}
                    onValueChange={setTimeInput}
                    className="min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    aria-label={t("scheduleAddTime")}
                    title={t("scheduleAddTime")}
                    disabled={
                      draft.trigger.kind === "fixedTime" &&
                      draft.trigger.times.includes(timeInput)
                    }
                    className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent text-primary-content transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      if (draft.trigger.kind !== "fixedTime") return;
                      const trigger = draft.trigger;
                      setDraft({
                        ...draft,
                        trigger: {
                          ...trigger,
                          times: [
                            ...new Set([...trigger.times, timeInput]),
                          ].sort(),
                        },
                      });
                    }}
                  >
                    <Plus size="1.125rem" />
                  </button>
                </div>
                {draft.trigger.times.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.trigger.times.map((time) => (
                      <button
                        key={time}
                        type="button"
                        aria-label={`${t("scheduleDelete")} ${time}`}
                        title={`${t("scheduleDelete")} ${time}`}
                        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 text-sm font-medium tabular-nums text-primary transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        onClick={() => {
                          if (draft.trigger.kind !== "fixedTime") return;
                          const trigger = draft.trigger;
                          setDraft({
                            ...draft,
                            trigger: {
                              ...trigger,
                              times: trigger.times.filter(
                                (value) => value !== time,
                              ),
                            },
                          });
                        }}
                      >
                        {time}
                        <X size="0.875rem" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <DateTimePickerField
                label={t("scheduleIntervalStart")}
                value={draft.trigger.startEpochMs}
                onValueChange={(startEpochMs) => {
                  if (draft.trigger.kind !== "interval") return;
                  setDraft({
                    ...draft,
                    trigger: {
                      ...draft.trigger,
                      startEpochMs,
                    },
                  });
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  inputMode="numeric"
                  label={t("scheduleIntervalDays")}
                  value={String(draft.trigger.intervalDays)}
                  onValueChange={(value) => {
                    if (draft.trigger.kind !== "interval") return;
                    setDraft({
                      ...draft,
                      trigger: {
                        ...draft.trigger,
                        intervalDays: nonNegative(value),
                      },
                    });
                  }}
                />
                <TextField
                  inputMode="numeric"
                  label={t("scheduleIntervalHours")}
                  value={String(draft.trigger.intervalHours)}
                  onValueChange={(value) => {
                    if (draft.trigger.kind !== "interval") return;
                    setDraft({
                      ...draft,
                      trigger: {
                        ...draft.trigger,
                        intervalHours: nonNegative(value),
                      },
                    });
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-line px-3"
              onClick={() => setDraft(undefined)}
            >
              {t("scheduleCancel")}
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-accent px-3 font-medium text-white"
              onClick={() => void persistDraft()}
            >
              {t("scheduleSave")}
            </button>
          </div>
        </section>
      ) : null}

      {rules.length === 0 ? (
        <p className="rounded-md border border-line bg-raised p-3 text-sm text-ink-muted">
          {t("scheduleNoRules")}
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <article
              key={rule.id}
              className="space-y-2 rounded-md border border-line bg-raised p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{rule.name}</h2>
                  <p className="text-sm text-ink-muted">
                    {describeTrigger(rule, t)}
                  </p>
                </div>
                <Checkbox
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => void toggleRule(rule, enabled)}
                >
                  <span className="sr-only">{t("enabled")}</span>
                </Checkbox>
              </div>
              <p className="text-sm text-ink-muted">
                {t("scheduleNext")}:{" "}
                {rule.nextTriggerEpochMs
                  ? formatDateTime(rule.nextTriggerEpochMs, language)
                  : t("scheduleNoNext")}
              </p>
              {status?.lastTrigger?.ruleId === rule.id ? (
                <p className="text-sm">
                  {t("scheduleLastTrigger")}:{" "}
                  {t(scheduleTriggerResultKey(status.lastTrigger.result))}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="flex h-9 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm"
                  onClick={() => setDraft(rule)}
                >
                  <Pencil size="1rem" />
                  {t("scheduleEdit")}
                </button>
                <button
                  type="button"
                  className="flex h-9 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-error"
                  onClick={() => void removeRule(rule.id)}
                >
                  <Trash2 size="1rem" />
                  {t("scheduleDelete")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function describeTrigger(
  rule: ScheduleRuleStatus,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
) {
  if (rule.trigger.kind === "interval") {
    const hours = rule.trigger.intervalDays * 24 + rule.trigger.intervalHours;
    return t("scheduleIntervalSummary", { hours });
  }
  return rule.trigger.times.join(", ");
}

function nonNegative(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

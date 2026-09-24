import { ArrowLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "../components/ScheduleEntryCard";
import {
  cleanupRunHistory,
  deleteRunHistory,
  listRunHistory,
  readRunHistory,
} from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import { localizeRunEvent, useTranslation } from "../lib/i18n";
import {
  formatBytes,
  formatDuration,
  isTerminalEvent,
  type RunEventCategory,
  type RunOutcome,
  runDurationMs,
  runEventCategory,
  runOutcome,
  runTasks,
} from "../lib/runHistory";
import type { RunEvent, RunHistoryEntry } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";

const OUTCOME_KEYS: Record<RunOutcome, MessageKey> = {
  completed: "runHistoryOutcomeCompleted",
  cancelled: "runHistoryOutcomeCancelled",
  failed: "runHistoryOutcomeFailed",
  interrupted: "runHistoryOutcomeInterrupted",
};

const OUTCOME_TONES: Record<RunOutcome, string> = {
  completed: "border-accent/40 bg-accent/10 text-accent",
  cancelled: "border-warning/40 bg-warning/10 text-warning",
  interrupted: "border-warning/40 bg-warning/10 text-warning",
  failed: "border-error/40 bg-error/10 text-error",
};

const CATEGORY_KEYS: Record<RunEventCategory, MessageKey> = {
  agent: "runLogAgent",
  focus: "runLogFocus",
  task: "runLogTask",
  status: "runLogStatus",
};

export function RunHistoryPage() {
  const { t, language } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<RunHistoryEntry>();

  const reload = useCallback(async () => {
    try {
      setEntries(await listRunHistory());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload().catch((error: unknown) =>
      notify(String(error), { tone: "error" }),
    );
  }, [notify, reload]);

  if (selected) {
    return (
      <RunHistoryDetail
        entry={selected}
        onBack={() => setSelected(undefined)}
      />
    );
  }

  async function remove(entry: RunHistoryEntry) {
    if (!window.confirm(t("runHistoryDeleteConfirm"))) return;
    try {
      await deleteRunHistory(entry.executionId);
      notify(t("runHistoryDeleted"));
      await reload();
    } catch (error) {
      notify(String(error), { tone: "error" });
    }
  }

  async function cleanup() {
    if (!window.confirm(t("runHistoryCleanupConfirm"))) return;
    try {
      const removed = await cleanupRunHistory();
      notify(t("runHistoryCleanedUp", { count: removed }));
      await reload();
    } catch (error) {
      notify(String(error), { tone: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("runHistoryTitle")}</h1>
          <p className="text-sm text-ink-muted">{t("runHistoryDescription")}</p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => void cleanup()}
            className="h-9 shrink-0 cursor-pointer rounded-md border border-line px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("runHistoryCleanup")}
          </button>
        )}
      </header>

      {!loaded ? null : entries.length === 0 ? (
        <p className="rounded-md border border-line bg-raised p-3 text-sm text-ink-muted">
          {t("runHistoryEmpty")}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.executionId}
              className="flex items-center gap-2 rounded-md border border-line bg-raised p-3 transition-colors hover:bg-surface-muted"
            >
              <button
                type="button"
                onClick={() => setSelected(entry)}
                className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <p className="truncate font-medium">
                  {formatDateTime(entry.startedAtUnixMs, language)}
                </p>
                <p className="text-sm text-ink-muted">
                  {t("runHistoryTaskCount", { count: entry.taskCount })} ·{" "}
                  {formatBytes(entry.sizeBytes)}
                </p>
              </button>
              <button
                type="button"
                aria-label={t("runHistoryDelete")}
                title={t("runHistoryDelete")}
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  void remove(entry);
                }}
                className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-md text-error transition-colors hover:bg-error/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Trash2 size="1rem" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunHistoryDetail({
  entry,
  onBack,
}: {
  entry: RunHistoryEntry;
  onBack: () => void;
}) {
  const { t, language } = useTranslation();
  const [events, setEvents] = useState<RunEvent[]>();
  const [failed, setFailed] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setEvents(undefined);
    setFailed(false);
    setExpandedKey(undefined);
    readRunHistory(entry.executionId)
      .then((loaded) => {
        if (!cancelled) setEvents(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.executionId]);

  if (events === undefined) {
    return failed ? (
      <MissingRecord onBack={onBack} />
    ) : (
      <div aria-hidden className="space-y-4" />
    );
  }
  if (events.length === 0) {
    return <MissingRecord onBack={onBack} />;
  }

  const terminal = events.filter(isTerminalEvent).at(-1);
  const tasks = runTasks(events);
  const outcome = runOutcome(events);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("runHistoryBack")}
          className="flex size-9 flex-none cursor-pointer items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft size="1.25rem" />
        </button>
        <h1 className="min-w-0 truncate text-2xl font-semibold">
          {t("runHistoryTitle")}
        </h1>
      </header>

      <div className="space-y-1 rounded-md border border-line bg-raised p-3">
        <p className="text-sm text-ink-muted">{t("runHistoryStartedAt")}</p>
        <p className="font-medium">
          {formatDateTime(entry.startedAtUnixMs, language)}
        </p>
        {terminal && events.length > 1 ? (
          <>
            <p className="pt-1 text-sm text-ink-muted">
              {t("runHistoryDuration")}
            </p>
            <p className="text-sm">{formatDuration(runDurationMs(events))}</p>
          </>
        ) : null}
        {tasks.length > 0 ? (
          <>
            <p className="pt-1 text-sm text-ink-muted">
              {t("runHistoryTasks")}
            </p>
            <p className="text-sm">
              {tasks.join(language === "zh" ? "、" : ", ")}
            </p>
          </>
        ) : null}
      </div>

      <ol className="space-y-1 rounded-lg border border-line bg-raised p-2">
        {events.map((event) => {
          const key = `${event.executionId}-${event.sequence}`;
          const category = runEventCategory(event);
          const expanded = expandedKey === key;
          const message = localizeRunEvent(event, language);
          return (
            <li key={key} className="text-sm">
              <div className="flex items-start gap-2">
                <time className="w-14 flex-none text-xs text-ink-muted">
                  {new Date(event.atUnixMs).toLocaleTimeString([], {
                    hour12: false,
                  })}
                </time>
                <div className="flex w-16 flex-none flex-col items-start gap-1">
                  <span
                    className={`flex h-5 max-w-full items-center truncate rounded-sm border px-1.5 text-xs font-medium ${
                      category === "focus"
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-line bg-surface-muted text-ink-muted"
                    }`}
                  >
                    {t(CATEGORY_KEYS[category])}
                  </span>
                </div>
                {event.data != null ? (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedKey(expanded ? undefined : key)}
                    className="min-w-0 flex-1 cursor-pointer break-words text-left underline decoration-line underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {message}
                  </button>
                ) : (
                  <p className="min-w-0 flex-1 break-words">{message}</p>
                )}
              </div>
              {expanded ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-line bg-surface-muted p-2 text-xs text-ink-muted">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised p-3">
        <p className="min-w-0 text-sm text-ink-muted">
          {terminal
            ? `${t("runHistoryEndedAt")}: ${formatDateTime(terminal.atUnixMs, language)}`
            : null}
        </p>
        <span
          className={`flex h-6 flex-none items-center rounded-sm border px-2 text-xs font-medium ${OUTCOME_TONES[outcome]}`}
        >
          {t(OUTCOME_KEYS[outcome])}
        </span>
      </div>
    </div>
  );
}

function MissingRecord({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("runHistoryBack")}
          className="flex size-9 flex-none cursor-pointer items-center justify-center rounded-md text-ink transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft size="1.25rem" />
        </button>
        <h1 className="min-w-0 truncate text-2xl font-semibold">
          {t("runHistoryTitle")}
        </h1>
      </header>
      <p className="rounded-md border border-line bg-raised p-3 text-sm text-ink-muted">
        {t("runHistoryMissing")}
      </p>
    </div>
  );
}

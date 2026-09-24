import { listen } from "@tauri-apps/api/event";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { localizeRunEvent, useTranslation } from "../lib/i18n";
import type { RunEvent } from "../lib/types";
import { type RunLogEntry, useRunLogStore } from "../store/runLogStore";
import { RichDescription } from "./RichDescription";

type ActivityTab = "tasks" | "logs";

export type RunActivityTab = ActivityTab;

/** Collects backend run activity even while the task list tab is selected. */
function useRunEvents(): void {
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen<RunEvent>("run-event", (event) => {
      const next = event.payload;
      if (next.kind === "screenshot") return;

      // The store opens a fresh session on the next Preparing event, so this
      // listener does not need to pin the component to one execution.
      useRunLogStore.getState().appendRunEvent(next);
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
}

function eventCategory(event: RunEvent) {
  if (event.data?.source === "python-agent") return "agent";
  if (event.kind === "focus") return "focus";
  if (event.kind === "task") return "task";
  return "status";
}

function logCategory(entry: RunLogEntry) {
  return entry.type === "notification"
    ? entry.tone
    : eventCategory(entry.event);
}

function logLabel(
  entry: RunLogEntry,
  labels: Record<
    "agent" | "error" | "focus" | "status" | "task" | "warning",
    string
  >,
) {
  return labels[logCategory(entry)];
}

export function RunActivityTabs({
  taskList,
  activeTab,
  onActiveTabChange,
}: {
  taskList: ReactNode;
  activeTab: RunActivityTab;
  onActiveTabChange: (tab: RunActivityTab) => void;
}) {
  useRunEvents();
  const events = useRunLogStore((state) => state.entries);
  const { t, language } = useTranslation();
  const groupId = useId();
  const logListRef = useRef<HTMLOListElement>(null);
  const lastEntry = events.at(-1);
  const lastEventKey =
    lastEntry?.type === "run" ? lastEntry.event.sequence : lastEntry?.id;

  useEffect(() => {
    if (lastEventKey === undefined) return;
    if (typeof logListRef.current?.scrollTo === "function") {
      logListRef.current.scrollTo({ top: logListRef.current.scrollHeight });
    }
  }, [lastEventKey]);

  const tabs: Array<{ value: ActivityTab; label: string }> = [
    { value: "tasks", label: t("taskList") },
    { value: "logs", label: t("taskLogs") },
  ];

  return (
    <section className="space-y-2">
      <div
        role="tablist"
        aria-label={t("runActivity")}
        className="tabs tabs-border tabs-xs w-max min-w-full"
      >
        {tabs.map((tab) => {
          const selected = tab.value === activeTab;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${groupId}-${tab.value}-tab`}
              aria-selected={selected}
              aria-controls={`${groupId}-${tab.value}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onActiveTabChange(tab.value)}
              className={`tab min-w-0 flex-1 font-medium${selected ? " tab-active" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${groupId}-tasks-panel`}
        aria-labelledby={`${groupId}-tasks-tab`}
        hidden={activeTab !== "tasks"}
      >
        {taskList}
      </div>

      <div
        role="tabpanel"
        id={`${groupId}-logs-panel`}
        aria-labelledby={`${groupId}-logs-tab`}
        hidden={activeTab !== "logs"}
        className="rounded-lg border border-line bg-raised p-2"
      >
        {events.length === 0 ? (
          <p className="px-1 py-1 text-sm text-ink-muted">{t("noRunLogs")}</p>
        ) : (
          <ol
            ref={logListRef}
            className="max-h-56 space-y-1 overflow-y-auto pr-1"
          >
            {events.map((entry) => {
              const runEvent = entry.type === "run" ? entry.event : undefined;
              const notification =
                entry.type === "notification" ? entry : undefined;
              const stream = runEvent?.data?.stream;
              const category = logCategory(entry);
              const atUnixMs =
                entry.type === "run" ? entry.event.atUnixMs : entry.atUnixMs;
              const taskName = runEvent?.taskName;
              const message =
                entry.type === "run"
                  ? localizeRunEvent(entry.event, language)
                  : entry.message;
              const displayMessage = taskName
                ? `${taskName}: ${message}`
                : message;
              return (
                <li
                  key={
                    runEvent
                      ? `${runEvent.executionId}-${runEvent.sequence}`
                      : (notification?.id ?? "notification")
                  }
                  className="text-sm"
                >
                  <div className="flex items-start gap-2">
                    <time className="w-14 flex-none text-xs text-ink-muted">
                      {new Date(atUnixMs).toLocaleTimeString([], {
                        hour12: false,
                      })}
                    </time>
                    <div className="flex w-16 flex-none flex-col items-start gap-1">
                      <span
                        className={`flex h-5 max-w-full items-center truncate rounded-sm border px-1.5 text-xs font-medium ${
                          category === "focus"
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : category === "error"
                              ? "border-error/40 bg-error/10 text-error"
                              : category === "warning"
                                ? "border-warning/40 bg-warning/10 text-warning"
                                : "border-line bg-surface-muted text-ink-muted"
                        }`}
                      >
                        {logLabel(entry, {
                          agent: t("runLogAgent"),
                          focus: t("runLogFocus"),
                          status: t("runLogStatus"),
                          task: t("runLogTask"),
                          warning: t("runLogWarning"),
                          error: t("runLogError"),
                        })}
                      </span>
                    </div>
                    {category === "focus" ? (
                      <RichDescription
                        text={displayMessage}
                        className="min-w-0 flex-1 break-words text-ink"
                      />
                    ) : (
                      <p
                        className={`min-w-0 flex-1 break-words ${
                          category === "error"
                            ? "text-red-600 dark:text-red-300"
                            : category === "warning"
                              ? "text-warning"
                              : stream === "stderr"
                                ? "text-red-600 dark:text-red-300"
                                : ""
                        }`}
                      >
                        {displayMessage}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

import { listen } from "@tauri-apps/api/event";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../lib/i18n";
import { canAcceptRunEvent } from "../lib/runEvents";
import type { RunEvent } from "../lib/types";

const MAX_RUN_LOG_EVENTS = 300;

type ActivityTab = "tasks" | "logs";

/** Collects run activity even while the task list tab is selected. */
function useRunEvents() {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const executionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen<RunEvent>("run-event", (event) => {
      const next = event.payload;
      if (!canAcceptRunEvent(executionIdRef.current, next.executionId)) return;
      executionIdRef.current = next.executionId;
      if (next.kind === "screenshot") return;

      setEvents((current) => {
        if (current.at(-1)?.executionId === next.executionId) {
          if (current.at(-1)?.sequence === next.sequence) return current;
          return [...current, next].slice(-MAX_RUN_LOG_EVENTS);
        }
        return [next];
      });
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

  return events;
}

function eventCategory(event: RunEvent) {
  if (event.data?.source === "python-agent") return "agent";
  if (event.kind === "focus") return "focus";
  if (event.kind === "task") return "task";
  return "status";
}

function eventLabel(
  event: RunEvent,
  labels: Record<"agent" | "focus" | "status" | "task", string>,
) {
  return labels[eventCategory(event)];
}

export function RunActivityTabs({ taskList }: { taskList: ReactNode }) {
  const events = useRunEvents();
  const activeTabState = useState<ActivityTab>("tasks");
  const [activeTab, setActiveTab] = activeTabState;
  const { t } = useTranslation();
  const groupId = useId();
  const logListRef = useRef<HTMLOListElement>(null);
  const lastEventKey = events.at(-1)?.sequence;

  useEffect(() => {
    if (lastEventKey === undefined) return;
    logListRef.current?.scrollTo({ top: logListRef.current.scrollHeight });
  }, [lastEventKey]);

  const tabs: Array<{ value: ActivityTab; label: string }> = [
    { value: "tasks", label: t("taskList") },
    { value: "logs", label: t("taskLogs") },
  ];

  return (
    <section className="space-y-3">
      <div
        role="tablist"
        aria-label={t("runActivity")}
        className="inline-flex min-w-full gap-1 rounded-md border border-line bg-surface-muted p-1"
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
              onClick={() => setActiveTab(tab.value)}
              className={`h-8 min-w-0 flex-1 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                selected
                  ? "bg-raised text-ink shadow-sm"
                  : "cursor-pointer text-ink-muted hover:bg-raised/60"
              }`}
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
        className="rounded-lg border border-line bg-raised p-3"
      >
        {events.length === 0 ? (
          <p className="px-1 py-2 text-sm text-ink-muted">{t("noRunLogs")}</p>
        ) : (
          <ol
            ref={logListRef}
            className="max-h-64 space-y-1.5 overflow-y-auto pr-1"
          >
            {events.map((event) => {
              const stream = event.data?.stream;
              const category = eventCategory(event);
              return (
                <li
                  key={`${event.executionId}-${event.sequence}`}
                  className="text-sm"
                >
                  <div className="flex items-center gap-2">
                    <time className="w-16 flex-none text-xs text-ink-muted">
                      {new Date(event.atUnixMs).toLocaleTimeString([], {
                        hour12: false,
                      })}
                    </time>
                    <span
                      className={`flex h-5 flex-none items-center rounded-sm border px-1.5 text-xs font-medium ${
                        category === "focus"
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line bg-surface-muted text-ink-muted"
                      }`}
                    >
                      {eventLabel(event, {
                        agent: t("runLogAgent"),
                        focus: t("runLogFocus"),
                        status: t("runLogStatus"),
                        task: t("runLogTask"),
                      })}
                    </span>
                    {event.taskName && (
                      <span className="min-w-0 truncate text-xs font-medium">
                        {event.taskName}
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-0.5 break-words pl-18 ${
                      stream === "stderr"
                        ? "text-red-600 dark:text-red-300"
                        : ""
                    }`}
                  >
                    {event.message}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

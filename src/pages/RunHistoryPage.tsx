import { useCallback, useEffect, useState } from "react";
import {
  cleanupRunHistory,
  deleteRunHistory,
  listRunHistory,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { runHistoryDateGroups } from "../lib/runHistory";
import type { RunHistoryEntry } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";
import { RunHistoryDayAccordion, RunHistoryDetail } from "./run-history/detail";

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
    <div className="space-y-card-gap">
      <header
        className="flex items-start justify-between gap-3"
        data-guide-target="runs-history"
      >
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
        <p className="rounded-md border border-line bg-raised p-card text-sm text-ink-muted">
          {t("runHistoryEmpty")}
        </p>
      ) : (
        <div className="space-y-card-gap">
          {runHistoryDateGroups(entries, language).map((group) => (
            <RunHistoryDayAccordion
              key={group.dateKey || group.entries[0].executionId}
              group={group}
              onSelect={setSelected}
              onRemove={(entry) => void remove(entry)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

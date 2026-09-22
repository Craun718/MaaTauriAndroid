import { CalendarClock, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getScheduleStatus } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { ScheduleSummary } from "../lib/types";

export function ScheduleEntryCard() {
  const { t, language } = useTranslation();
  const [status, setStatus] = useState<ScheduleSummary>();

  useEffect(() => {
    let alive = true;
    getScheduleStatus()
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Link
      to="/schedules"
      className="flex items-center gap-3 rounded-md border border-line bg-raised p-3 text-left transition-colors hover:bg-surface-muted"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
        <CalendarClock size="1.25rem" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{t("scheduleTitle")}</span>
        <span className="block truncate text-sm text-ink-muted">
          {status
            ? t("scheduleEnabledCount", { count: status.enabledCount })
            : t("scheduleDescription")}
        </span>
        {status?.nextTriggerEpochMs ? (
          <span className="mt-0.5 block text-sm text-ink-muted">
            {t("scheduleNext")}:{" "}
            {formatDateTime(status.nextTriggerEpochMs, language)}
          </span>
        ) : null}
      </span>
      <ChevronRight size="1.25rem" className="shrink-0 text-ink-muted" />
    </Link>
  );
}

export function formatDateTime(epochMs: number, language: "zh" | "en") {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

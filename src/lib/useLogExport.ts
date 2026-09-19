import { useState } from "react";
import { useNotificationStore } from "../store/notificationStore";
import { exportLogs as exportLogsRequest } from "./api";
import { useTranslation } from "./i18n";
import type { LogExport } from "./types";

export function useLogExport() {
  const [exporting, setExporting] = useState(false);
  const notify = useNotificationStore((state) => state.notify);
  const { t } = useTranslation();

  async function exportLogs() {
    setExporting(true);
    try {
      const result: LogExport = await exportLogsRequest();
      notify(
        result.fileName
          ? t("logsExported", { name: result.fileName })
          : t("logsExportedPath", { path: result.path }),
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  return { exportLogs, exporting };
}

import { useState } from "react";
import { exportLogs as exportLogsRequest } from "./api";
import type { LogExport } from "./types";

interface LogExportHandlers {
  onSuccess: (result: LogExport) => void;
  onError: (error: unknown) => void;
}

export function useLogExport() {
  const [exporting, setExporting] = useState(false);

  async function exportLogs({ onSuccess, onError }: LogExportHandlers) {
    setExporting(true);
    try {
      onSuccess(await exportLogsRequest());
    } catch (error) {
      onError(error);
    } finally {
      setExporting(false);
    }
  }

  return { exportLogs, exporting };
}

import { error, warn } from "@tauri-apps/plugin-log";

export function formatLogValue(value: unknown): string {
  if (value instanceof DOMException) {
    return `${value.name}: ${value.message} (code ${value.code})`;
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatLogMessage(
  message: string,
  details: readonly unknown[],
): string {
  if (details.length === 0) {
    return message;
  }
  return [message, ...details.map(formatLogValue)].join("\n");
}

export function reportFrontendError(
  message: string,
  ...details: unknown[]
): void {
  console.error(message, ...details);
  void error(formatLogMessage(message, details)).catch(() => {});
}

export function reportFrontendWarning(
  message: string,
  ...details: unknown[]
): void {
  console.warn(message, ...details);
  void warn(formatLogMessage(message, details)).catch(() => {});
}

export function installFrontendErrorLogging(): () => void {
  const handleError = (event: ErrorEvent): void => {
    const detail = event.error ?? event.message;
    void error(`Unhandled frontend error: ${formatLogValue(detail)}`, {
      file: event.filename || undefined,
      line: event.lineno > 0 ? event.lineno : undefined,
      keyValues: event.colno > 0 ? { column: String(event.colno) } : undefined,
    }).catch(() => {});
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    void error(
      `Unhandled promise rejection: ${formatLogValue(event.reason)}`,
    ).catch(() => {});
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}

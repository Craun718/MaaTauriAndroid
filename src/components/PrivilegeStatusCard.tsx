import {
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import {
  getPrivilegedStatus,
  openShizuku,
  requestPrivilegedAccess,
  setPrivilegedBackend,
} from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import { localizeDiagnostic, useTranslation } from "../lib/i18n";
import type { PrivilegedBackend, PrivilegedStatus } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";
import { Select } from "./ui/Select";

type PrivilegeAction = "request" | "openShizuku" | "switch";

const statusCopy: Record<
  PrivilegedStatus["status"],
  {
    label: MessageKey;
    description: MessageKey;
    chip: string;
    dot: string;
  }
> = {
  starting: {
    label: "privilegedStarting",
    description: "privilegedStartingDescription",
    chip: "border-line bg-surface-muted text-ink-muted",
    dot: "bg-ink-muted",
  },
  connected: {
    label: "permissionGranted",
    description: "privilegedConnectedDescription",
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  permissionRequired: {
    label: "permissionRequiredStatus",
    description: "shizukuPermissionDescription",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  notInstalled: {
    label: "shizukuOffline",
    description: "shizukuNotInstalledDescription",
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  disconnected: {
    label: "privilegedDisconnected",
    description: "privilegedDisconnectedDescription",
    chip: "border-line bg-surface-muted text-ink-muted",
    dot: "bg-ink-muted",
  },
  error: {
    label: "privilegedError",
    description: "privilegedErrorDescription",
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
};

const STATUS_POLL_INTERVAL_MS = 500;

const rootStatusCopy: Partial<
  Record<PrivilegedStatus["status"], { description: MessageKey }>
> = {
  starting: { description: "rootStartingDescription" },
  permissionRequired: { description: "rootPermissionDescription" },
  notInstalled: { description: "rootUnavailableDescription" },
  disconnected: { description: "rootDisconnectedDescription" },
  error: { description: "rootErrorDescription" },
};

export function PrivilegeStatusCard({
  title,
  compact = false,
}: {
  title: MessageKey;
  compact?: boolean;
}) {
  const { t, language } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);
  const backendLabelId = useId();
  const [status, setStatus] = useState<PrivilegedStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [pendingAction, setPendingAction] = useState<PrivilegeAction>();
  const [backendOverride, setBackendOverride] = useState<PrivilegedBackend>();

  const refreshStatus = useCallback(async (trackActivity = true) => {
    if (trackActivity) {
      setRefreshing(true);
    }
    try {
      setStatus(await getPrivilegedStatus());
      setStatusError(undefined);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      if (trackActivity) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.status !== "starting") return;

    const pollId = window.setInterval(() => {
      void refreshStatus(false);
    }, STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(pollId);
  }, [refreshStatus, status]);

  useEffect(() => {
    function refreshOnFocus() {
      if (document.visibilityState === "visible") void refreshStatus();
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshStatus]);

  async function runPrivilegeAction(action: PrivilegeAction) {
    if (pendingAction) return;
    setPendingAction(action);
    setStatusError(undefined);
    try {
      if (action === "openShizuku") {
        await openShizuku();
      } else {
        try {
          await requestPrivilegedAccess();
        } finally {
          await refreshStatus();
        }
      }
    } catch (error) {
      notify(
        localizeDiagnostic(
          error instanceof Error ? error.message : String(error),
          language,
        ),
        { tone: "error" },
      );
    } finally {
      setPendingAction(undefined);
    }
  }

  const selectedBackend = backendOverride ?? status?.backend ?? "shizuku";

  async function switchBackend(backend: PrivilegedBackend) {
    if (pendingAction || backend === selectedBackend) return;
    setPendingAction("switch");
    setBackendOverride(backend);
    setStatusError(undefined);
    try {
      await setPrivilegedBackend(backend);
      await refreshStatus();
    } catch (error) {
      notify(
        localizeDiagnostic(
          error instanceof Error ? error.message : String(error),
          language,
        ),
        { tone: "error" },
      );
    } finally {
      setBackendOverride(undefined);
      setPendingAction(undefined);
    }
  }

  const copy = status
    ? {
        ...statusCopy[status.status],
        ...(selectedBackend === "root"
          ? rootStatusCopy[status.status]
          : undefined),
      }
    : undefined;

  return (
    <section
      className={`rounded-lg border border-line bg-raised ${
        compact ? "space-y-2 p-3" : "space-y-3 p-4"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size="1.125rem" className="text-accent" />
          <h2 className="font-medium">{t(title)}</h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshStatus()}
          disabled={refreshing || pendingAction !== undefined}
          className={`flex items-center justify-center rounded-md border border-line text-ink-muted disabled:opacity-50 ${
            compact ? "h-7 w-7" : "h-8 w-8"
          }`}
          aria-label={t("refreshStatus")}
        >
          <RefreshCw
            size="0.875rem"
            className={
              refreshing || pendingAction !== undefined
                ? "animate-spin"
                : undefined
            }
          />
        </button>
      </div>

      <div className="space-y-1.5">
        <p id={backendLabelId} className="text-sm font-medium">
          {t("privilegedBackend")}
        </p>
        <Select
          labelledBy={backendLabelId}
          compact
          disabled={pendingAction !== undefined || refreshing}
          value={selectedBackend}
          items={[
            { value: "shizuku", label: t("backendShizuku") },
            { value: "root", label: t("backendRoot") },
          ]}
          onValueChange={(value) =>
            void switchBackend(value as PrivilegedBackend)
          }
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          {selectedBackend === "root" ? t("backendRoot") : t("backendShizuku")}
        </span>
        <span
          className={`flex flex-none items-center gap-2 rounded-md border text-xs font-medium ${
            compact ? "h-7 px-2" : "h-8 px-2.5"
          } ${copy?.chip ?? "border-line bg-surface-muted text-ink-muted"}`}
        >
          {copy ? (
            <span className={`h-2 w-2 rounded-full ${copy.dot}`} />
          ) : (
            <LoaderCircle size="0.75rem" className="animate-spin" />
          )}
          {copy ? t(copy.label) : t("checking")}
        </span>
      </div>

      <p className="text-sm text-ink-muted">
        {copy ? t(copy.description) : t("checking")}
      </p>

      {status?.status === "error" && (
        <p className="break-all text-xs text-ink-muted">{status.message}</p>
      )}

      {selectedBackend === "shizuku" && (
        <button
          type="button"
          onClick={() => void runPrivilegeAction("openShizuku")}
          disabled={pendingAction !== undefined || refreshing}
          className={`flex w-full items-center justify-center gap-2 rounded-md border border-accent font-medium text-accent disabled:opacity-50 ${
            compact ? "h-8" : "h-9"
          }`}
        >
          {pendingAction === "openShizuku" ? (
            <LoaderCircle size="0.875rem" className="animate-spin" />
          ) : (
            <ExternalLink size="0.875rem" />
          )}
          {t("openShizuku")}
        </button>
      )}

      <button
        type="button"
        onClick={() => void runPrivilegeAction("request")}
        disabled={pendingAction !== undefined || refreshing}
        className={`flex w-full items-center justify-center gap-2 rounded-md border border-accent font-medium text-accent disabled:opacity-50 ${
          compact ? "h-8" : "h-9"
        }`}
      >
        {pendingAction === "request" ? (
          <LoaderCircle size="0.875rem" className="animate-spin" />
        ) : (
          <KeyRound size="0.875rem" />
        )}
        {selectedBackend === "root"
          ? t("requestRootAccess")
          : t("requestPermission")}
      </button>

      {statusError && (
        <p className="flex items-start gap-2 break-all text-sm text-red-600 dark:text-red-300">
          <CircleAlert size="1rem" className="mt-0.5 shrink-0" />
          {statusError}
        </p>
      )}
    </section>
  );
}

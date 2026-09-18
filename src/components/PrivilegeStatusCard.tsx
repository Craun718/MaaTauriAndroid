import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import {
  getPrivilegedStatus,
  openShizuku,
  requestPrivilegedAccess,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n";
import type { PrivilegedStatus } from "../lib/types";

type PrivilegeAction = "request" | "openShizuku" | "retry";

const statusCopy: Record<
  PrivilegedStatus["status"],
  {
    label: MessageKey;
    description: MessageKey;
    action?: PrivilegeAction;
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
    action: "request",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  notInstalled: {
    label: "shizukuOffline",
    description: "shizukuNotInstalledDescription",
    action: "openShizuku",
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  disconnected: {
    label: "privilegedDisconnected",
    description: "privilegedDisconnectedDescription",
    action: "retry",
    chip: "border-line bg-surface-muted text-ink-muted",
    dot: "bg-ink-muted",
  },
  error: {
    label: "privilegedError",
    description: "privilegedErrorDescription",
    action: "retry",
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
};

const actionCopy: Record<PrivilegeAction, MessageKey> = {
  request: "requestPermission",
  openShizuku: "openShizuku",
  retry: "retryConnection",
};

export function PrivilegeStatusCard({ title }: { title: MessageKey }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PrivilegedStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await getPrivilegedStatus());
      setStatusError(undefined);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

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
    if (actionPending) return;
    setActionPending(true);
    setStatusError(undefined);
    try {
      if (action === "openShizuku") {
        await openShizuku();
      } else {
        await requestPrivilegedAccess();
        await refreshStatus();
      }
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPending(false);
    }
  }

  const copy = status ? statusCopy[status.status] : undefined;
  const action = copy?.action;
  const ActionIcon =
    action === "openShizuku" ? ExternalLink : action === "retry" ? RotateCw : ShieldCheck;

  return (
    <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-accent" />
          <h2 className="font-medium">{t(title)}</h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshStatus()}
          disabled={refreshing}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink-muted disabled:opacity-50"
          aria-label={t("refreshStatus")}
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{t("shizuku")}</span>
        <span
          className={`flex h-8 flex-none items-center gap-2 rounded-md border px-2.5 text-xs font-medium ${
            copy?.chip ?? "border-line bg-surface-muted text-ink-muted"
          }`}
        >
          {copy ? (
            <span className={`h-2 w-2 rounded-full ${copy.dot}`} />
          ) : (
            <LoaderCircle size={12} className="animate-spin" />
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

      {action && action !== "request" && (
        <button
          type="button"
          onClick={() => void runPrivilegeAction(action)}
          disabled={actionPending || refreshing}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-accent font-medium text-accent disabled:opacity-50"
        >
          {actionPending ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <ActionIcon size={16} />
          )}
          {t(actionCopy[action])}
        </button>
      )}

      <button
        type="button"
        onClick={() => void runPrivilegeAction("request")}
        disabled={actionPending || refreshing}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-accent font-medium text-accent disabled:opacity-50"
      >
        {actionPending ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <ShieldCheck size={16} />
        )}
        {t("requestPermission")}
      </button>

      {statusError && (
        <p className="flex items-start gap-2 break-all text-sm text-red-600 dark:text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          {statusError}
        </p>
      )}
    </section>
  );
}

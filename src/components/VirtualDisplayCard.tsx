import { listen } from "@tauri-apps/api/event";
import {
  LoaderCircle,
  Maximize2,
  MonitorPlay,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getVirtualDisplayStatus,
  setVirtualDisplayLandscape,
  stopRun,
  stopVirtualDisplay,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { VirtualDisplayStatus } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { VirtualDisplayPreview } from "./VirtualDisplayPreview";

export function VirtualDisplayCard() {
  const [status, setStatus] = useState<VirtualDisplayStatus>();
  const [, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const { t } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);
  const showTouchMarkers = useAppStore(
    (state) => state.snapshot?.configuration.showVirtualDisplayTouches ?? true,
  );

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      setStatus(await getVirtualDisplayStatus());
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
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen("virtual-display-changed", () => {
      void refreshStatus();
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
  }, [refreshStatus]);

  useEffect(() => {
    function refreshOnFocus() {
      if (document.visibilityState === "visible") void refreshStatus();
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.active === false) setFullscreen(false);
  }, [status?.active]);

  useEffect(() => {
    if (!fullscreen || status?.active !== true) return;

    let disposed = false;
    setVirtualDisplayLandscape(true).catch(() => undefined);

    return () => {
      if (disposed) return;
      disposed = true;
      void setVirtualDisplayLandscape(false).catch(() => undefined);
    };
  }, [fullscreen, status?.active]);

  async function stopDisplay() {
    if (actionPending) return;
    setActionPending(true);
    setStatusError(undefined);
    try {
      await stopRun();
      setStatus(await stopVirtualDisplay());
    } catch (error) {
      await refreshStatus();
      notify(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setActionPending(false);
    }
  }

  const active = status?.active === true;
  const geometry =
    active && status
      ? t("virtualDisplayGeometry", {
          width: status.width,
          height: status.height,
        })
      : undefined;
  const statusLabel = status
    ? active
      ? t("virtualDisplayRunning")
      : t("virtualDisplayStopped")
    : t("checking");

  return (
    <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorPlay size={18} className="text-accent" />
          <h2 className="min-w-0 truncate font-medium">
            {t("virtualDisplay")}
          </h2>
          <span
            className={`flex h-6 flex-none items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${
              active
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-line bg-surface-muted text-ink-muted"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                active ? "bg-accent" : "bg-ink-muted"
              }`}
            />
            {statusLabel}
          </span>
          {geometry && (
            <span className="flex-none text-xs text-ink-muted">{geometry}</span>
          )}
        </div>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={refreshing}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-muted disabled:opacity-50"
            aria-label={t("refreshStatus")}
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : undefined}
            />
          </button>
          {active && (
            <button
              type="button"
              onClick={() => setFullscreen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-muted"
              aria-label={t("virtualDisplayFullscreen")}
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {active && status && !fullscreen ? (
        <VirtualDisplayPreview
          status={status}
          showTouchMarkers={showTouchMarkers}
          interactive={false}
          className="aspect-[2/1] w-full rounded-md border border-line"
        />
      ) : (
        <div className="aspect-[2/1] w-full rounded-md border border-line bg-surface-muted" />
      )}

      {active && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="min-w-0 text-xs text-ink-muted">
            {t("displayId", { id: status?.displayId ?? -1 })}
          </p>
          <button
            type="button"
            onClick={() => void stopDisplay()}
            disabled={actionPending || refreshing || status === undefined}
            className="flex h-8 flex-none items-center justify-center gap-2 rounded-md border border-red-500/50 px-2.5 font-medium text-red-600 disabled:opacity-50 dark:text-red-300"
          >
            {actionPending ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Square size={14} />
            )}
            {t("stop")}
          </button>
        </div>
      )}

      {fullscreen &&
        active &&
        status &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-surface">
            <div className="absolute inset-0 flex flex-col pb-[calc(1rem_+_env(safe-area-inset-bottom))] pt-[calc(3.5rem_+_env(safe-area-inset-top))]">
              <VirtualDisplayPreview
                status={status}
                showTouchMarkers={showTouchMarkers}
                className="h-full w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="absolute right-4 top-[calc(0.75rem_+_env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-md border border-line bg-raised text-ink-muted"
              aria-label={t("virtualDisplayExitFullscreen")}
            >
              <X size={16} />
            </button>
          </div>,
          document.body,
        )}
    </section>
  );
}

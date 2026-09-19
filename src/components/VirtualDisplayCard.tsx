import { listen } from "@tauri-apps/api/event";
import {
  CircleAlert,
  LoaderCircle,
  MonitorPlay,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVirtualDisplayStatus,
  stopVirtualDisplay,
  updateVirtualDisplayBounds,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { VirtualDisplayStatus } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";

export function VirtualDisplayCard() {
  const previewRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef(0);
  const [status, setStatus] = useState<VirtualDisplayStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const { t } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);

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
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshStatus]);

  const reportBounds = useCallback(() => {
    if (status?.active !== true) return;
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    void updateVirtualDisplayBounds(
      bounds.left,
      bounds.top,
      bounds.width,
      bounds.height,
    ).catch((error: unknown) => {
      setStatusError(error instanceof Error ? error.message : String(error));
    });
  }, [status?.active]);

  const scheduleBoundsReport = useCallback(() => {
    if (animationRef.current !== 0) return;
    animationRef.current = window.requestAnimationFrame(() => {
      animationRef.current = 0;
      reportBounds();
    });
  }, [reportBounds]);

  useEffect(() => {
    reportBounds();
  }, [reportBounds]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(scheduleBoundsReport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scheduleBoundsReport]);

  useEffect(() => {
    const scrollOptions: AddEventListenerOptions = {
      passive: true,
      capture: true,
    };
    window.addEventListener("resize", scheduleBoundsReport);
    window.addEventListener("scroll", scheduleBoundsReport, scrollOptions);
    window.visualViewport?.addEventListener("resize", scheduleBoundsReport);
    window.visualViewport?.addEventListener("scroll", scheduleBoundsReport, {
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", scheduleBoundsReport);
      window.removeEventListener("scroll", scheduleBoundsReport, scrollOptions);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleBoundsReport,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleBoundsReport,
      );
    };
  }, [scheduleBoundsReport]);

  useEffect(
    () => () => {
      if (animationRef.current !== 0) {
        window.cancelAnimationFrame(animationRef.current);
        animationRef.current = 0;
      }
    },
    [],
  );

  async function stopDisplay() {
    if (actionPending) return;
    setActionPending(true);
    setStatusError(undefined);
    try {
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
    <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
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
      </div>

      <div
        ref={previewRef}
        className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted"
      />

      {active && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="min-w-0 text-xs text-ink-muted">
            {t("displayId", { id: status.displayId })}
          </p>
          <button
            type="button"
            onClick={() => void stopDisplay()}
            disabled={actionPending || refreshing || status === undefined}
            className="flex h-9 flex-none items-center justify-center gap-2 rounded-md border border-red-500/50 px-3 font-medium text-red-600 disabled:opacity-50 dark:text-red-300"
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

      {statusError && (
        <p className="flex items-start gap-2 break-all text-sm text-red-600 dark:text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          {statusError}
        </p>
      )}
    </section>
  );
}

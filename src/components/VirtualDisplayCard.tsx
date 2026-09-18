import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  LoaderCircle,
  MonitorPlay,
  RefreshCw,
  Square,
} from "lucide-react";
import {
  getVirtualDisplayStatus,
  stopVirtualDisplay,
  updateVirtualDisplayBounds,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { VirtualDisplayStatus } from "../lib/types";

export function VirtualDisplayCard() {
  const previewRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef(0);
  const activeRef = useRef(false);
  const [status, setStatus] = useState<VirtualDisplayStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const { t } = useTranslation();

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
    if (!activeRef.current) return;
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

  useEffect(() => {
    activeRef.current = status?.active === true;
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
    window.addEventListener("resize", scheduleBoundsReport);
    window.addEventListener("scroll", scheduleBoundsReport, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleBoundsReport);
    window.visualViewport?.addEventListener("scroll", scheduleBoundsReport, {
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", scheduleBoundsReport);
      window.removeEventListener("scroll", scheduleBoundsReport);
      window.visualViewport?.removeEventListener("resize", scheduleBoundsReport);
      window.visualViewport?.removeEventListener("scroll", scheduleBoundsReport);
    };
  }, [scheduleBoundsReport]);

  useEffect(() => () => {
    if (animationRef.current !== 0) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
  }, []);

  async function stopDisplay() {
    if (actionPending) return;
    setActionPending(true);
    setStatusError(undefined);
    try {
      setStatus(await stopVirtualDisplay());
    } catch (error) {
      await refreshStatus();
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPending(false);
    }
  }

  const active = status?.active === true;
  const geometry = status
    ? t("virtualDisplayGeometry", { width: status.width, height: status.height })
    : t("checking");

  return (
    <section className="space-y-3 rounded-lg border border-line bg-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MonitorPlay size={18} className="text-accent" />
          <h2 className="font-medium">{t("virtualDisplay")}</h2>
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

      <div
        ref={previewRef}
        className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted"
      >
        <span className="text-xs font-medium text-ink-muted">
          {active ? t("virtualDisplayRunning") : t("virtualDisplayStopped")}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{geometry}</p>
          <p className="text-xs text-ink-muted">
            {status?.active
              ? t("displayId", { id: status.displayId })
              : t("virtualDisplayStopped")}
          </p>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => void stopDisplay()}
            disabled={actionPending || refreshing || status === undefined}
            className="flex h-10 flex-none items-center justify-center gap-2 rounded-md border border-red-500/50 px-4 font-medium text-red-600 disabled:opacity-50 dark:text-red-300"
          >
            {actionPending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Square size={16} />
            )}
            {t("stop")}
          </button>
        )}
      </div>

      {statusError && (
        <p className="flex items-start gap-2 break-all text-sm text-red-600 dark:text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          {statusError}
        </p>
      )}
    </section>
  );
}

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
import { Modal } from "./ui/Modal";
import { VirtualDisplayPreview } from "./VirtualDisplayPreview";

export function VirtualDisplayCard() {
  const [status, setStatus] = useState<VirtualDisplayStatus>();
  const [, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [confirmStopOpen, setConfirmStopOpen] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const { t } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);
  const showTouchMarkers = useAppStore(
    (state) => state.snapshot?.configuration.showVirtualDisplayTouches ?? true,
  );
  const showFps = useAppStore(
    (state) => state.snapshot?.configuration.showVirtualDisplayFps ?? true,
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
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    listen<{ fps: number | null }>("virtual-display-fps", (event) => {
      setFps(event.payload.fps ?? null);
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
  }, []);

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

  function confirmStopDisplay() {
    setConfirmStopOpen(false);
    void stopDisplay();
  }

  const active = status?.active === true;
  // Corner badge on top of the preview. The card copy sizes in rem so it
  // follows the root font scaling; the fullscreen copy keeps physical px
  // like the exit button next to it (immersive overlay, see below).
  const fpsBadge = (fullscreenLayout: boolean) =>
    active && showFps && fps !== null ? (
      <div
        className={`pointer-events-none select-none tabular-nums ${
          fullscreenLayout
            ? "absolute left-[12px] top-[12px] rounded-[6px] border border-line bg-raised/90 px-[10px] py-[4px] text-[13px] font-medium text-ink"
            : "absolute left-2 top-2 rounded-md border border-line bg-raised/90 px-1.5 py-0.5 text-xs font-medium text-ink"
        }`}
      >
        {Math.round(fps)} FPS
      </div>
    ) : null;
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
          <MonitorPlay size="1.125rem" className="text-accent" />
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
              size="0.875rem"
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
              <Maximize2 size="0.875rem" />
            </button>
          )}
        </div>
      </div>

      {active && status && !fullscreen ? (
        <div className="relative">
          <VirtualDisplayPreview
            status={status}
            showTouchMarkers={showTouchMarkers}
            interactive={false}
            className="aspect-[2/1] w-full rounded-md border border-line"
          />
          {fpsBadge(false)}
        </div>
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
            onClick={() => setConfirmStopOpen(true)}
            disabled={actionPending || refreshing || status === undefined}
            className="flex h-8 flex-none items-center justify-center gap-2 rounded-md border border-red-500/50 px-2.5 font-medium text-red-600 disabled:opacity-50 dark:text-red-300"
          >
            {actionPending ? (
              <LoaderCircle size="0.875rem" className="animate-spin" />
            ) : (
              <Square size="0.875rem" />
            )}
            {t("stop")}
          </button>
        </div>
      )}

      <Modal
        open={confirmStopOpen}
        onClose={() => setConfirmStopOpen(false)}
        title={t("virtualDisplayStopTitle")}
      >
        <p className="text-sm">{t("virtualDisplayStopWarning")}</p>
        <p className="text-xs text-ink-muted">{t("virtualDisplayStopHint")}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmStopOpen(false)}
            className="h-10 rounded-md border border-line px-3"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={confirmStopDisplay}
            className="h-10 rounded-md border border-red-500/50 px-3 font-medium text-red-600 dark:text-red-300"
          >
            {t("confirm")}
          </button>
        </div>
      </Modal>

      {fullscreen &&
        active &&
        status &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-surface">
            {/* 全屏层是沉浸式画面：视频满出血铺满视口（横屏高度只有 ~369 CSS px，
                任何 padding 都会显著压缩 16:9 画面的等比尺寸），退出按钮浮在画面上、
                钉物理 px 并保留 safe-area 偏移，不参与根字号的等比放大。 */}
            <div className="absolute inset-0">
              <VirtualDisplayPreview
                status={status}
                showTouchMarkers={showTouchMarkers}
                className="h-full w-full"
              />
              {fpsBadge(true)}
            </div>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="absolute right-[16px] top-[calc(12px_+_var(--tt-safe-top))] flex h-[36px] w-[36px] items-center justify-center rounded-[6px] border border-line bg-raised text-ink-muted"
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

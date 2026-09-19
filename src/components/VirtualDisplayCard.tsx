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
  getVirtualDisplayStream,
  stopVirtualDisplay,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { VirtualDisplayStatus } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";

type StreamConfig = {
  type: "config";
  codec: string;
  width: number;
  height: number;
};

type StreamVideoFrame = {
  displayWidth: number;
  displayHeight: number;
  close: () => void;
};

type StreamDecoder = {
  state: "unconfigured" | "configured" | "closed";
  configure: (config: {
    codec: string;
    optimizeForLatency: boolean;
    avc?: { format: "avc" | "annexb" };
  }) => void;
  decode: (chunk: unknown) => void;
  close: () => void;
};

type WebCodecsGlobal = {
  VideoDecoder?: new (init: {
    output: (frame: StreamVideoFrame) => void;
    error: (error: Error) => void;
  }) => StreamDecoder;
  EncodedVideoChunk?: new (init: {
    type: "key" | "delta";
    timestamp: number;
    data: BufferSource;
  }) => unknown;
};

type StreamState =
  | "connecting"
  | "ready"
  | "unavailable"
  | "unsupported"
  | "error";

export function VirtualDisplayCard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<VirtualDisplayStatus>();
  const [, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
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
      window.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.active !== true) return;

    let socket: WebSocket | undefined;
    let decoder: StreamDecoder | undefined;
    let disposed = false;
    setStreamState("connecting");

    async function connect() {
      const webCodecs = window as unknown as WebCodecsGlobal;
      const encodedChunkConstructor = webCodecs.EncodedVideoChunk;
      if (!webCodecs.VideoDecoder || !encodedChunkConstructor) {
        setStreamState("unsupported");
        return;
      }

      const stream = await getVirtualDisplayStream();
      if (disposed) return;
      if (!stream.url) {
        setStreamState("unavailable");
        return;
      }

      decoder = new webCodecs.VideoDecoder({
        output(frame) {
          const canvas = canvasRef.current;
          if (!canvas) {
            frame.close();
            return;
          }
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            frame.close();
            return;
          }
          context.drawImage(frame as unknown as CanvasImageSource, 0, 0);
          frame.close();
        },
        error() {
          setStreamState("error");
        },
      });

      socket = new WebSocket(stream.url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (!disposed) setStreamState("connecting");
      };
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (disposed) return;

        if (typeof event.data === "string") {
          try {
            const config = JSON.parse(event.data) as StreamConfig;
            if (
              config.type !== "config" ||
              !config.codec ||
              decoder?.state === "closed"
            ) {
              return;
            }
            decoder?.configure({
              codec: config.codec,
              optimizeForLatency: true,
              avc: { format: "annexb" },
            });
            setStreamState("ready");
          } catch {
            setStreamState("error");
          }
          return;
        }

        if (decoder?.state !== "configured") return;
        try {
          const view = new DataView(event.data);
          const flags = view.getUint8(0);
          const timestamp = Number(view.getBigUint64(1));
          const chunk = new encodedChunkConstructor({
            type: flags & 1 ? "key" : "delta",
            timestamp,
            data: event.data.slice(9),
          });
          decoder.decode(chunk);
        } catch {
          setStreamState("error");
        }
      };
      socket.onerror = () => {
        if (!disposed) setStreamState("error");
      };
      socket.onclose = () => {
        if (!disposed) {
          setStreamState((current) =>
            current === "connecting" ? "error" : current,
          );
        }
      };
    }

    connect().catch(() => {
      if (!disposed) setStreamState("error");
    });

    return () => {
      disposed = true;
      if (
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [status?.active]);

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
  const streamLabel = active
    ? {
        connecting: t("virtualDisplayStreamConnecting"),
        ready: "",
        unavailable: t("virtualDisplayStreamUnavailable"),
        unsupported: t("virtualDisplayCodecUnsupported"),
        error: t("virtualDisplayStreamError"),
      }[streamState]
    : undefined;

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

      <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted">
        <canvas
          ref={canvasRef}
          className="h-full w-full object-contain"
          aria-label={t("virtualDisplay")}
        />
        {streamLabel && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-surface-muted/90 px-3 py-2 text-xs text-ink-muted">
            {streamState === "connecting" ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : (
              <CircleAlert size={12} />
            )}
            {streamLabel}
          </div>
        )}
      </div>

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
    </section>
  );
}

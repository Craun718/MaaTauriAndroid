import { CircleAlert, LoaderCircle } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getVirtualDisplayStream,
  setVirtualDisplayTouchMarkers,
  touchVirtualDisplay,
} from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { VirtualDisplayStatus } from "../lib/types";
import {
  VIRTUAL_DISPLAY_TOUCH_MARKER_TTL_MS,
  VirtualDisplayMoveScheduler,
  VirtualDisplayPointerSlots,
  VirtualDisplayTouchMarkerTimeline,
  virtualDisplayPoint,
} from "../lib/virtualDisplayTouch";
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

export type StreamState =
  | "connecting"
  | "ready"
  | "unavailable"
  | "unsupported"
  | "error";

type PreviewTouchAction = 6 | 7 | 8;

export function VirtualDisplayPreview({
  status,
  showTouchMarkers,
  interactive = true,
  className,
}: {
  status: VirtualDisplayStatus;
  showTouchMarkers: boolean;
  interactive?: boolean;
  className: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerCanvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  const pointerSlots = useRef(new VirtualDisplayPointerSlots());
  const lastPoints = useRef(new Map<number, { x: number; y: number }>());
  const touchMarkers = useRef(new VirtualDisplayTouchMarkerTimeline());
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const { t } = useTranslation();
  const notify = useNotificationStore((state) => state.notify);

  statusRef.current = status;

  const dispatchTouch = useCallback(
    async (
      action: PreviewTouchAction,
      x: number,
      y: number,
      contact: number,
      visibleFailure: boolean,
    ): Promise<boolean> => {
      const current = statusRef.current;
      if (!current.active) return false;
      try {
        const result = await touchVirtualDisplay({
          contact,
          displayId: current.displayId,
          x,
          y,
          action,
        });
        if (result.accepted) return true;
        throw new Error(result.message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (visibleFailure) {
          notify(message, { tone: "error" });
        } else {
          console.error("Virtual display touch failed", error);
        }
        return false;
      }
    },
    [notify],
  );

  const moveScheduler = useRef(
    new VirtualDisplayMoveScheduler((moves) => {
      moves.forEach(({ contact, x, y }) => {
        void dispatchTouch(7, x, y, contact, false);
      });
    }),
  );

  useEffect(() => {
    if (status.active !== true) return;

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
        error(error) {
          console.error("Virtual display decoder failed", error);
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
          } catch (error) {
            console.error("Virtual display stream config failed", error);
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
        } catch (error) {
          console.error("Virtual display stream frame failed", error);
          setStreamState("error");
        }
      };
      socket.onerror = (event) => {
        if (disposed) return;
        console.error("Virtual display stream socket failed", event);
        setStreamState("error");
      };
      socket.onclose = (event) => {
        if (!disposed) {
          console.warn(
            "Virtual display stream socket closed",
            event.code,
            event.reason,
            event.wasClean,
          );
          setStreamState((current) =>
            current === "connecting" ? "error" : current,
          );
        }
      };
    }

    connect().catch((error) => {
      if (disposed) return;
      console.error("Virtual display stream connection failed", error);
      setStreamState("error");
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
  }, [status.active]);

  useEffect(() => {
    if (status.active === false) {
      pointerSlots.current.clear();
      lastPoints.current.clear();
      moveScheduler.current.clear();
      return;
    }

    return () => {
      const slots = pointerSlots.current;
      slots.releaseHeld((contact, x, y) => {
        void dispatchTouch(8, x, y, contact, false);
      });
      lastPoints.current.clear();
      moveScheduler.current.clear();
    };
  }, [dispatchTouch, status.active]);

  useEffect(() => {
    if (showTouchMarkers === false || status.active !== true) {
      touchMarkers.current.clear();
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const markers = await setVirtualDisplayTouchMarkers(true);
        if (!disposed) {
          touchMarkers.current.append(markers, performance.now());
        }
      } catch (error) {
        console.warn("Virtual display touch markers unavailable", error);
      }
      if (!disposed) {
        timer = window.setTimeout(poll, 100);
      }
    }

    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      touchMarkers.current.clear();
      void setVirtualDisplayTouchMarkers(false).catch(() => undefined);
    };
  }, [showTouchMarkers, status.active]);

  useEffect(() => {
    if (showTouchMarkers === false || status.active !== true) return;

    const canvas = markerCanvasRef.current;
    if (!canvas) return;
    canvas.width = status.width;
    canvas.height = status.height;

    let frame: number | undefined;
    function draw(now: number) {
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const theme = getComputedStyle(canvas);
      const accent = theme.getPropertyValue("--color-accent").trim();
      const error = theme.getPropertyValue("--color-error").trim();
      const center = theme.getPropertyValue("--color-primary-content").trim();
      const markers = touchMarkers.current.active(now);

      context.clearRect(0, 0, canvas.width, canvas.height);
      markers.forEach((marker) => {
        const progress = Math.min(
          1,
          Math.max(
            0,
            (now - marker.receivedAt) / VIRTUAL_DISPLAY_TOUCH_MARKER_TTL_MS,
          ),
        );
        const alpha = 1 - progress;
        const x =
          ((marker.x + 0.5) / Math.max(1, canvas.width - 1)) * canvas.width;
        const y =
          ((marker.y + 0.5) / Math.max(1, canvas.height - 1)) * canvas.height;

        if (marker.contact <= 0) {
          context.beginPath();
          context.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
          context.lineWidth = Math.max(1, canvas.width / 640);
          context.arc(x, y, canvas.width / 70, 0, Math.PI * 2);
          context.stroke();
        }

        context.beginPath();
        context.strokeStyle = marker.action === 1 ? error : accent;
        context.globalAlpha = alpha;
        context.lineWidth = Math.max(1, canvas.width / 500);
        context.arc(x, y, canvas.width / 90, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.fillStyle = center;
        context.arc(x, y, Math.max(1, canvas.width / 300), 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      });

      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [showTouchMarkers, status.active, status.width, status.height]);

  function mapPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const current = statusRef.current;
    return virtualDisplayPoint(
      event.clientX - canvas.getBoundingClientRect().left,
      event.clientY - canvas.getBoundingClientRect().top,
      { width: canvas.clientWidth, height: canvas.clientHeight },
      { width: current.width, height: current.height },
    );
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = mapPoint(event);
    if (!point.inside) return;
    const pointerId = event.pointerId;
    const contact = pointerSlots.current.acquire(pointerId);
    if (contact < 0) return;
    event.currentTarget.setPointerCapture(pointerId);
    lastPoints.current.set(pointerId, { x: point.x, y: point.y });
    pointerSlots.current.remember(pointerId, point.x, point.y);
    void dispatchTouch(6, point.x, point.y, contact, true).then((accepted) => {
      if (!accepted) {
        pointerSlots.current.release(pointerId);
        lastPoints.current.delete(pointerId);
      }
    });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const contact = pointerSlots.current.contact(event.pointerId);
    if (contact < 0) return;
    const point = mapPoint(event);
    const previous = lastPoints.current.get(event.pointerId);
    if (previous?.x === point.x && previous.y === point.y) return;
    lastPoints.current.set(event.pointerId, { x: point.x, y: point.y });
    pointerSlots.current.remember(event.pointerId, point.x, point.y);
    moveScheduler.current.move({ contact, x: point.x, y: point.y });
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const contact = pointerSlots.current.contact(event.pointerId);
    if (contact < 0) return;
    const point = mapPoint(event);
    lastPoints.current.set(event.pointerId, { x: point.x, y: point.y });
    pointerSlots.current.remember(event.pointerId, point.x, point.y);
    void dispatchTouch(8, point.x, point.y, contact, true).finally(() => {
      pointerSlots.current.release(event.pointerId);
      lastPoints.current.delete(event.pointerId);
    });
  }

  const streamLabel = {
    connecting: t("virtualDisplayStreamConnecting"),
    ready: "",
    unavailable: t("virtualDisplayStreamUnavailable"),
    unsupported: t("virtualDisplayCodecUnsupported"),
    error: t("virtualDisplayStreamError"),
  }[streamState];

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden [container-type:size] ${className}`}
    >
      <div
        className={
          status.width > 0 && status.height > 0
            ? "relative"
            : "relative h-full w-full"
        }
        style={
          status.width > 0 && status.height > 0
            ? {
                aspectRatio: `${status.width} / ${status.height}`,
                width: `min(100cqw, ${
                  (status.width / status.height) * 100
                }cqh)`,
              }
            : undefined
        }
      >
        <canvas
          ref={canvasRef}
          className={`h-full w-full object-contain ${
            interactive ? "touch-none" : "pointer-events-none"
          }`}
          aria-label={t("virtualDisplay")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
        {status.active && showTouchMarkers && (
          <div className="pointer-events-none absolute inset-0">
            <canvas
              ref={markerCanvasRef}
              className="h-full w-full object-contain"
            />
          </div>
        )}
      </div>
      {streamState !== "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-surface-muted/90 px-3 py-2 text-xs text-ink-muted">
          {streamState === "connecting" ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <CircleAlert size={12} />
          )}
          {streamLabel}
        </div>
      )}
    </div>
  );
}

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

interface LongPressOptions {
  onLongPress: () => void;
  delayMs?: number;
  movementTolerance?: number;
  disabled?: boolean;
}

interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}

const DEFAULT_DELAY_MS = 450;
const DEFAULT_MOVEMENT_TOLERANCE = 6;
const INTERACTIVE_TARGET_SELECTOR =
  "button, input, label, select, textarea, [role='button']";

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(INTERACTIVE_TARGET_SELECTOR) !== null
  );
}

/** Long-press handler that leaves normal taps, scrolling, and child controls alone. */
export function useLongPress({
  onLongPress,
  delayMs = DEFAULT_DELAY_MS,
  movementTolerance = DEFAULT_MOVEMENT_TOLERANCE,
  disabled = false,
}: LongPressOptions): LongPressHandlers {
  const timerRef = useRef<number | undefined>(undefined);
  const originRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const latest = useRef({ onLongPress, disabled });
  latest.current = { onLongPress, disabled };

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    originRef.current = undefined;
  }, []);

  useEffect(() => cancel, [cancel]);

  const open = useCallback(() => {
    cancel();
    if (!latest.current.disabled) latest.current.onLongPress();
  }, [cancel]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (latest.current.disabled) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;

      cancel();
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(open, delayMs);
    },
    [cancel, delayMs, open],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      if (!origin) return;

      const distance = Math.hypot(
        event.clientX - origin.x,
        event.clientY - origin.y,
      );
      if (distance > movementTolerance) cancel();
    },
    [cancel, movementTolerance],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (latest.current.disabled || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      open();
    },
    [open],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
  };
}

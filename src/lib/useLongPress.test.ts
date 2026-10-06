import { act, renderHook } from "@testing-library/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./useLongPress";

function pointerEvent(target: Element, x = 10, y = 10) {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    pointerType: "touch",
    target,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

describe("useLongPress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens after a still press", () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onPointerDown(
        pointerEvent(document.createElement("article")),
      );
      vi.advanceTimersByTime(450);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("cancels when the pointer moves beyond the tolerance", () => {
    const onLongPress = vi.fn();
    const target = document.createElement("article");
    const { result } = renderHook(() =>
      useLongPress({ onLongPress, movementTolerance: 6 }),
    );

    act(() => {
      result.current.onPointerDown(pointerEvent(target));
      result.current.onPointerMove(pointerEvent(target, 13, 12));
      result.current.onPointerMove(pointerEvent(target, 17, 13));
      vi.advanceTimersByTime(450);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("cancels on release and unmount", () => {
    const onLongPress = vi.fn();
    const target = document.createElement("article");
    const { result, unmount } = renderHook(() => useLongPress({ onLongPress }));

    act(() => {
      result.current.onPointerDown(pointerEvent(target));
      result.current.onPointerUp();
      vi.advanceTimersByTime(450);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      result.current.onPointerDown(pointerEvent(target));
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores presses and context menus on child controls", () => {
    const onLongPress = vi.fn();
    const button = document.createElement("button");
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    const contextEvent = {
      preventDefault: vi.fn(),
      target: button,
    } as unknown as ReactMouseEvent<HTMLElement>;

    act(() => {
      result.current.onPointerDown(pointerEvent(button));
      vi.advanceTimersByTime(450);
      result.current.onContextMenu(contextEvent);
    });

    expect(onLongPress).not.toHaveBeenCalled();
    expect(contextEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("supports context menu as the desktop entry point", () => {
    const onLongPress = vi.fn();
    const target = document.createElement("article");
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    const contextEvent = {
      preventDefault: vi.fn(),
      target,
    } as unknown as ReactMouseEvent<HTMLElement>;

    act(() => {
      result.current.onContextMenu(contextEvent);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(contextEvent.preventDefault).toHaveBeenCalled();
  });
});

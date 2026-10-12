import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoldCountdown } from "./useHoldCountdown";

describe("useHoldCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the hold window down to zero and stops there", () => {
    const { result } = renderHook(() => useHoldCountdown(true, 5000));

    expect(result.current).toBe(5);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(4);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current).toBe(0);
  });

  it("stays at zero while inactive", () => {
    const { result } = renderHook(() => useHoldCountdown(false, 5000));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it("ignores an empty hold window", () => {
    const { result } = renderHook(() => useHoldCountdown(true, 0));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it("restarts when it is activated again", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useHoldCountdown(active, 5000),
      { initialProps: { active: true } },
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);

    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBe(5);
  });
});

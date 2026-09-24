import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySafeAreaOverrides,
  safeAreaOverrides,
  syncSafeAreaInsets,
} from "./safe-area";

const windowInsets = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({ windowInsets }));

describe("safe-area overrides", () => {
  beforeEach(() => {
    windowInsets.mockReset();
    document.documentElement.style.cssText = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds max() variables preferring the larger of env and the native reading", () => {
    expect(safeAreaOverrides({ top: 120, bottom: 48 })).toEqual({
      "--tt-safe-top": "max(env(safe-area-inset-top, 0px), 120px)",
      "--tt-safe-bottom": "max(env(safe-area-inset-bottom, 0px), 48px)",
    });
  });

  it("clamps negative and fractional native insets", () => {
    expect(safeAreaOverrides({ top: -3, bottom: 47.6 })).toEqual({
      "--tt-safe-top": "max(env(safe-area-inset-top, 0px), 0px)",
      "--tt-safe-bottom": "max(env(safe-area-inset-bottom, 0px), 48px)",
    });
  });

  it("applies the variables to the document element", () => {
    applySafeAreaOverrides({ top: 90, bottom: 48 });
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-top"),
    ).toBe("max(env(safe-area-inset-top, 0px), 90px)");
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-bottom"),
    ).toBe("max(env(safe-area-inset-bottom, 0px), 48px)");
  });

  it("syncs insets over IPC", async () => {
    windowInsets.mockResolvedValue({ top: 120, bottom: 48 });
    await syncSafeAreaInsets();
    expect(windowInsets).toHaveBeenCalled();
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-bottom"),
    ).toBe("max(env(safe-area-inset-bottom, 0px), 48px)");
  });

  it("converts the native physical px reading to CSS px via devicePixelRatio", async () => {
    vi.stubGlobal("devicePixelRatio", 3.25);
    windowInsets.mockResolvedValue({ top: 130, bottom: 52 });
    await syncSafeAreaInsets();
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-top"),
    ).toBe("max(env(safe-area-inset-top, 0px), 40px)");
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-bottom"),
    ).toBe("max(env(safe-area-inset-bottom, 0px), 16px)");
  });

  it("falls back to a 1:1 conversion when devicePixelRatio is unavailable", async () => {
    vi.stubGlobal("devicePixelRatio", undefined);
    windowInsets.mockResolvedValue({ top: 120, bottom: 48 });
    await syncSafeAreaInsets();
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-top"),
    ).toBe("max(env(safe-area-inset-top, 0px), 120px)");
  });

  it("keeps the env-only defaults when the bridge reports nothing", async () => {
    windowInsets.mockResolvedValue(null);
    await syncSafeAreaInsets();
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-top"),
    ).toBe("");
  });

  it("survives a failed IPC call", async () => {
    windowInsets.mockRejectedValue(new Error("bridge offline"));
    await expect(syncSafeAreaInsets()).resolves.toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--tt-safe-top"),
    ).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { pipEligible, pipSourceRect } from "./virtualDisplayPip";

const ready = {
  enabled: true,
  foreground: false,
  running: true,
  fullscreen: false,
  ready: true,
  status: {
    active: true,
    displayId: 12,
    width: 1280,
    height: 720,
    frameCount: 1,
  },
};

describe("automatic PiP eligibility", () => {
  it("arms a ready background preview during a run", () => {
    expect(pipEligible(ready)).toBe(true);
  });

  it.each([
    { enabled: false },
    { foreground: true },
    { running: false },
    { fullscreen: true },
    { ready: false },
    { status: undefined },
    { status: { ...ready.status, active: false } },
    { status: { ...ready.status, width: 0 } },
    { status: { ...ready.status, height: 0 } },
  ])("disarms when a prerequisite fails: %j", (change) => {
    expect(pipEligible({ ...ready, ...change })).toBe(false);
  });
});

describe("PiP animation source rectangle", () => {
  it("converts viewport CSS pixels to physical pixels exactly once", () => {
    expect(
      pipSourceRect(
        { left: 10, top: 20, right: 110, bottom: 80 },
        { width: 400, height: 800 },
        3,
      ),
    ).toEqual({ left: 30, top: 60, right: 330, bottom: 240 });
  });

  it("clips a partially scrolled preview to the visible viewport", () => {
    expect(
      pipSourceRect(
        { left: -5, top: -10, right: 500, bottom: 100 },
        { width: 400, height: 800 },
        2,
      ),
    ).toEqual({ left: 0, top: 0, right: 800, bottom: 200 });
  });

  it("omits hints for offscreen previews and invalid geometry", () => {
    const viewport = { width: 400, height: 800 };
    expect(
      pipSourceRect(
        { left: 0, top: 900, right: 400, bottom: 1000 },
        viewport,
        2,
      ),
    ).toBeNull();
    expect(
      pipSourceRect({ left: 0, top: 0, right: 1, bottom: 1 }, viewport, 0),
    ).toBeNull();
    expect(
      pipSourceRect({ left: NaN, top: 0, right: 1, bottom: 1 }, viewport, 2),
    ).toBeNull();
  });
});

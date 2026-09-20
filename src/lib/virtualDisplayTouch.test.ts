import { describe, expect, it, vi } from "vitest";
import {
  VirtualDisplayMoveScheduler,
  VirtualDisplayPointerSlots,
  VirtualDisplayTouchMarkerTimeline,
  virtualDisplayPoint,
} from "./virtualDisplayTouch";

describe("virtualDisplayPoint", () => {
  const display = { width: 1280, height: 720 };

  it("maps the centre of a matching layout without an offset", () => {
    const point = virtualDisplayPoint(640, 360, display, display);
    expect(point).toEqual({ x: 640, y: 360, inside: true });
  });

  it("accounts for horizontal black bars", () => {
    const point = virtualDisplayPoint(
      100,
      360,
      { width: 1600, height: 720 },
      display,
    );
    expect(point).toEqual({ x: 0, y: 360, inside: false });
  });

  it("accounts for vertical black bars", () => {
    const point = virtualDisplayPoint(
      640,
      99,
      { width: 1280, height: 920 },
      display,
    );
    expect(point).toEqual({ x: 640, y: 0, inside: false });
  });

  it("clamps an active pointer that leaves the image", () => {
    const point = virtualDisplayPoint(-20, 900, display, display);
    expect(point).toEqual({ x: 0, y: 719, inside: false });
  });
});

describe("VirtualDisplayTouchMarkerTimeline", () => {
  function marker(id: number) {
    return { id, x: id, y: id * 2, action: 0, contact: 0 };
  }

  it("keeps recently received markers in identifier order", () => {
    const timeline = new VirtualDisplayTouchMarkerTimeline();

    timeline.append([marker(2)], 0);
    timeline.append([marker(1)], 20);

    expect(timeline.active(20).map((item) => item.id)).toEqual([1, 2]);
  });

  it("expires markers after the visual lifetime", () => {
    const timeline = new VirtualDisplayTouchMarkerTimeline();

    timeline.append([marker(1)], 0);
    expect(timeline.active(599)).toHaveLength(1);
    expect(timeline.active(600)).toHaveLength(0);
  });

  it("limits trails so long gestures do not grow without bound", () => {
    const timeline = new VirtualDisplayTouchMarkerTimeline();

    timeline.append(
      Array.from({ length: 24 }, (_, index) => marker(index + 1)),
      0,
    );

    const markers = timeline.active(0);
    expect(markers).toHaveLength(16);
    expect(markers[0].id).toBe(9);
    expect(markers.at(-1)?.id).toBe(24);
  });
});

describe("VirtualDisplayPointerSlots", () => {
  it("allocates manual contacts from the high end and reuses ids", () => {
    const slots = new VirtualDisplayPointerSlots();
    expect(slots.acquire(10)).toBe(15);
    expect(slots.acquire(11)).toBe(14);
    expect(slots.acquire(10)).toBe(15);
    expect(slots.release(10)).toBe(15);
    expect(slots.acquire(12)).toBe(15);
  });

  it("clears held contacts when the preview is closed", () => {
    const slots = new VirtualDisplayPointerSlots();
    slots.acquire(1);
    slots.acquire(2);
    slots.remember(1, 100, 200);
    slots.remember(2, 30, 40);
    const released: Array<[number, number, number]> = [];
    slots.releaseHeld((contact, x, y) => released.push([contact, x, y]));
    expect(released).toEqual([
      [15, 100, 200],
      [14, 30, 40],
    ]);
    expect(slots.contact(1)).toBe(-1);
  });
});

describe("VirtualDisplayMoveScheduler", () => {
  it("keeps only the latest move for each contact in a frame", () => {
    const callback = vi.fn();
    const frames: Array<() => void> = [];
    const requestAnimationFrame = vi.fn((render: () => void) => {
      frames.push(render);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);

    try {
      const scheduler = new VirtualDisplayMoveScheduler(callback);
      scheduler.move({ contact: 15, x: 1, y: 1 });
      scheduler.move({ contact: 14, x: 2, y: 2 });
      scheduler.move({ contact: 15, x: 3, y: 3 });

      expect(frames).toHaveLength(1);
      frames[0]?.();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith([
        { contact: 15, x: 3, y: 3 },
        { contact: 14, x: 2, y: 2 },
      ]);
      expect(scheduler.flush()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

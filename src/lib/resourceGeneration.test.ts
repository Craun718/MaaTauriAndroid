import { describe, expect, it, vi } from "vitest";
import {
  advanceResourceGeneration,
  resourceGeneration,
  subscribeResourceGeneration,
} from "./resourceGeneration";

describe("resourceGeneration", () => {
  it("notifies subscribers and exposes the new value", () => {
    const before = resourceGeneration();
    const listener = vi.fn();
    const unsubscribe = subscribeResourceGeneration(listener);

    const after = advanceResourceGeneration();

    expect(after).toBe(before + 1);
    expect(resourceGeneration()).toBe(after);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    advanceResourceGeneration();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

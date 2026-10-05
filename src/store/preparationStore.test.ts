import { describe, expect, it } from "vitest";
import type { PreparationState } from "../lib/types";
import { acceptPreparationState } from "./preparationStore";

function state(revision: number, changes: Partial<PreparationState> = {}) {
  return {
    revision,
    status: "running",
    stage: "installingProject",
    projectReady: false,
    uiReady: false,
    engineReady: false,
    ...changes,
  } satisfies PreparationState;
}

describe("acceptPreparationState", () => {
  it("accepts the first native snapshot", () => {
    const next = state(0);

    expect(acceptPreparationState(undefined, next)).toBe(next);
  });

  it("drops stale events and duplicate queries", () => {
    const current = state(7, { uiReady: true });

    expect(acceptPreparationState(current, state(6))).toBe(current);
    expect(acceptPreparationState(current, state(7))).toBe(current);
  });

  it("accepts a newer retry revision", () => {
    const current = state(7, {
      status: "failed",
      stage: "failed",
      error: "extract failed",
    });
    const next = state(8, { stage: "retrying" });

    expect(acceptPreparationState(current, next)).toBe(next);
  });
});

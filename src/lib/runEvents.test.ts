import { describe, expect, it } from "vitest";
import { canAcceptRunEvent } from "./runEvents";

describe("canAcceptRunEvent", () => {
  it("accepts events while no run has been selected", () => {
    expect(canAcceptRunEvent(undefined, "run-1")).toBe(true);
  });

  it("accepts only the selected execution", () => {
    expect(canAcceptRunEvent("run-1", "run-1")).toBe(true);
    expect(canAcceptRunEvent("run-1", "run-2")).toBe(false);
  });
});

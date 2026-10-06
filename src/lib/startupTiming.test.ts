import { describe, expect, it, vi } from "vitest";
import { createStartupTrace, formatStartupStageTiming } from "./startupTiming";

describe("startup timing", () => {
  it("formats stable stage lines", () => {
    expect(
      formatStartupStageTiming({
        stage: "frontend_ui_ready",
        elapsedMs: 123,
      }),
    ).toBe("startup stage=frontend_ui_ready elapsed_ms=123");
  });

  it("records each stage once in elapsed order", () => {
    let value = 0;
    const now = vi.fn(() => {
      value += 37.4;
      return value;
    });
    const trace = createStartupTrace(now);
    const lines: string[] = [];

    trace.record("frontend_bootstrap");
    trace.record("frontend_bootstrap");
    trace.record("frontend_prepare_app_return");
    trace.record("frontend_parse");
    trace.record("frontend_ui_ready");
    trace.flush((line) => lines.push(line));
    trace.flush((line) => lines.push(line));

    expect(lines).toEqual([
      "startup stage=frontend_bootstrap elapsed_ms=37",
      "startup stage=frontend_prepare_app_return elapsed_ms=75",
      "startup stage=frontend_parse elapsed_ms=112",
      "startup stage=frontend_ui_ready elapsed_ms=150",
    ]);
  });
});

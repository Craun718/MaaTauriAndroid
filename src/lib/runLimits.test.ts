import { describe, expect, it } from "vitest";
import {
  formatRunLimitMinutes,
  MAX_RUN_DURATION_MINUTES,
  parseRunLimitInput,
  runLimitSeconds,
} from "./runLimits";

describe("formatRunLimitMinutes", () => {
  it("renders nothing while the limit is disabled", () => {
    expect(formatRunLimitMinutes(undefined)).toBe("");
    expect(formatRunLimitMinutes(0)).toBe("");
    expect(formatRunLimitMinutes(Number.NaN)).toBe("");
  });

  it("renders stored seconds as whole minutes", () => {
    expect(formatRunLimitMinutes(1_800)).toBe("30");
  });
});

describe("parseRunLimitInput", () => {
  it("treats blank and zero as unlimited", () => {
    expect(parseRunLimitInput("")).toEqual({ kind: "unlimited" });
    expect(parseRunLimitInput("   ")).toEqual({ kind: "unlimited" });
    expect(parseRunLimitInput("0")).toEqual({ kind: "unlimited" });
  });

  it("accepts whole minutes up to the maximum", () => {
    expect(parseRunLimitInput(" 45 ")).toEqual({
      kind: "minutes",
      minutes: 45,
    });
    expect(parseRunLimitInput(String(MAX_RUN_DURATION_MINUTES))).toEqual({
      kind: "minutes",
      minutes: MAX_RUN_DURATION_MINUTES,
    });
  });

  it("rejects fractions, signs, units and out-of-range values", () => {
    for (const input of [
      "12.5",
      "-5",
      "30m",
      "1e3",
      String(MAX_RUN_DURATION_MINUTES + 1),
      "99999999999999999999",
    ]) {
      expect(parseRunLimitInput(input)).toEqual({ kind: "invalid" });
    }
  });
});

describe("runLimitSeconds", () => {
  it("maps the parsed field onto the configuration value", () => {
    expect(runLimitSeconds({ kind: "unlimited" })).toBe(0);
    expect(runLimitSeconds({ kind: "invalid" })).toBe(0);
    expect(runLimitSeconds({ kind: "minutes", minutes: 30 })).toBe(1_800);
  });
});

import { describe, expect, it } from "vitest";
import type { UpdateFailureCode } from "./types";
import {
  formatUpdateBytes,
  updateFailureKey,
  updateProgressPercent,
} from "./updateMessages";

describe("updateFailureKey", () => {
  it("maps every backend failure code to a catalog key", () => {
    const codes: UpdateFailureCode[] = [
      "network",
      "invalidResponse",
      "cdkRequired",
      "cdkInvalid",
      "cdkExpired",
      "cdkDisabled",
      "cdkQuotaExceeded",
      "cdkMismatch",
      "resourceNotFound",
      "resourceUnavailable",
      "invalidDigest",
      "noMatchingAsset",
      "downloadFailed",
      "storage",
      "installerNotFound",
      "internal",
    ];
    for (const code of codes) {
      expect(updateFailureKey(code)).toMatch(/^updateFailure/);
    }
  });

  it("maps each code to a distinct key", () => {
    const codes: UpdateFailureCode[] = [
      "network",
      "invalidResponse",
      "cdkRequired",
      "cdkInvalid",
      "cdkExpired",
      "cdkDisabled",
      "cdkQuotaExceeded",
      "cdkMismatch",
      "resourceNotFound",
      "resourceUnavailable",
      "invalidDigest",
      "noMatchingAsset",
      "downloadFailed",
      "storage",
      "installerNotFound",
      "internal",
    ];
    const keys = codes.map(updateFailureKey);
    expect(new Set(keys).size).toBe(codes.length);
  });
});

describe("formatUpdateBytes", () => {
  it("renders unknown sizes as empty text", () => {
    expect(formatUpdateBytes(null)).toBe("");
  });

  it("renders kilobytes below one megabyte", () => {
    expect(formatUpdateBytes(512)).toBe("1 KB");
    expect(formatUpdateBytes(500 * 1024)).toBe("500 KB");
  });

  it("renders megabytes above one megabyte", () => {
    expect(formatUpdateBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatUpdateBytes(80 * 1024 * 1024)).toBe("80.0 MB");
  });
});

describe("updateProgressPercent", () => {
  it("has no percentage without a total", () => {
    expect(updateProgressPercent(1024, null)).toBeNull();
    expect(updateProgressPercent(null, 1024)).toBeNull();
  });

  it("treats a zero or negative total as indeterminate", () => {
    expect(updateProgressPercent(0, 0)).toBeNull();
    expect(updateProgressPercent(100, -5)).toBeNull();
  });

  it("scales the downloaded fraction to 0-100", () => {
    expect(updateProgressPercent(0, 1000)).toBe(0);
    expect(updateProgressPercent(250, 1000)).toBe(25);
    expect(updateProgressPercent(999, 1000)).toBe(99);
  });

  it("clamps at 100 when the download overshoots the total", () => {
    expect(updateProgressPercent(1100, 1000)).toBe(100);
  });
});

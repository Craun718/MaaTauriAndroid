import { describe, expect, it } from "vitest";
import { resolveResourceVersion } from "./resource-version";

describe("resolveResourceVersion", () => {
  it("uses the resource checkout tag", () => {
    expect(resolveResourceVersion("v4.9.0")).toBe("v4.9.0");
  });

  it("uses the short commit hash supplied for an untagged checkout", () => {
    expect(resolveResourceVersion("abc1234")).toBe("abc1234");
  });

  it("trims the build identity", () => {
    expect(resolveResourceVersion(" v4.9.0 \n")).toBe("v4.9.0");
    expect(resolveResourceVersion(" abc1234 \n")).toBe("abc1234");
  });

  it.each([undefined, "", " \t\n "])(
    "returns no version when the build identity is missing or blank (%j)",
    (missingTag) => {
      expect(resolveResourceVersion(missingTag)).toBeUndefined();
    },
  );
});

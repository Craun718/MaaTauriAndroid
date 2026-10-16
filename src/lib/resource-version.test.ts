import { describe, expect, it } from "vitest";
import { resolveResourceVersion } from "./resource-version";

describe("resolveResourceVersion", () => {
  it("prefers the project release version over the build identity", () => {
    expect(resolveResourceVersion("4.9.0", "abc1234")).toBe("4.9.0");
  });

  it("uses the project version without a build identity", () => {
    expect(resolveResourceVersion("4.9.0")).toBe("4.9.0");
  });

  it("trims the project release version", () => {
    expect(resolveResourceVersion(" 4.9.0 \n", "v4.8.0")).toBe("4.9.0");
  });

  it.each([undefined, "", " \t\n "])(
    "falls back to the build identity when the project version is %j",
    (projectVersion) => {
      expect(resolveResourceVersion(projectVersion, " v4.9.0 ")).toBe("v4.9.0");
      expect(resolveResourceVersion(projectVersion, "abc1234")).toBe("abc1234");
    },
  );

  it.each([undefined, "", " \t\n "])(
    "returns no version when both sources are missing or blank (%j)",
    (missingVersion) => {
      for (const missingTag of [undefined, "", " \t\n "]) {
        const version = resolveResourceVersion(missingVersion, missingTag);
        expect(version).toBeUndefined();
      }
    },
  );
});

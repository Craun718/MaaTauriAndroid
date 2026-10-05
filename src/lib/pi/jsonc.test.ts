import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc";

describe("parseJsonc", () => {
  it("parses comments and trailing commas", () => {
    expect(
      parseJsonc(
        `{
          // project interface
          "name": "fixture", /* trailing comma follows */
        }`,
        "interface.jsonc",
      ),
    ).toEqual({ name: "fixture" });
  });

  it("rejects malformed documents instead of warning", () => {
    expect(() => parseJsonc("{", "interface.jsonc")).toThrow(
      "could not parse interface.jsonc",
    );
  });
});

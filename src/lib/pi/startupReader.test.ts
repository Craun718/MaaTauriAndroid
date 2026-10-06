import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSource } from "./rawTypes";
import { createStartupProjectTextReader } from "./startupReader";

const readResults = vi.hoisted(() => vi.fn());

vi.mock("../api", () => ({
  readProjectTextResults: readResults,
}));

function result(path: string, text: string) {
  return { path, text };
}

describe("startup Project Interface reader", () => {
  beforeEach(() => {
    readResults.mockReset();
  });

  it("batches the interface, direct imports, locales, and nested imports", async () => {
    readResults
      .mockResolvedValueOnce([
        result(
          "interface.json",
          JSON.stringify({
            import: ["settings.json", "tasks.json"],
            languages: { en_us: "en_us.json" },
          }),
        ),
      ])
      .mockResolvedValueOnce([
        result("settings.json", JSON.stringify({ import: ["advanced.json"] })),
        result("tasks.json", JSON.stringify({ task: [] })),
        result("en_us.json", JSON.stringify({ label: "Tasks" })),
      ])
      .mockResolvedValueOnce([
        result("advanced.json", JSON.stringify({ setting: [] })),
      ]);

    const reader = createStartupProjectTextReader();
    await reader.preloadInterface("interface.json");

    expect(readResults.mock.calls).toEqual([
      [["interface.json"]],
      [["settings.json", "tasks.json", "en_us.json"]],
      [["advanced.json"]],
    ]);
    await Promise.all([
      expect(reader("interface.json")).resolves.toContain("settings"),
      expect(reader("advanced.json")).resolves.toContain("setting"),
      expect(reader("en_us.json")).resolves.toContain("Tasks"),
    ]);
    expect(readResults).toHaveBeenCalledTimes(3);
  });

  it("rejects required import failures", async () => {
    readResults.mockResolvedValueOnce([
      {
        path: "interface.json",
        text: JSON.stringify({ import: ["missing.json"] }),
      },
    ]);
    readResults.mockResolvedValueOnce([
      { path: "missing.json", error: "entity not found" },
    ]);

    const reader = createStartupProjectTextReader();
    await expect(reader.preloadInterface("interface.json")).rejects.toThrow(
      "entity not found",
    );
  });

  it("treats metadata bodies as optional while caching successful reads", async () => {
    const source: ProjectSource = {
      root: "/project",
      languages: ["en_us"],
      translations: {},
      document: {
        welcome: "./WELCOME.md",
        contact: "CONTACT",
        license: "./LICENSE",
      },
    };
    readResults.mockResolvedValueOnce([
      result("WELCOME.md", "# Welcome"),
      result("CONTACT", "Contact body"),
      { path: "LICENSE", error: "entity not found" },
    ]);

    const reader = createStartupProjectTextReader();
    await reader.preloadMetadata(source, "en_us");
    await expect(reader("WELCOME.md")).resolves.toBe("# Welcome");
    await expect(reader("CONTACT")).resolves.toBe("Contact body");
    expect(readResults).toHaveBeenCalledTimes(1);
  });
});

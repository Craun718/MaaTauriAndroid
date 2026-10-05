import { describe, expect, it } from "vitest";
import { loadProjectSource } from "./loader";
import type { RawJsonObject } from "./rawTypes";

function reader(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const content = files[path];
    if (content === undefined) {
      throw new Error(`could not read ${path}`);
    }
    return content;
  };
}

describe("loadProjectSource", () => {
  it("parses JSONC and recursively merges imports", async () => {
    const source = await loadProjectSource(
      "/project",
      reader({
        "interface.json": `{
          // the top-level document owns project identity
          "interface_version": 2,
          "name": "profiled",
          "import": ["settings.jsonc"],
          "task": [{"name": "Main"}],
          "option": {"Mode": {"cases": [{"name": "Fast"}]}},
          "global_option": ["Mode"],
        }`,
        "settings.jsonc": `{
          "import": ["tasks.jsonc"],
          "setting": [{"name": "Advanced"}],
        }`,
        "tasks.jsonc": `{
          "task": [{"name": "Imported"}],
          "option": {"Mode": {"cases": [{"name": "Slow"}]}},
        }`,
      }),
    );

    expect(source.document.task).toEqual([
      { name: "Main" },
      { name: "Imported" },
    ]);
    expect(source.document.setting).toEqual([{ name: "Advanced" }]);
    const option = source.document.option as RawJsonObject | undefined;
    expect(option?.Mode).toEqual({ cases: [{ name: "Slow" }] });
    expect(source.languages).toEqual([]);
    expect(source.translations).toEqual({});
  });

  it("fails when an imported document cannot be read", async () => {
    await expect(
      loadProjectSource(
        "/project",
        reader({
          "interface.json": `{"import": ["missing.json"]}`,
        }),
      ),
    ).rejects.toThrow("could not read missing.json");
  });

  it("loads valid locale objects and keeps malformed language keys", async () => {
    const source = await loadProjectSource(
      "/project",
      reader({
        "interface.json": `{
          "languages": {
            "zh_cn": "zh_cn.jsonc",
            "en_us": 7
          }
        }`,
        "zh_cn.jsonc": `{"$label": "配置项目", "ignored": 3,}`,
      }),
    );

    expect(source.languages).toEqual(["en_us", "zh_cn"]);
    expect(source.translations).toEqual({
      zh_cn: { $label: "配置项目" },
    });
  });
});

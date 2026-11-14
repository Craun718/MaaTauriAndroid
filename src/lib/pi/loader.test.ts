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
  it("keeps the first group and global option when imports repeat them", async () => {
    const source = await loadProjectSource(
      "/project",
      reader({
        "interface.json": JSON.stringify({
          import: ["first.json", "second.json"],
          group: [{ name: "daily", label: "Main" }],
          global_option: ["Mode"],
          task: [{ name: "Main" }],
        }),
        "first.json": JSON.stringify({
          import: ["nested.json"],
          group: [
            { name: "daily", label: "Imported" },
            { name: "extra", label: "First" },
          ],
          global_option: ["Mode", "Extra"],
        }),
        "nested.json": JSON.stringify({
          group: [{ name: "extra", label: "Nested" }],
          global_option: ["Extra", "Nested"],
        }),
        "second.json": JSON.stringify({
          group: [{ name: "daily", label: "Second" }],
          global_option: ["Nested", "Last"],
          task: [{ name: "Main" }],
        }),
      }),
    );
    expect(source.document.group).toEqual([
      { name: "daily", label: "Main" },
      { name: "extra", label: "First" },
    ]);
    expect(source.document.global_option).toEqual([
      "Mode",
      "Extra",
      "Nested",
      "Last",
    ]);
    expect(source.document.task).toEqual([{ name: "Main" }, { name: "Main" }]);
  });

  it("merges single and array pretask declarations in import order", async () => {
    const source = await loadProjectSource(
      "/project",
      reader({
        "interface.json": JSON.stringify({
          pretask: { exec: "main" },
          import: ["first.json", "second.json"],
        }),
        "first.json": JSON.stringify({ pretask: [{ exec: "first" }] }),
        "second.json": JSON.stringify({ pretask: { exec: "second" } }),
      }),
    );
    expect(source.document.pretask).toEqual([
      { exec: "main" },
      { exec: "first" },
      { exec: "second" },
    ]);
  });

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

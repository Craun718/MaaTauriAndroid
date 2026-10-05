import { describe, expect, it } from "vitest";
import { buildAndroidProject } from "./adapter";
import type { ProjectSource, ProjectTextReader } from "./rawTypes";

const files: Record<string, string> = {
  CONTACT: "Contact body",
  LICENSE: "License body",
  "WELCOME.md": "# Local announcement",
  "en_us.json": JSON.stringify({
    $label: "Profiled Project",
    "preset.start": "Start every day",
    "input.placeholder": "Enter a value",
  }),
};

const reader: ProjectTextReader = async (path) => {
  const content = files[path];
  if (content === undefined) throw new Error(`could not read ${path}`);
  return content;
};

function source(): ProjectSource {
  return {
    root: "/project",
    languages: ["en_us", "zh_cn"],
    translations: {
      en_us: {
        label: "Profiled Project",
        "preset.start": "Start every day",
        "input.placeholder": "Enter a value",
        welcome: "Welcome body",
      },
      zh_cn: { label: "配置项目" },
    },
    document: {
      interface_version: 2,
      name: "profiled",
      label: "$label",
      languages: {
        en_us: "en_us.json",
        zh_cn: "zh_cn.json",
      },
      controller: [
        { name: "PC", type: "Win32" },
        { name: "ADB", type: "adb" },
      ],
      resource: [
        {
          name: "base",
          label: "$label",
          path: ["resource/base"],
          controller: ["ADB"],
        },
      ],
      task: [
        {
          name: "Start",
          label: "$label",
          entry: "RunStart",
          controller: ["ADB"],
          option: ["Mode"],
        },
      ],
      option: {
        Mode: {
          type: "select",
          cases: [{ name: "Fast", label: "$label" }],
          default_case: "Fast",
          controller: ["ADB"],
        },
        Input: {
          type: "input",
          inputs: [
            {
              name: "value",
              label: "Value",
              placeholder: "$input.placeholder",
              pipeline_type: "int",
              input_type: "file",
            },
          ],
        },
      },
      global_option: ["Mode"],
      preset: [
        {
          name: "daily",
          label: "Daily",
          task: [
            {
              name: "Start",
              label: "$preset.start",
              option: { Mode: "Fast", Input: { value: "3" } },
            },
          ],
        },
      ],
      welcome: ["$welcome", "./WELCOME.md", "https://example.test/anno.md"],
      contact: "CONTACT",
      license: "./LICENSE",
      telemetry: { sentry: { dsn: "https://key@sentry.test/1" } },
    },
  };
}

describe("buildAndroidProject", () => {
  it("builds a localized Android view model from merged PI text", async () => {
    const project = await buildAndroidProject(source(), "en_us", reader);

    expect(project.language).toBe("en_us");
    expect(project.label).toBe("Profiled Project");
    expect(project.controllers).toEqual([
      { name: "ADB", label: "Android", controllerType: "AndroidNative" },
    ]);
    expect(project.resources[0]).toMatchObject({
      name: "base",
      label: "Profiled Project",
      controllers: ["ADB"],
    });
    expect(project.tasks[0]).toMatchObject({
      name: "Start",
      entry: "RunStart",
      controllers: ["ADB"],
    });
    expect(project.options.Mode).toEqual({
      kind: "select",
      name: "Mode",
      label: "Mode",
      description: undefined,
      cases: [
        {
          name: "Fast",
          label: "Profiled Project",
          description: undefined,
          options: [],
        },
      ],
      defaultCase: "Fast",
      applicability: { controllers: ["ADB"], resources: [] },
    });
    expect(project.options.Input).toMatchObject({
      inputs: [
        {
          name: "value",
          placeholder: "Enter a value",
          pipelineType: "int",
          inputType: "file",
        },
      ],
    });
    expect(project.presets[0].tasks[0]).toMatchObject({
      taskName: "Start",
      label: "Start every day",
      option: {
        Mode: { type: "single", case: "Fast" },
        Input: { type: "inputs", values: { value: "3" } },
      },
    });
    expect(project.metadata).toMatchObject({
      contact: "Contact body",
      license: "License body",
      welcomeErrors: [],
      telemetry: {
        dsn: "https://key@sentry.test/1",
        tracing: true,
        tracesSampleRate: 1,
        failureAttachmentsSampleRate: 1,
      },
    });
    expect(project.metadata.welcome).toEqual([
      "Welcome body",
      "# Local announcement",
      "https://example.test/anno.md",
    ]);
    expect(project.metadata.welcomeFingerprint).toBeUndefined();
  });

  it("falls back to Chinese and then the first declared language", async () => {
    const project = await buildAndroidProject(source(), "fr_fr", reader);
    expect(project.language).toBe("zh_cn");
    expect(project.label).toBe("配置项目");

    const onlyEnglish = source();
    onlyEnglish.languages = ["en_us"];
    const fallback = await buildAndroidProject(onlyEnglish, "fr_fr", reader);
    expect(fallback.language).toBe("en_us");
  });

  it("rejects duplicate task names and unknown option references", async () => {
    const duplicate = source();
    duplicate.document.task = [{ name: "Start" }, { name: "Start" }];
    await expect(
      buildAndroidProject(duplicate, "en_us", reader),
    ).rejects.toThrow("duplicate task name: Start");

    const unknown = source();
    unknown.document.global_option = ["Missing"];
    await expect(buildAndroidProject(unknown, "en_us", reader)).rejects.toThrow(
      "unknown option reference: Missing",
    );
  });

  it("rejects unsupported input controls", async () => {
    const invalid = source();
    invalid.document.option = {
      Input: {
        type: "input",
        inputs: [{ name: "value", label: "Value", input_type: "clock" }],
      },
    };
    await expect(buildAndroidProject(invalid, "en_us", reader)).rejects.toThrow(
      "unknown input type: clock",
    );
  });
});

import { describe, expect, it } from "vitest";
import { buildAndroidProject, metadataTextPaths } from "./adapter";
import type {
  ProjectSource,
  ProjectTextReader,
  RawJsonValue,
} from "./rawTypes";

const files: Record<string, string> = {
  CONTACT: "Contact body",
  LICENSE: "License body",
  "WELCOME.md": "# Local announcement",
  "en_us.json": JSON.stringify({
    $label: "Profiled Project",
    "preset.start": "Start every day",
    "input.placeholder": "Enter a value",
    "input.description": "Input help",
    "hotkey.label": "Attack",
  }),
};

const reader: ProjectTextReader = async (path) => {
  const content = files[path];
  if (content === undefined) throw new Error(`could not read ${path}`);
  return content;
};

it("filters presets by the Android controller", async () => {
  const input = source();
  input.document.preset = [
    { name: "all" },
    { name: "android", controller: ["ADB"] },
    { name: "desktop", controller: ["PC"] },
  ];
  const project = await buildAndroidProject(input, "en_us", reader);
  expect(project.presets.map((preset) => preset.name)).toEqual([
    "all",
    "android",
  ]);
});

it("loads directory input fields", async () => {
  const input = source();
  input.document.option = {
    Directory: {
      type: "input",
      inputs: [{ name: "path", label: "Path", input_type: "directory" }],
    },
  };
  input.document.task = [];
  input.document.global_option = [];
  const project = await buildAndroidProject(input, "en_us", reader);
  expect(project.options.Directory).toMatchObject({
    kind: "input",
    inputs: [{ name: "path", inputType: "directory" }],
  });
});

function source(): ProjectSource {
  return {
    root: "/project",
    languages: ["en_us", "zh_cn"],
    translations: {
      en_us: {
        label: "Profiled Project",
        "preset.start": "Start every day",
        "input.placeholder": "Enter a value",
        "input.description": "Input help",
        "hotkey.label": "Attack",
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
              label: "$label",
              description: "$input.description",
              placeholder: "$input.placeholder",
              pipeline_type: "int",
              input_type: "file",
            },
          ],
        },
        Hotkey: {
          type: "hotkey",
          label: "Hotkeys",
          hotkeys: [{ name: "attack", label: "$hotkey.label", default: "A" }],
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
          label: "Profiled Project",
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

  it("localizes input and hotkey field labels", async () => {
    const project = await buildAndroidProject(source(), "en_us", reader);
    const input = project.options.Input;
    const hotkey = project.options.Hotkey;
    if (input.kind !== "input" || hotkey.kind !== "hotkey") {
      throw new Error("input and hotkey options should parse");
    }

    expect(input.inputs[0]).toMatchObject({
      label: "Profiled Project",
      description: "Input help",
    });
    expect(hotkey.hotkeys).toMatchObject([
      { name: "attack", label: "Attack", default: "A" },
    ]);
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

describe("metadataTextPaths", () => {
  it("collects localized bodies for the selected language", () => {
    expect(metadataTextPaths(source(), "en_us")).toEqual([
      "WELCOME.md",
      "CONTACT",
      "LICENSE",
    ]);
  });

  it("falls back with the selected language's metadata", () => {
    const chinese = source();
    chinese.translations.zh_cn.welcome = "./zh_cn/WELCOME.md";

    expect(metadataTextPaths(chinese, "fr_fr")).toEqual([
      "zh_cn/WELCOME.md",
      "WELCOME.md",
      "CONTACT",
      "LICENSE",
    ]);
  });
});

it("loads anonymous pretasks, localizes display fields and defaults field labels", async () => {
  const input = source();
  input.document.pretask = [
    { exec: "python", args: ["one.py"] },
    { exec: "python", args: ["two.py"] },
    {
      name: "python#0",
      exec: "tool",
      label: "$label",
      description: "$input.description",
      icon: "$icon",
      option: ["text", "key"],
      controller: ["ADB"],
      resource: ["main"],
    },
  ];
  input.translations.en_us.icon = "prepare.png";
  input.document.option = {
    text: { type: "input", inputs: [{ name: "token", password: true }] },
    key: { type: "hotkey", hotkeys: [{ name: "attack" }] },
  };
  input.document.task = [];
  input.document.global_option = [];
  const project = await buildAndroidProject(input, "en_us", reader);
  expect(project.pretasks.map((task) => task.name)).toEqual([
    "python#0#",
    "python#1",
    "python#0",
  ]);
  expect(project.pretasks[0]).toMatchObject({
    label: "python",
    args: ["one.py"],
  });
  expect(project.pretasks[0].explicitName).toBeUndefined();
  expect(project.pretasks[2]).toMatchObject({
    explicitName: "python#0",
    label: "Profiled Project",
    description: "Input help",
    icon: "prepare.png",
    options: ["text", "key"],
    controllers: ["ADB"],
    resources: ["main"],
  });
  expect(project.options.text).toMatchObject({
    inputs: [{ name: "token", label: "token", password: true }],
  });
  expect(project.options.key).toMatchObject({
    hotkeys: [{ name: "attack", label: "attack" }],
  });
  input.document.pretask = { exec: "tool" };
  expect(
    (await buildAndroidProject(input, "en_us", reader)).pretasks,
  ).toHaveLength(1);
});

const invalidPretasks: RawJsonValue[] = [
  {},
  { exec: "" },
  { exec: "python", args: [1] },
  { exec: "python", args: "bad" },
  { exec: "python", name: "" },
  { exec: "python", option: ["missing"] },
  [
    { name: "same", exec: "a" },
    { name: "same", exec: "b" },
  ],
  1,
];
it.each(invalidPretasks.map((pretask) => ({ pretask })))(
  "rejects malformed pretask declarations $pretask",
  async ({ pretask }) => {
    const input = source();
    input.document.pretask = pretask;
    await expect(buildAndroidProject(input, "en_us", reader)).rejects.toThrow();
  },
);

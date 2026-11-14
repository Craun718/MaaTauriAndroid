import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { availablePretasks, pretaskVisibleOptions } from "./pretasks";
import { createTaskDemo } from "./taskDemo";
import type { PretaskDefinition } from "./types";

function fixture() {
  const { project, configuration } = createTaskDemo((key) =>
    translate("en", key),
  );
  const task: PretaskDefinition = {
    name: "prepare",
    explicitName: "prepare",
    label: "Prepare",
    exec: "tool",
    args: [],
    options: ["mode"],
    controllers: [],
    resources: [],
  };
  project.pretasks = [task];
  project.options = {
    mode: {
      name: "mode",
      label: "Mode",
      kind: "select",
      applicability: { controllers: [], resources: [] },
      cases: [
        { name: "on", label: "On", options: ["child", "filtered"] },
        { name: "off", label: "Off", options: [] },
      ],
    },
    child: {
      name: "child",
      label: "Child",
      kind: "input",
      applicability: { controllers: [], resources: [] },
      inputs: [],
    },
    filtered: {
      name: "filtered",
      label: "Filtered",
      kind: "select",
      applicability: { controllers: ["PC"], resources: [] },
      cases: [{ name: "active", label: "Active", options: ["grandchild"] }],
    },
    grandchild: {
      name: "grandchild",
      label: "Grandchild",
      kind: "input",
      applicability: { controllers: [], resources: [] },
      inputs: [],
    },
  };
  return { project, configuration, task };
}

describe("pretask configuration choices", () => {
  it("filters unavailable pre-tasks and follows the resource fallback", () => {
    const { project, configuration, task } = fixture();
    expect(availablePretasks(project, configuration)).toEqual([task]);
    configuration.activeResource = "removed";
    expect(availablePretasks(project, configuration)).toEqual([task]);
    task.resources = ["other"];
    expect(availablePretasks(project, configuration)).toEqual([]);
    task.resources = [];
    task.controllers = ["PC"];
    expect(availablePretasks(project, configuration)).toEqual([]);
  });

  it("shows active children from the pretask scope and prunes filtered branches", () => {
    const { project, configuration, task } = fixture();
    configuration.globalOptionValues.mode = { type: "single", case: "off" };
    expect(pretaskVisibleOptions(project, configuration, task)).toEqual([
      { name: "mode", depth: 0 },
      { name: "child", depth: 1 },
    ]);
    configuration.pretaskValues.prepare = {
      enabled: true,
      optionValues: { mode: { type: "single", case: "off" } },
    };
    expect(pretaskVisibleOptions(project, configuration, task)).toEqual([
      { name: "mode", depth: 0 },
    ]);
    project.options.mode.applicability.resources = ["other"];
    expect(pretaskVisibleOptions(project, configuration, task)).toEqual([]);
  });
});

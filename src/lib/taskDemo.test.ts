import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ saveConfiguration: vi.fn(), startRun: vi.fn() }));

import { saveConfiguration, startRun } from "./api";
import { createTaskDemo, editTaskDemo, taskDemoStepComplete } from "./taskDemo";

describe("isolated task demo", () => {
  it("starts independently and completes through actual edits without IPC", () => {
    const initial = createTaskDemo((key) => key);
    let configuration = initial.configuration;
    expect(taskDemoStepComplete(0, configuration)).toBe(false);
    configuration = editTaskDemo(configuration, {
      kind: "patch",
      runId: "demo-a",
      instanceId: "demo-first",
      patch: { enabled: true },
    });
    expect(taskDemoStepComplete(0, configuration)).toBe(true);
    for (const [name, value] of [
      ["enabled", "Yes"],
      ["mode", "fast"],
    ])
      configuration = editTaskDemo(configuration, {
        kind: "option",
        runId: "demo-a",
        instanceId: "demo-first",
        name,
        value: { type: "single", case: value },
      });
    expect(taskDemoStepComplete(1, configuration)).toBe(true);
    configuration = editTaskDemo(configuration, {
      kind: "reorder",
      runId: "demo-a",
      from: "demo-first",
      to: "demo-second",
    });
    expect(taskDemoStepComplete(2, configuration)).toBe(true);
    configuration = editTaskDemo(configuration, {
      kind: "selectConfiguration",
      id: "demo-b",
    });
    expect(taskDemoStepComplete(3, configuration)).toBe(true);
    expect(saveConfiguration).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
    expect(createTaskDemo((key) => key).configuration).toEqual(
      initial.configuration,
    );
    expect(initial.configuration.runConfigurations[0].tasks[0].enabled).toBe(
      false,
    );
  });
  it("rejects absent tasks and unknown steps", () => {
    const { configuration } = createTaskDemo((key) => key);
    configuration.runConfigurations = [];
    for (const step of [0, 1, 2, 3, 99])
      expect(taskDemoStepComplete(step, configuration)).toBe(false);
  });
});

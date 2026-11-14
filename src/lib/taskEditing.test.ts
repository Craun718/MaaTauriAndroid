import { describe, expect, it } from "vitest";
import { applyTaskEdit } from "./taskEditing";
import type { UserConfiguration } from "./types";

const config: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  closeTargetAppAfterRun: false,
  telemetryEnabled: false,
  pretaskValues: {},
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  activeRunConfigurationId: "a",
  runConfigurations: [
    {
      id: "a",
      name: "A",
      tasks: [
        { instanceId: "1", taskName: "one", enabled: false, optionValues: {} },
        { instanceId: "2", taskName: "two", enabled: true, optionValues: {} },
      ],
    },
    { id: "b", name: "B", tasks: [] },
  ],
};
describe("task edits", () => {
  it("updates values immutably and targets the originating configuration", () => {
    let next = applyTaskEdit(config, { kind: "selectConfiguration", id: "b" });
    next = applyTaskEdit(next, {
      kind: "patch",
      runId: "a",
      instanceId: "1",
      patch: { enabled: true },
    });
    next = applyTaskEdit(next, {
      kind: "option",
      runId: "a",
      instanceId: "1",
      name: "mode",
      value: { type: "single", case: "Yes" },
    });
    expect(next.runConfigurations[0].tasks[0].enabled).toBe(true);
    expect(config.runConfigurations[0].tasks[0].enabled).toBe(false);
    expect(next.activeRunConfigurationId).toBe("b");
  });
  it("reorders and rejects stale identities and duplicate configuration ids", () => {
    expect(
      applyTaskEdit(config, {
        kind: "reorder",
        runId: "a",
        from: "1",
        to: "2",
      }).runConfigurations[0].tasks.map((task) => task.instanceId),
    ).toEqual(["2", "1"]);
    expect(
      applyTaskEdit(config, {
        kind: "reorder",
        runId: "a",
        from: "missing",
        to: "2",
      }),
    ).toBe(config);
    expect(
      applyTaskEdit(config, { kind: "selectConfiguration", id: "missing" }),
    ).toBe(config);
    expect(
      applyTaskEdit(config, {
        kind: "createConfiguration",
        id: "a",
        name: "duplicate",
      }),
    ).toBe(config);
    expect(
      applyTaskEdit(config, {
        kind: "remove",
        runId: "missing",
        instanceId: "1",
      }),
    ).toBe(config);
  });
});

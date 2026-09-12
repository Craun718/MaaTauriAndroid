import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage";
import { useAppStore } from "../store/appStore";
import type { AppStateSnapshot, Project, UserConfiguration } from "../lib/types";

const saveConfiguration = vi.fn();
const resolveCurrent = vi.fn();
const getRunStatus = vi.fn();

vi.mock("../lib/api", () => ({
  applyPreset: vi.fn(),
  captureManualScreenshot: vi.fn(),
  exportDiagnostics: vi.fn(),
  getRunStatus: () => getRunStatus(),
  resolveCurrent: () => resolveCurrent(),
  saveConfiguration: (configuration: unknown) => saveConfiguration(configuration),
  startRun: vi.fn(),
  stopRun: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

const applicability = { controllers: [], resources: [] };

/**
 * Mirrors the shape M9A ships: the task only declares `吃糖`, and the options
 * you can only reach through its selected case — `自定义吃糖次数`, and under
 * that `吃糖次数` — are declared nowhere else. Nothing in the task's own
 * option list points at them, which is why they used to be unreachable.
 */
const project: Project = {
  root: "/fixtures",
  interfaceVersion: 2,
  name: "fixture",
  label: "Fixture",
  language: "en_us",
  languages: ["en_us"],
  controllers: [{ name: "Android", label: "Android", controllerType: "AndroidNative" }],
  resources: [
    { name: "base", label: "Base", paths: ["resource/base"], controllers: [], options: [] },
  ],
  groups: [],
  tasks: [
    {
      name: "糖果",
      label: "糖果",
      entry: "Sugar",
      groups: [],
      controllers: [],
      resources: [],
      options: ["吃糖"],
      defaultCheck: false,
    },
  ],
  options: {
    吃糖: {
      kind: "switch",
      name: "吃糖",
      label: "吃糖",
      cases: [
        { name: "No", label: "No", options: [] },
        { name: "Yes", label: "Yes", options: ["自定义吃糖次数"] },
      ],
      defaultCase: "Yes",
      applicability,
    },
    自定义吃糖次数: {
      kind: "switch",
      name: "自定义吃糖次数",
      label: "自定义吃糖次数",
      cases: [
        { name: "No", label: "No", options: [] },
        { name: "Yes", label: "Yes", options: ["吃糖次数"] },
      ],
      defaultCase: "No",
      applicability,
    },
    吃糖次数: {
      kind: "input",
      name: "吃糖次数",
      label: "吃糖次数",
      inputs: [
        { name: "count", label: "次数", pipelineType: "int", password: false },
      ],
      applicability,
    },
  },
  globalOptions: [],
  presets: [],
  metadata: { welcome: [] },
};

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [{ id: "default", name: "Default", tasks: [] }],
  activeRunConfigurationId: "default",
};

beforeEach(() => {
  vi.clearAllMocks();
  const snapshot: AppStateSnapshot = { project, configuration };
  useAppStore.setState({ snapshot, busy: false, error: undefined });
  saveConfiguration.mockImplementation(async (next: unknown) => next);
  resolveCurrent.mockResolvedValue({
    controller: project.controllers[0],
    resource: project.resources[0],
    tasks: [],
    basePipeline: {},
    pipelineOverride: {},
  });
  getRunStatus.mockResolvedValue({ executionId: undefined, state: "Idle", message: "Idle" });
});

function nestedOptionGroup() {
  return screen.getByRole("radiogroup", { name: "自定义吃糖次数" });
}

describe("nested task options", () => {
  it("renders the option owned by a case that is selected by default", () => {
    render(<TasksPage />);

    // 吃糖 defaults to Yes, so the option that case owns is reachable — even
    // though the task only declares 吃糖 itself.
    expect(nestedOptionGroup()).toBeInTheDocument();
    // Nothing selects 自定义吃糖次数's Yes case yet, so its own child is not.
    expect(screen.queryByRole("textbox", { name: "次数" })).not.toBeInTheDocument();
  });

  it("reveals the deeper option once its case is selected, and saves it", async () => {
    render(<TasksPage />);

    fireEvent.click(within(nestedOptionGroup()).getByRole("radio", { name: "Yes" }));

    expect(await screen.findByRole("textbox", { name: "次数" })).toBeInTheDocument();
    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({
      runConfigurations: [
        {
          id: "default",
          tasks: [
            {
              taskName: "糖果",
              optionValues: { 自定义吃糖次数: { type: "single", case: "Yes" } },
            },
          ],
        },
      ],
    });
  });

  it("hides the deeper option again when the case is switched off", async () => {
    render(<TasksPage />);
    fireEvent.click(within(nestedOptionGroup()).getByRole("radio", { name: "Yes" }));
    expect(await screen.findByRole("textbox", { name: "次数" })).toBeInTheDocument();

    fireEvent.click(within(nestedOptionGroup()).getByRole("radio", { name: "No" }));

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "次数" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the value typed into a nested option", async () => {
    render(<TasksPage />);
    fireEvent.click(within(nestedOptionGroup()).getByRole("radio", { name: "Yes" }));
    const field = await screen.findByRole("textbox", { name: "次数" });

    fireEvent.change(field, { target: { value: "6" } });

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(2));
    expect(saveConfiguration.mock.calls[1][0]).toMatchObject({
      runConfigurations: [
        {
          id: "default",
          tasks: [
            {
              taskName: "糖果",
              optionValues: { 吃糖次数: { type: "inputs", values: { count: "6" } } },
            },
          ],
        },
      ],
    });
  });
});

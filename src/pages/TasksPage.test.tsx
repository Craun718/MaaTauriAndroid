import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  listen: vi.fn((event: string, handler: (notification: { payload: unknown }) => void) => {
    (eventHandlers.handlers[event] ??= []).push(handler);
    return Promise.resolve(() => undefined);
  }),
}));

const eventHandlers = vi.hoisted(
  () => ({ handlers: {} as Record<string, Array<(event: { payload: unknown }) => void>> }),
);

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
  groups: [
    {
      name: "daily",
      label: "日常",
      description: "<b>组说明</b>",
      defaultExpand: true,
    },
    { name: "event", label: "活动", defaultExpand: false },
  ],
  tasks: [
    {
      name: "糖果",
      label: "糖果",
      entry: "Sugar",
      description: "**任务**说明",
      groups: ["daily", "event"],
      controllers: [],
      resources: [],
      options: ["吃糖"],
      defaultCheck: false,
    },
    {
      name: "整理",
      label: "整理",
      entry: "Cleanup",
      groups: [],
      controllers: [],
      resources: [],
      options: [],
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
        {
          name: "count",
          label: "次数",
          description: "次数 *说明*",
          pipelineType: "int",
          password: false,
        },
      ],
      applicability,
    },
  },
  globalOptions: [],
  presets: [
    { name: "daily", label: "日常预设", description: "预设 *重点*", tasks: [] },
  ],
  metadata: { welcome: [] },
};

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  telemetryEnabled: false,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [{ id: "default", name: "Default", tasks: [] }],
  activeRunConfigurationId: "default",
};

beforeEach(() => {
  vi.clearAllMocks();
  eventHandlers.handlers = {};
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

function nestedSwitch() {
  return screen.getByRole("checkbox", { name: "自定义吃糖次数" });
}

describe("nested task options", () => {
  it("renders the option owned by a case that is selected by default", () => {
    render(<TasksPage />);

    // 吃糖 defaults to Yes, so the option that case owns is reachable — even
    // though the task only declares 吃糖 itself. Both switches are one
    // checkbox each, ticked from the case names rather than from their order.
    expect(screen.getByRole("checkbox", { name: "吃糖" })).toBeChecked();
    expect(nestedSwitch()).toBeInTheDocument();
    expect(nestedSwitch()).not.toBeChecked();
    // Nothing selects 自定义吃糖次数's Yes case yet, so its own child is not.
    expect(screen.queryByRole("textbox", { name: "次数" })).not.toBeInTheDocument();
  });

  it("reveals the deeper option once its case is selected, and saves it", async () => {
    render(<TasksPage />);

    fireEvent.click(nestedSwitch());

    expect(await screen.findByRole("textbox", { name: "次数" })).toBeInTheDocument();
    expect(screen.getByText("说明").tagName).toBe("EM");
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
    fireEvent.click(nestedSwitch());
    expect(await screen.findByRole("textbox", { name: "次数" })).toBeInTheDocument();

    fireEvent.click(nestedSwitch());

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "次数" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the value typed into a nested option", async () => {
    render(<TasksPage />);
    fireEvent.click(nestedSwitch());
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

describe("task groups and rich descriptions", () => {
  it("groups tasks in interface order and renders group descriptions", () => {
    render(<TasksPage />);

    expect(screen.getByRole("button", { name: "日常" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("组说明").tagName).toBe("B");
    expect(screen.getByText("任务").tagName).toBe("STRONG");
    expect(screen.getAllByRole("heading", { name: "糖果" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "整理" })).toBeInTheDocument();
    expect(screen.getByText("重点").tagName).toBe("EM");
  });

  it("keeps a default-collapsed group hidden until it is toggled", () => {
    render(<TasksPage />);
    const eventHeader = screen.getByRole("button", { name: "活动" });

    expect(eventHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("heading", { name: "糖果" })).toHaveLength(1);

    fireEvent.click(eventHeader);

    expect(eventHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("heading", { name: "糖果" })).toHaveLength(2);
  });
});

describe("focus notifications", () => {
  it("shows focus toasts while a run is active", async () => {
    render(<TasksPage />);

    eventHandlers.handlers["focus-toast"][0]({
      payload: {
        channel: "toast",
        messageType: "Node.Action.Starting",
        name: "NodeA",
        message: "NodeA started",
      },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("NodeA: NodeA started");
  });

  it("shows focus notices with a dismiss control", async () => {
    render(<TasksPage />);

    eventHandlers.handlers["focus-notify"][0]({
      payload: {
        channel: "modal",
        messageType: "Node.Action.Failed",
        name: "NodeA",
        message: "NodeA failed",
      },
    });

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("NodeA failed");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });
});

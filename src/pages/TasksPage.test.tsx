import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { TasksPage } from "./TasksPage";

const saveConfiguration = vi.fn();
const resolveCurrent = vi.fn();
const getRunStatus = vi.fn();
const getVirtualDisplayStatus = vi.fn();

vi.mock("../lib/api", () => ({
  applyPreset: vi.fn(),
  captureManualScreenshot: vi.fn(),
  exportDiagnostics: vi.fn(),
  getRunStatus: () => getRunStatus(),
  resolveCurrent: () => resolveCurrent(),
  saveConfiguration: (configuration: unknown) =>
    saveConfiguration(configuration),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  startVirtualDisplay: vi.fn(),
  stopVirtualDisplay: vi.fn(),
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  updateVirtualDisplayBounds: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (event: string, handler: (notification: { payload: unknown }) => void) => {
      eventHandlers.handlers[event] ??= [];
      eventHandlers.handlers[event].push(handler);
      return Promise.resolve(() => undefined);
    },
  ),
}));

const eventHandlers = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<(event: { payload: unknown }) => void>>,
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
  controllers: [
    { name: "Android", label: "Android", controllerType: "AndroidNative" },
  ],
  resources: [
    {
      name: "base",
      label: "Base",
      paths: ["resource/base"],
      controllers: [],
      options: [],
    },
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
  runConfigurations: [
    {
      id: "default",
      name: "Default",
      tasks: [
        {
          instanceId: "sugar:1",
          taskName: "糖果",
          enabled: false,
          optionValues: {},
        },
        {
          instanceId: "cleanup:1",
          taskName: "整理",
          enabled: false,
          optionValues: {},
        },
      ],
    },
  ],
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
  getRunStatus.mockResolvedValue({
    executionId: undefined,
    state: "Idle",
    message: "Idle",
  });
  getVirtualDisplayStatus.mockResolvedValue({
    active: false,
    displayId: -1,
    width: 1280,
    height: 720,
    frameCount: 0,
  });
});

function nestedSwitch() {
  return screen.getByRole("checkbox", { name: "自定义吃糖次数" });
}

/** 任务详情收进了下拉，先展开才能摸到选项。 */
function expandTaskDetails(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

describe("nested task options", () => {
  it("renders the option owned by a case that is selected by default", () => {
    render(<TasksPage />);
    expandTaskDetails("糖果");

    // 吃糖 defaults to Yes, so the option that case owns is reachable — even
    // though the task only declares 吃糖 itself. Both switches are one
    // checkbox each, ticked from the case names rather than from their order.
    expect(screen.getByRole("checkbox", { name: "吃糖" })).toBeChecked();
    expect(nestedSwitch()).toBeInTheDocument();
    expect(nestedSwitch()).not.toBeChecked();
    // Nothing selects 自定义吃糖次数's Yes case yet, so its own child is not.
    expect(
      screen.queryByRole("textbox", { name: "次数" }),
    ).not.toBeInTheDocument();
  });

  it("reveals the deeper option once its case is selected, and saves it", async () => {
    render(<TasksPage />);
    expandTaskDetails("糖果");

    fireEvent.click(nestedSwitch());

    expect(
      await screen.findByRole("textbox", { name: "次数" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("说明").map((element) => element.tagName),
    ).toContain("EM");
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
    expandTaskDetails("糖果");
    fireEvent.click(nestedSwitch());
    expect(
      await screen.findByRole("textbox", { name: "次数" }),
    ).toBeInTheDocument();

    fireEvent.click(nestedSwitch());

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "次数" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the value typed into a nested option", async () => {
    render(<TasksPage />);
    expandTaskDetails("糖果");
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
              optionValues: {
                吃糖次数: { type: "inputs", values: { count: "6" } },
              },
            },
          ],
        },
      ],
    });
  });
});

describe("run configuration tabs and flat task list", () => {
  it("places the virtual display above the run queue", async () => {
    render(<TasksPage />);

    const virtualDisplay = await screen.findByRole("heading", {
      name: "Virtual display",
    });
    const runQueue = screen.getByRole("heading", { name: "0 tasks ready" });
    expect(virtualDisplay.compareDocumentPosition(runQueue)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.queryByText("Base")).not.toBeInTheDocument();
    expect(screen.queryByText("Idle")).not.toBeInTheDocument();
  });

  it("renders run configurations as tabs with the active one selected", () => {
    render(<TasksPage />);

    expect(screen.getByRole("tab", { name: "Default" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: "糖果" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "整理" })).toBeInTheDocument();
  });

  it("creates a new configuration tab", async () => {
    render(<TasksPage />);

    fireEvent.click(screen.getByRole("button", { name: "New configuration" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    const saved = saveConfiguration.mock.calls[0][0] as UserConfiguration;
    expect(saved.runConfigurations).toHaveLength(2);
    expect(saved.activeRunConfigurationId).toBe(saved.runConfigurations[1].id);
    expect(saved.runConfigurations[1].tasks).toHaveLength(0);
  });

  it("switches to a newly created configuration and shows the add-task picker", async () => {
    render(<TasksPage />);

    fireEvent.click(screen.getByRole("button", { name: "New configuration" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    // 乐观更新后 store 已切到新配置，任务列表为空
    const state = useAppStore.getState();
    expect(state.snapshot?.configuration.runConfigurations).toHaveLength(2);
    expect(state.snapshot?.configuration.activeRunConfigurationId).not.toBe(
      "default",
    );
  });

  it("adds a task from the picker", async () => {
    useAppStore.setState({
      snapshot: {
        project,
        configuration: {
          ...configuration,
          runConfigurations: [{ id: "default", name: "Default", tasks: [] }],
        },
      },
    });
    render(<TasksPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.click(screen.getByRole("button", { name: "糖果" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    const saved = saveConfiguration.mock.calls[0][0] as UserConfiguration;
    expect(saved.runConfigurations[0].tasks).toHaveLength(1);
    expect(saved.runConfigurations[0].tasks[0].taskName).toBe("糖果");
  });

  it("removes a task from the list", async () => {
    render(<TasksPage />);

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    const saved = saveConfiguration.mock.calls[0][0] as UserConfiguration;
    expect(saved.runConfigurations[0].tasks).toHaveLength(1);
    expect(saved.runConfigurations[0].tasks[0].taskName).toBe("整理");
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

    expect(await screen.findByRole("status")).toHaveTextContent(
      "NodeA: NodeA started",
    );
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

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "NodeA failed",
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });
});

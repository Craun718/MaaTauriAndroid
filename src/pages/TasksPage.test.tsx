import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationHost } from "../components/ui/NotificationHost";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { useRunLogStore } from "../store/runLogStore";
import { TasksPage } from "./TasksPage";

const saveConfiguration = vi.fn();
const resolveCurrent = vi.fn();
const getRunStatus = vi.fn();
const getVirtualDisplayStatus = vi.fn();
const captureManualScreenshot = vi.fn();
const startRun = vi.fn();
const stopRun = vi.fn();
const exportLogs = vi.fn();
const setVirtualDisplayTouchMarkers = vi.fn();
const isNotificationGranted = vi.fn();
const requestNotificationPermission = vi.fn();

vi.mock("../lib/api", () => ({
  applyPreset: vi.fn(),
  captureManualScreenshot: () => captureManualScreenshot(),
  exportLogs: () => exportLogs(),
  getRunStatus: () => getRunStatus(),
  isNotificationGranted: () => isNotificationGranted(),
  requestNotificationPermission: () => requestNotificationPermission(),
  resolveCurrent: () => resolveCurrent(),
  saveConfiguration: (configuration: unknown) =>
    saveConfiguration(configuration),
  startRun: () => startRun(),
  stopRun: (...args: unknown[]) => stopRun(...args),
  startVirtualDisplay: vi.fn(),
  stopVirtualDisplay: vi.fn(),
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  getVirtualDisplayStream: vi.fn(),
  setVirtualDisplayTouchMarkers: () => setVirtualDisplayTouchMarkers(),
  listRunHistory: vi.fn(async () => []),
  readRunHistory: vi.fn(async () => []),
  getUpdateStatus: vi.fn(async () => undefined),
  checkForUpdate: vi.fn(async () => undefined),
  resolveUpdate: vi.fn(async () => undefined),
  cancelUpdate: vi.fn(async () => undefined),
  installUpdate: vi.fn(async () => undefined),
  getUpdatePrefs: vi.fn(async () => undefined),
  setUpdatePrefs: vi.fn(async () => undefined),
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

function renderTasksPage() {
  return render(
    <>
      <TasksPage />
      <NotificationHost />
    </>,
  );
}

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
  closeTargetAppAfterRun: false,
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
  setVirtualDisplayTouchMarkers.mockResolvedValue([]);
  startRun.mockResolvedValue({
    executionId: "run-1",
    message: "The run is starting",
    taskCount: 0,
  });
  stopRun.mockResolvedValue("The run is stopping");
  useNotificationStore.setState({
    notifications: [],
    seenKeys: new Set<string>(),
  });
  useRunLogStore.setState({ entries: [], executionId: undefined });
  captureManualScreenshot.mockResolvedValue({
    executionId: "run-1",
    path: "/data/user/0/top.natsuu.mta.m/runs/run-1/screens/manual-1.png",
  });
  getVirtualDisplayStatus.mockResolvedValue({
    active: true,
    displayId: 1,
    width: 1280,
    height: 720,
    frameCount: 0,
  });
});

function nestedSwitch() {
  return screen.getByRole<HTMLInputElement>("checkbox", {
    name: "自定义吃糖次数",
  });
}

/** 任务详情收进模态框，先打开才能摸到选项。 */
function openTaskDetails(label: string) {
  fireEvent.click(
    screen.getByRole("button", { name: `Task details: ${label}` }),
  );
}

function selectNestedCase(checked: boolean) {
  const checkbox = nestedSwitch();
  if (checkbox.checked !== checked) {
    fireEvent.click(checkbox);
  }
}

function enabledResolvedTasks() {
  return configuration.runConfigurations[0].tasks.flatMap((configured) => {
    const task = project.tasks.find(
      (definition) => definition.name === configured.taskName,
    );
    return task
      ? [{ task, configured, enabled: true, pipelineOverride: {} }]
      : [];
  });
}

describe("nested task options", () => {
  it("renders the option owned by a case that is selected by default", () => {
    renderTasksPage();
    openTaskDetails("糖果");

    // 吃糖 defaults to Yes, so the option that case owns is reachable — even
    // though the task only declares 吃糖 itself. Both switches are one
    // checkbox each, ticked from the case names rather than from their order.
    expect(screen.getByRole("checkbox", { name: "吃糖" })).toBeChecked();
    expect(nestedSwitch()).toBeInTheDocument();
    expect(nestedSwitch()).not.toBeChecked();
    // Nothing selects 自定义吃糖次数's Yes case yet, so its own child is not.
    expect(
      screen.queryByRole("textbox", { name: /^次数/ }),
    ).not.toBeInTheDocument();
  });

  it("reveals the deeper option once its case is selected, and saves it", async () => {
    renderTasksPage();
    openTaskDetails("糖果");

    selectNestedCase(true);

    expect(
      await screen.findByRole("textbox", { name: /^次数/ }),
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
            { taskName: "整理", optionValues: {} },
          ],
        },
      ],
    });
  });

  it("hides the deeper option again when the case is switched off", async () => {
    renderTasksPage();
    openTaskDetails("糖果");
    selectNestedCase(true);
    expect(
      await screen.findByRole("textbox", { name: /^次数/ }),
    ).toBeInTheDocument();

    selectNestedCase(false);

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: /^次数/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the value typed into a nested option", async () => {
    renderTasksPage();
    openTaskDetails("糖果");
    selectNestedCase(true);
    const field = await screen.findByRole("textbox", { name: /^次数/ });

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
            { taskName: "整理", optionValues: {} },
          ],
        },
      ],
    });
  });
});

describe("run configuration tabs and flat task list", () => {
  it("starts a run directly and switches to logs", async () => {
    resolveCurrent.mockResolvedValue({
      controller: project.controllers[0],
      resource: project.resources[0],
      tasks: enabledResolvedTasks(),
      basePipeline: {},
      pipelineOverride: {},
    });
    useAppStore.setState({
      snapshot: {
        project,
        configuration: {
          ...configuration,
          runConfigurations: [
            {
              ...configuration.runConfigurations[0],
              tasks: configuration.runConfigurations[0].tasks.map((task) => ({
                ...task,
                enabled: true,
              })),
            },
          ],
        },
      },
    });
    renderTasksPage();

    const start = await screen.findByRole("button", { name: "Start run" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(screen.getByRole("tab", { name: "Task logs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    eventHandlers.handlers["run-event"].forEach((handler) => {
      handler({
        payload: {
          executionId: "run-1",
          sequence: 1,
          atUnixMs: 1,
          kind: "started",
          state: "Running",
          message: "The run started",
        },
      });
    });

    expect(
      await screen.findByRole("button", { name: "Stop run" }),
    ).toBeEnabled();
  });

  it("stops a run directly", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Running",
      message: "The run started",
    });
    resolveCurrent.mockResolvedValue({
      controller: project.controllers[0],
      resource: project.resources[0],
      tasks: enabledResolvedTasks(),
      basePipeline: {},
      pipelineOverride: {},
    });
    useAppStore.setState({
      snapshot: {
        project,
        configuration: {
          ...configuration,
          runConfigurations: [
            {
              ...configuration.runConfigurations[0],
              tasks: configuration.runConfigurations[0].tasks.map((task) => ({
                ...task,
                enabled: true,
              })),
            },
          ],
        },
      },
    });
    renderTasksPage();

    await screen.findByText("The run started");
    fireEvent.click(await screen.findByRole("button", { name: "Stop run" }));

    await waitFor(() => expect(stopRun).toHaveBeenCalledWith("run-1"));
  });

  it("exports logs without requiring a run", async () => {
    exportLogs.mockResolvedValue({
      path: "/cache/maa_tauri_android-logs-1.zip",
      fileName: "maa_tauri_android-logs-1.zip",
    });
    renderTasksPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Task actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));

    await waitFor(() => expect(exportLogs).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        "Logs exported to Downloads: maa_tauri_android-logs-1.zip",
      ),
    ).toBeInTheDocument();
  });

  it("collects status, focus and agent output while the task list is selected", () => {
    renderTasksPage();

    const runEventHandlers = eventHandlers.handlers["run-event"] ?? [];
    const emit = (payload: unknown) => runEventHandlers.at(-1)?.({ payload });
    emit({
      executionId: "run-1",
      sequence: 1,
      atUnixMs: 1,
      kind: "started",
      state: "Running",
      message: "The run started",
    });
    emit({
      executionId: "run-1",
      sequence: 2,
      atUnixMs: 2,
      kind: "focus",
      state: "Running",
      message: "NodeA started",
      taskName: "NodeA",
      data: { channel: "log", messageType: "Node.Action.Starting" },
    });
    emit({
      executionId: "run-1",
      sequence: 3,
      atUnixMs: 3,
      kind: "task",
      state: "Running",
      message: "agent says ready",
      data: { source: "python-agent", stream: "stdout" },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Task logs" }));

    expect(screen.getByText("The run started")).toBeInTheDocument();
    const logs = screen.getByText("The run started").closest("ol");
    expect(logs).toHaveTextContent("NodeA started");
    expect(screen.getByText("agent says ready")).toBeInTheDocument();
    expect(screen.getAllByText("Status")).toHaveLength(1);
    expect(screen.getAllByText("Focus")).toHaveLength(1);
    expect(screen.getAllByText("Agent")).toHaveLength(1);
  });

  it("renders HTML in focus logs as sanitized rich text", () => {
    const { container } = renderTasksPage();

    const runEventHandlers = eventHandlers.handlers["run-event"] ?? [];
    runEventHandlers.at(-1)?.({
      payload: {
        executionId: "run-1",
        sequence: 1,
        atUnixMs: 1,
        kind: "focus",
        state: "Running",
        message:
          '<font color="DeepSkyBlue">进入冒险副本任务</font><script>alert(1)</script>',
        taskName: "Adventure",
        data: { channel: "log", messageType: "Node.Action.Starting" },
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Task logs" }));

    const font = screen.getByText("进入冒险副本任务").closest("font");
    expect(font).toHaveAttribute("color", "DeepSkyBlue");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
  });

  it("creates a new configuration tab", async () => {
    renderTasksPage();

    fireEvent.click(screen.getByRole("button", { name: "New configuration" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    const saved = saveConfiguration.mock.calls[0][0] as UserConfiguration;
    expect(saved.runConfigurations).toHaveLength(2);
    expect(saved.activeRunConfigurationId).toBe(saved.runConfigurations[1].id);
    expect(saved.runConfigurations[1].tasks).toHaveLength(0);
  });

  it("switches to a newly created configuration and shows the add-task picker", async () => {
    renderTasksPage();

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
    renderTasksPage();

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.click(screen.getByRole("button", { name: "糖果" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    const saved = saveConfiguration.mock.calls[0][0] as UserConfiguration;
    expect(saved.runConfigurations[0].tasks).toHaveLength(1);
    expect(saved.runConfigurations[0].tasks[0].taskName).toBe("糖果");
  });

  it("removes a task from the list", async () => {
    renderTasksPage();

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
    renderTasksPage();

    eventHandlers.handlers["focus-toast"][0]({
      payload: {
        channel: "toast",
        messageType: "Node.Action.Starting",
        name: "NodeA",
        message: "NodeA started",
      },
    });

    const message = await screen.findByText("NodeA: NodeA started");
    expect(message.closest('[role="status"]')).toHaveTextContent(
      "NodeA: NodeA started",
    );
  });

  it("shows focus notices with a dismiss control", async () => {
    renderTasksPage();

    eventHandlers.handlers["focus-notify"][0]({
      payload: {
        channel: "dialog",
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

  it("leaves blocking modal notices to the global modal host", async () => {
    renderTasksPage();

    eventHandlers.handlers["focus-notify"][0]({
      payload: {
        channel: "modal",
        messageType: "Node.Action.Failed",
        name: "NodeA",
        message: "NodeA failed",
      },
    });

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("shows notification notices only while OS notifications are denied", async () => {
    isNotificationGranted.mockReturnValue(true);
    const { unmount } = renderTasksPage();

    eventHandlers.handlers["focus-notify"][0]({
      payload: {
        channel: "notification",
        messageType: "Node.Action.Starting",
        name: "NodeA",
        message: "NodeA started",
      },
    });

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    unmount();

    isNotificationGranted.mockReturnValue(false);
    renderTasksPage();
    eventHandlers.handlers["focus-notify"][1]({
      payload: {
        channel: "notification",
        messageType: "Node.Action.Starting",
        name: "NodeA",
        message: "NodeA started",
      },
    });

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "NodeA started",
    );
  });
});

describe("run failure notifications", () => {
  it("shows backend run failures as dismissible in-app notifications", async () => {
    renderTasksPage();

    await waitFor(() =>
      expect(eventHandlers.handlers["run-event"]).toBeDefined(),
    );
    eventHandlers.handlers["run-event"][0]({
      payload: {
        executionId: "run-1",
        sequence: 1,
        atUnixMs: 1,
        kind: "failure",
        state: "Idle",
        message: "the control unit is not connected",
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the control unit is not connected",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("alerts once when a preparing failure arrives via both the invoke error and the run event", async () => {
    const message =
      "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again";
    // Mount-time status is idle; the failed result only exists once the
    // rejected start has been recorded by the backend.
    getRunStatus
      .mockResolvedValueOnce({
        executionId: undefined,
        state: "Idle",
        message: "Idle",
      })
      .mockResolvedValue({
        executionId: "run-1",
        state: "Idle",
        severity: "error",
        message,
      });
    startRun.mockRejectedValue(new Error(message));
    resolveCurrent.mockResolvedValue({
      controller: project.controllers[0],
      resource: project.resources[0],
      tasks: enabledResolvedTasks(),
      basePipeline: {},
      pipelineOverride: {},
    });
    useAppStore.setState({
      snapshot: {
        project,
        configuration: {
          ...configuration,
          runConfigurations: [
            {
              ...configuration.runConfigurations[0],
              tasks: configuration.runConfigurations[0].tasks.map((task) => ({
                ...task,
                enabled: true,
              })),
            },
          ],
        },
      },
    });
    renderTasksPage();

    const start = await screen.findByRole("button", { name: "Start run" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));

    // The backend emits the failure run-event before the invoke rejects.
    eventHandlers.handlers["run-event"].forEach((handler) => {
      handler({
        payload: {
          executionId: "run-1",
          sequence: 1,
          atUnixMs: 1,
          kind: "failure",
          state: "Idle",
          message,
        },
      });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it("adds app error notifications to the task log", async () => {
    renderTasksPage();

    useNotificationStore.getState().notify("Configuration failed", {
      tone: "error",
    });
    const logTab = screen.getByRole("tab", { name: "Task logs" });
    const logPanelId = logTab.getAttribute("aria-controls");
    if (!logPanelId) throw new Error("Task logs panel is not linked");
    const logPanel = document.getElementById(logPanelId);
    if (!logPanel) throw new Error("Task logs panel not found");
    fireEvent.click(logTab);

    expect(
      await within(logPanel).findByText("Configuration failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });
});

describe("run status restoration", () => {
  it("shows the latest backend message after a component remount", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Idle",
      message: "The run failed",
    });

    renderTasksPage();

    expect(await screen.findByText("The run failed")).toBeInTheDocument();
  });

  it("restores failed runs as in-app notifications instead of inline status", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Idle",
      severity: "error",
      message: "The run failed",
    });

    renderTasksPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The run failed",
    );
    expect(screen.getAllByText("The run failed")).toHaveLength(2);
  });

  it("does not restore the same failed run again after changing routes", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Idle",
      severity: "error",
      message: "The run failed",
    });

    const first = renderTasksPage();
    await screen.findByRole("alert");
    await waitFor(() => expect(getRunStatus).toHaveBeenCalledTimes(1));
    first.unmount();

    renderTasksPage();
    await waitFor(() => expect(getRunStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useAppStore.getState().busy).toBe(false));

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it("does not restore a failed run again after saving a checkbox", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Idle",
      severity: "error",
      message: "The run failed",
    });

    renderTasksPage();
    await screen.findByRole("alert");
    await waitFor(() => expect(getRunStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("checkbox", { name: "On" })[1]);
    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useAppStore.getState().saving).toBe(false));

    expect(getRunStatus).toHaveBeenCalledTimes(1);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});

describe("manual screenshot notifications", () => {
  it("shows a run-scoped in-app notice without exposing the raw path", async () => {
    getRunStatus.mockResolvedValue({
      executionId: "run-1",
      state: "Running",
      message: "The run started",
    });
    renderTasksPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Task actions" }),
    );
    const capture = await screen.findByRole("button", { name: "Shot" });
    await waitFor(() => expect(capture).toBeEnabled());
    fireEvent.click(capture);

    const message = await screen.findByText("Screenshot saved to this run.");
    expect(message.closest('[role="status"]')).toHaveTextContent(
      "Screenshot saved to this run.",
    );
    expect(
      screen.queryByText(/\/data\/user\/0\/.*manual-1\.png/),
    ).not.toBeInTheDocument();
  });

  it("ignores the backend screenshot event's diagnostic wording", async () => {
    renderTasksPage();

    await waitFor(() =>
      expect(eventHandlers.handlers["run-event"]).toBeDefined(),
    );
    eventHandlers.handlers["run-event"][0]({
      payload: {
        executionId: "run-1",
        sequence: 1,
        atUnixMs: 1,
        kind: "screenshot",
        state: "Idle",
        message: "Manual screenshot saved: /data/user/0/app/manual-1.png",
      },
    });

    expect(
      screen.queryByText(/Manual screenshot saved:/),
    ).not.toBeInTheDocument();
  });
});

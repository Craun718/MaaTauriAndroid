import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppStateSnapshot } from "../src/lib/types";

const bootstrap = vi.fn();
const resolveCurrent = vi.fn();
const getPrivilegedStatus = vi.fn();
const getRunStatus = vi.fn();
const getVirtualDisplayStatus = vi.fn();

vi.mock("../src/lib/api", () => ({
  bootstrapApp: () => bootstrap(),
  resolveCurrent: () => resolveCurrent(),
  getPrivilegedStatus: () => getPrivilegedStatus(),
  getRunStatus: () => getRunStatus(),
  startVirtualDisplay: vi.fn(),
  stopVirtualDisplay: vi.fn(),
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  updateVirtualDisplayBounds: vi.fn(),
  loadProject: vi.fn(),
  saveConfiguration: vi.fn(),
  applyPreset: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  exportDiagnostics: vi.fn(),
  captureManualScreenshot: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

const snapshot: AppStateSnapshot = {
  project: {
    root: "fixture",
    interfaceVersion: 2,
    name: "maa_tauri_android_fixture",
    label: "MaaTauriAndroid Fixture",
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
    groups: [],
    tasks: [],
    options: {},
    globalOptions: [],
    presets: [],
    metadata: { welcome: [] },
  },
  configuration: {
    schemaVersion: 1,
    initialized: true,
    forceStopTargetApp: false,
    telemetryEnabled: false,
    globalOptionValues: {},
    controllerOptionValues: {},
    resourceOptionValues: {},
    runConfigurations: [],
  },
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bootstrap.mockResolvedValue(snapshot);
    resolveCurrent.mockResolvedValue({
      controller: snapshot.project?.controllers[0],
      resource: snapshot.project?.resources[0],
      tasks: [],
      pipelineOverride: {},
    });
    getPrivilegedStatus.mockResolvedValue({ message: "Not connected", setupRequired: [] });
    getRunStatus.mockResolvedValue({ executionId: undefined, state: "Idle", message: "Idle" });
    getVirtualDisplayStatus.mockResolvedValue({
      active: false,
      displayId: -1,
      width: 1280,
      height: 720,
      frameCount: 0,
    });
  });

  it("bootstraps the project and renders navigation", async () => {
    render(<App />);
    expect(await screen.findByText("MaaTauriAndroid Fixture")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "Tasks & Run" })).toBeInTheDocument();
  });

  it("keeps project-level settings in one tab", async () => {
    render(<App />);
    // The setup page is gone: nothing to configure separately from Settings.
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "More" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // The resource section moved here from the removed setup page.
    expect(screen.getByRole("heading", { name: "Resource" })).toBeInTheDocument();
    expect(screen.getByText("resource/base")).toBeInTheDocument();
  });

  it("shows the run controls and the task list in the same panel", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Tasks" }));

    // Run controls, formerly on their own /run page.
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    // Tasks belonging to the active run configuration, on the same panel.
    expect(screen.getByRole("heading", { name: "Default" })).toBeInTheDocument();
    // The old /run tab is gone.
    expect(screen.queryByRole("link", { name: "Run" })).not.toBeInTheDocument();
  });
});

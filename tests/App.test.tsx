import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppStateSnapshot } from "../src/lib/types";

const bootstrap = vi.fn();
const resolveCurrent = vi.fn();
const getPrivilegedStatus = vi.fn();
const getRunStatus = vi.fn();
const getVirtualDisplayStatus = vi.fn();
const getScheduleStatus = vi.fn();
const updateVirtualDisplayBounds = vi.fn();
const hideVirtualDisplayPreview = vi.fn();

vi.mock("../src/lib/api", () => ({
  bootstrapApp: () => bootstrap(),
  resolveCurrent: () => resolveCurrent(),
  getPrivilegedStatus: () => getPrivilegedStatus(),
  getRunStatus: () => getRunStatus(),
  getScheduleStatus: () => getScheduleStatus(),
  startVirtualDisplay: vi.fn(),
  stopVirtualDisplay: vi.fn(),
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  updateVirtualDisplayBounds: () => updateVirtualDisplayBounds(),
  hideVirtualDisplayPreview: () => hideVirtualDisplayPreview(),
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
    closeTargetAppAfterRun: false,
    telemetryEnabled: false,
    globalOptionValues: {},
    controllerOptionValues: {},
    resourceOptionValues: {},
    runConfigurations: [{ id: "default", name: "Default", tasks: [] }],
  },
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/";
    bootstrap.mockResolvedValue(snapshot);
    resolveCurrent.mockResolvedValue({
      controller: snapshot.project?.controllers[0],
      resource: snapshot.project?.resources[0],
      tasks: [],
      pipelineOverride: {},
    });
    getPrivilegedStatus.mockResolvedValue({
      message: "Not connected",
      setupRequired: [],
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
    getScheduleStatus.mockResolvedValue({
      ruleCount: 0,
      enabledCount: 0,
      nextTriggerEpochMs: undefined,
      lastTrigger: undefined,
    });
    updateVirtualDisplayBounds.mockResolvedValue(undefined);
    hideVirtualDisplayPreview.mockResolvedValue(undefined);
  });

  it("bootstraps the project", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "MaaTauriAndroid Fixture" }),
    ).toBeInTheDocument();
  });
});

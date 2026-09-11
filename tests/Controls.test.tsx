import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunPanel } from "../src/components/RunPanel";
import { SettingsPage } from "../src/pages/SettingsPage";
import { useAppStore } from "../src/store/appStore";
import type { AppStateSnapshot, ResolvedRun } from "../src/lib/types";

const getPrivilegedStatus = vi.fn();
const saveConfiguration = vi.fn();
const clearDiagnosticData = vi.fn();
const resolveCurrent = vi.fn();
const getRunStatus = vi.fn();
const captureManualScreenshot = vi.fn();

vi.mock("../src/lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  saveConfiguration: (configuration: unknown) => saveConfiguration(configuration),
  clearDiagnosticData: () => clearDiagnosticData(),
  resolveCurrent: () => resolveCurrent(),
  getRunStatus: () => getRunStatus(),
  captureManualScreenshot: (executionId?: string) => captureManualScreenshot(executionId),
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
    controllers: [{ name: "Android", label: "Android", controllerType: "Adb" }],
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
    globalOptionValues: {},
    controllerOptionValues: {},
    resourceOptionValues: {},
    runConfigurations: [],
  },
};

describe("diagnostic controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ snapshot, busy: false, error: undefined });
    getPrivilegedStatus.mockResolvedValue({ message: "Connected", setupRequired: [] });
    saveConfiguration.mockImplementation(async (configuration: unknown) => configuration);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("saves the force-stop preference", async () => {
    render(<SettingsPage />);
    const toggle = await screen.findByRole("checkbox", { name: "Force stop target app" });

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(saveConfiguration).toHaveBeenCalledTimes(1);
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({ forceStopTargetApp: true });
  });

  it("requires confirmation before deleting stored runs", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    clearDiagnosticData.mockResolvedValue({ deletedRunCount: 3, runsDir: "/runs" });
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete runs" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Deleted 3 run directories")).toBeInTheDocument();
  });

  it("captures and displays a manual screenshot", async () => {
    getRunStatus.mockResolvedValue({ executionId: "run-1", state: "Running", message: "Running" });
    resolveCurrent.mockResolvedValue({
      controller: snapshot.project!.controllers[0],
      resource: snapshot.project!.resources[0],
      tasks: [],
      basePipeline: {},
      pipelineOverride: {},
    } as ResolvedRun);
    captureManualScreenshot.mockResolvedValue({
      executionId: "run-1",
      path: "/runs/run-1/screens/manual-1.png",
    });
    render(<RunPanel />);
    const capture = await screen.findByRole("button", { name: "Shot" });
    await waitFor(() => expect(capture).toBeEnabled());

    fireEvent.click(capture);

    expect(captureManualScreenshot).toHaveBeenCalledWith("run-1");
    expect(
      await screen.findByText("/runs/run-1/screens/manual-1.png"),
    ).toBeInTheDocument();
  });
});

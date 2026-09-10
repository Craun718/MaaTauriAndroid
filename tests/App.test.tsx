import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppStateSnapshot } from "../src/lib/types";

const bootstrap = vi.fn();
const resolveCurrent = vi.fn();
const getPrivilegedStatus = vi.fn();

vi.mock("../src/lib/api", () => ({
  bootstrapApp: () => bootstrap(),
  resolveCurrent: () => resolveCurrent(),
  getPrivilegedStatus: () => getPrivilegedStatus(),
  loadProject: vi.fn(),
  saveConfiguration: vi.fn(),
  applyPreset: vi.fn(),
  startRun: vi.fn(),
}));

const snapshot: AppStateSnapshot = {
  project: {
    root: "fixture",
    interfaceVersion: 2,
    name: "ttflow_fixture",
    label: "TTFlow Fixture",
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
  });

  it("bootstraps the project and renders navigation", async () => {
    render(<App />);
    expect(await screen.findByText("TTFlow Fixture")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });
});

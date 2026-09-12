import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { useAppStore } from "../store/appStore";
import type { AppStateSnapshot, Project, UserConfiguration } from "../lib/types";

const getPrivilegedStatus = vi.fn();
const resolveCurrent = vi.fn();

vi.mock("../lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  openShizuku: vi.fn(),
  requestPrivilegedAccess: vi.fn(),
  resolveCurrent: () => resolveCurrent(),
}));

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
      name: "resource-a",
      label: "Resource A",
      description: "Base **resource**",
      paths: ["resource/base"],
      controllers: [],
      options: [],
    },
    {
      name: "resource-b",
      label: "Resource B",
      paths: ["resource/alt"],
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
};

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  telemetryEnabled: false,
  activeResource: undefined,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  const snapshot: AppStateSnapshot = { project, configuration };
  useAppStore.setState({ snapshot, busy: false, error: undefined });
  getPrivilegedStatus.mockResolvedValue({
    status: "connected",
    message: "Connected",
  });
  resolveCurrent.mockResolvedValue({
    controller: project.controllers[0],
    resource: project.resources[0],
    tasks: [],
    basePipeline: {},
    pipelineOverride: {},
  });
});

describe("home resource details", () => {
  it("shows the resolved resource with its description and paths", async () => {
    render(<HomePage />);

    await screen.findByText("resource/base");
    expect(screen.getByRole("heading", { name: "Resource" })).toBeInTheDocument();
    expect(screen.getAllByText("Resource A").length).toBe(2);
    expect(screen.getByText("resource").tagName).toBe("STRONG");
    expect(screen.getByText("resource/base")).toBeInTheDocument();
    // The resource is resolved automatically and is not offered as a choice.
    expect(screen.queryByText("Resource B")).not.toBeInTheDocument();
  });
});

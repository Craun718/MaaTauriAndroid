import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "../store/appStore";
import type { AppStateSnapshot, Project, UserConfiguration } from "../lib/types";

const getPrivilegedStatus = vi.fn();
const saveConfiguration = vi.fn();

vi.mock("../lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  saveConfiguration: (configuration: unknown) => saveConfiguration(configuration),
  loadProject: vi.fn(),
  clearDiagnosticData: vi.fn(),
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
      paths: ["resource/base"],
      controllers: [],
      options: ["resolution"],
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
  options: {
    resolution: {
      kind: "select",
      name: "resolution",
      label: "Resolution",
      cases: [
        { name: "720p", label: "720p", options: [] },
        { name: "1080p", label: "1080p", options: [] },
      ],
      applicability: { controllers: [], resources: [] },
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
  getPrivilegedStatus.mockResolvedValue({ message: "Connected", setupRequired: [] });
  saveConfiguration.mockImplementation(async (next: unknown) => next);
});

describe("project scope in settings", () => {
  it("shows the resource the project resolves to, and nothing to pick", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Resource" })).toBeInTheDocument();
    expect(screen.getByText("Resource A")).toBeInTheDocument();
    expect(screen.getByText("resource/base")).toBeInTheDocument();
    // The second resource is not offered as a choice, so clicking it is a no-op.
    expect(screen.queryByText("Resource B")).not.toBeInTheDocument();
  });

  it("saves a resource option change", async () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("radio", { name: "1080p" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({
      resourceOptionValues: {
        "resource-a": { resolution: { type: "single", case: "1080p" } },
      },
    });
  });
});

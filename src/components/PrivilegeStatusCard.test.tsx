import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrivilegeStatusCard } from "./PrivilegeStatusCard";
import { useAppStore } from "../store/appStore";
import type { AppStateSnapshot, Project, UserConfiguration } from "../lib/types";

const getPrivilegedStatus = vi.fn();
const requestPrivilegedAccess = vi.fn();
const openShizuku = vi.fn();

vi.mock("../lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  requestPrivilegedAccess: () => requestPrivilegedAccess(),
  openShizuku: () => openShizuku(),
}));

const project: Project = {
  root: "/fixtures",
  interfaceVersion: 2,
  name: "fixture",
  label: "Fixture",
  language: "en_us",
  languages: ["en_us"],
  controllers: [],
  resources: [],
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
  useAppStore.setState({
    snapshot: { project, configuration } satisfies AppStateSnapshot,
    busy: false,
    error: undefined,
  });
});

describe("PrivilegeStatusCard", () => {
  it("renders the starting state without a retry action", async () => {
    getPrivilegedStatus.mockResolvedValue({
      status: "starting",
      message: "starting",
      setupRequired: [],
    });

    render(<PrivilegeStatusCard title="privileges" />);

    expect(await screen.findByText("Connecting")).toBeInTheDocument();
    expect(
      screen.getByText("Connecting to the privileged control unit through Shizuku."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps the manual permission action in the granted state", async () => {
    getPrivilegedStatus.mockResolvedValue({
      status: "connected",
      message: "connected",
    });

    render(<PrivilegeStatusCard title="privileges" />);

    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(
      screen.getByText("The privileged control unit is connected and ready to run tasks."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request Shizuku permission" }),
    ).toBeInTheDocument();
  });

  it("requests Shizuku access and refreshes the status", async () => {
    getPrivilegedStatus
      .mockResolvedValueOnce({
        status: "permissionRequired",
        message: "permission required",
        setupRequired: ["grant access"],
      })
      .mockResolvedValueOnce({ status: "connected", message: "connected" });
    requestPrivilegedAccess.mockResolvedValue(undefined);

    render(<PrivilegeStatusCard title="privileges" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Request Shizuku permission" }),
    );

    await waitFor(() => expect(requestPrivilegedAccess).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(2);
    expect(
      screen.getAllByRole("button", { name: "Request Shizuku permission" }),
    ).toHaveLength(1);
  });

  it("offers the Shizuku shortcut when the service is unavailable", async () => {
    getPrivilegedStatus.mockResolvedValue({
      status: "notInstalled",
      message: "unavailable",
      setupRequired: ["install Shizuku"],
    });
    openShizuku.mockResolvedValue(undefined);

    render(<PrivilegeStatusCard title="privileges" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Shizuku" }));

    await waitFor(() => expect(openShizuku).toHaveBeenCalledTimes(1));
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(1);
  });

  it("shows status loading failures", async () => {
    getPrivilegedStatus.mockRejectedValue(new Error("Status failed"));

    render(<PrivilegeStatusCard title="privileges" />);

    expect(await screen.findByText("Status failed")).toBeInTheDocument();
  });
});

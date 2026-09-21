import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { PrivilegeStatusCard } from "./PrivilegeStatusCard";
import { NotificationHost } from "./ui/NotificationHost";

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
  closeTargetAppAfterRun: false,
  telemetryEnabled: false,
  activeResource: undefined,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.setState({ notifications: [] });
  useAppStore.setState({
    snapshot: { project, configuration } satisfies AppStateSnapshot,
    busy: false,
    error: undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPrivilegeStatusCard() {
  return render(
    <>
      <NotificationHost />
      <PrivilegeStatusCard title="privileges" />
    </>,
  );
}

describe("PrivilegeStatusCard", () => {
  it("polls a starting service until it connects", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getPrivilegedStatus
      .mockResolvedValueOnce({
        status: "starting",
        message: "starting",
        setupRequired: [],
      })
      .mockResolvedValueOnce({ status: "connected", message: "connected" });

    renderPrivilegeStatusCard();

    expect(await screen.findByText("Connecting")).toBeInTheDocument();
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(2);
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

    renderPrivilegeStatusCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Request Shizuku permission" }),
    );

    await waitFor(() =>
      expect(requestPrivilegedAccess).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(2);
    expect(
      screen.getAllByRole("button", { name: "Request Shizuku permission" }),
    ).toHaveLength(1);
  });

  it("refreshes the status after a permission request fails", async () => {
    getPrivilegedStatus
      .mockResolvedValueOnce({
        status: "permissionRequired",
        message: "permission required",
        setupRequired: ["grant access"],
      })
      .mockResolvedValueOnce({ status: "connected", message: "connected" });
    requestPrivilegedAccess.mockRejectedValue(
      new Error("The permission request timed out"),
    );

    renderPrivilegeStatusCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Request Shizuku permission" }),
    );

    expect(
      await screen.findByText("The permission request timed out"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Granted")).toBeInTheDocument();
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(2);
  });

  it("shows refresh activity while the status request is pending", () => {
    getPrivilegedStatus.mockReturnValue(new Promise(() => undefined));

    renderPrivilegeStatusCard();

    const refreshButton = screen.getByRole("button", {
      name: "Refresh status",
    });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton.querySelector("svg")).toHaveClass("animate-spin");
  });

  it("offers the Shizuku shortcut when the service is unavailable", async () => {
    getPrivilegedStatus.mockResolvedValue({
      status: "notInstalled",
      message: "unavailable",
      setupRequired: ["install Shizuku"],
    });
    openShizuku.mockResolvedValue(undefined);

    renderPrivilegeStatusCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Shizuku" }),
    );

    await waitFor(() => expect(openShizuku).toHaveBeenCalledTimes(1));
    expect(getPrivilegedStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps both Shizuku actions available while connected", async () => {
    getPrivilegedStatus.mockResolvedValue({
      status: "connected",
      message: "connected",
    });
    openShizuku.mockResolvedValue(undefined);

    renderPrivilegeStatusCard();

    const openButton = await screen.findByRole("button", {
      name: "Open Shizuku",
    });
    await waitFor(() => expect(openButton).toBeEnabled());
    fireEvent.click(openButton);
    await waitFor(() => expect(openShizuku).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "Request Shizuku permission" }),
    ).toBeEnabled();
  });

  it("shows status loading failures", async () => {
    getPrivilegedStatus.mockRejectedValue(new Error("Status failed"));

    renderPrivilegeStatusCard();

    expect(await screen.findByText("Status failed")).toBeInTheDocument();
  });
});

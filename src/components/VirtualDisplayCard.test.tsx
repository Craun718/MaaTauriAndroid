import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualDisplayStatus } from "../lib/types";
import { useNotificationStore } from "../store/notificationStore";
import { NotificationHost } from "./ui/NotificationHost";
import { VirtualDisplayCard } from "./VirtualDisplayCard";

const getVirtualDisplayStatus = vi.fn();
const getVirtualDisplayStream = vi.fn();
const stopRun = vi.fn();
const stopVirtualDisplay = vi.fn();
const touchVirtualDisplay = vi.fn();
const setVirtualDisplayLandscape = vi.fn();
const setVirtualDisplayTouchMarkers = vi.fn();

vi.mock("../lib/api", () => ({
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  getVirtualDisplayStream: () => getVirtualDisplayStream(),
  stopRun: () => stopRun(),
  stopVirtualDisplay: () => stopVirtualDisplay(),
  touchVirtualDisplay: () => touchVirtualDisplay(),
  setVirtualDisplayLandscape: () => setVirtualDisplayLandscape(),
  setVirtualDisplayTouchMarkers: () => setVirtualDisplayTouchMarkers(),
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
    (event: string, handler: (event: { payload: unknown }) => void) => {
      eventHandlers.handlers[event] ??= [];
      eventHandlers.handlers[event].push(handler);
      return Promise.resolve(() => undefined);
    },
  ),
}));

const eventHandlers = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<(event: { payload: unknown }) => void>>,
}));

const inactive: VirtualDisplayStatus = {
  active: false,
  displayId: -1,
  width: 1280,
  height: 720,
  frameCount: 0,
};

const active: VirtualDisplayStatus = {
  active: true,
  displayId: 12,
  width: 1280,
  height: 720,
  frameCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  eventHandlers.handlers = {};
  useNotificationStore.setState({ notifications: [] });
  getVirtualDisplayStatus.mockResolvedValue(inactive);
  getVirtualDisplayStream.mockResolvedValue({
    url: "ws://127.0.0.1:8080/virtual-display-stream?token=test",
  });
  setVirtualDisplayTouchMarkers.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderVirtualDisplayCard() {
  return render(
    <>
      <NotificationHost />
      <VirtualDisplayCard />
    </>,
  );
}

describe("VirtualDisplayCard", () => {
  it("renders the inactive state", async () => {
    renderVirtualDisplayCard();

    expect(
      await screen.findByRole("heading", { name: "Virtual display" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Stopped")).toHaveLength(1);
    expect(screen.queryByText("1280 x 720")).not.toBeInTheDocument();
    expect(getVirtualDisplayStream).not.toHaveBeenCalled();
  });

  it("reports that the WebView cannot decode when WebCodecs is absent", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);

    renderVirtualDisplayCard();

    expect(await screen.findByText("Display ID: 12")).toBeInTheDocument();
    expect(
      await screen.findByText("WebView cannot decode the stream"),
    ).toBeInTheDocument();
  });

  it("refreshes status when the backend activates the display", async () => {
    getVirtualDisplayStatus
      .mockResolvedValueOnce(inactive)
      .mockResolvedValue(active);

    renderVirtualDisplayCard();
    expect(await screen.findByText("Stopped")).toBeInTheDocument();

    eventHandlers.handlers["virtual-display-changed"]?.forEach((handler) => {
      handler({ payload: undefined });
    });

    expect(await screen.findByText("Display ID: 12")).toBeInTheDocument();
  });

  it("stops the display", async () => {
    stopRun.mockResolvedValue("The run is stopping");
    getVirtualDisplayStatus.mockResolvedValueOnce(active);
    stopVirtualDisplay.mockResolvedValue(inactive);

    renderVirtualDisplayCard();
    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);

    expect(stopRun).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stopVirtualDisplay).toHaveBeenCalledTimes(1));
    expect(stopVirtualDisplay).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stopRun).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(stopVirtualDisplay).mock.invocationCallOrder[0],
    );
    expect(await screen.findAllByText("Stopped")).toHaveLength(1);
    expect(screen.queryByText("1280 x 720")).not.toBeInTheDocument();
  });

  it("shows stop failures", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    stopVirtualDisplay.mockRejectedValue(new Error("Stop failed"));

    renderVirtualDisplayCard();
    const stop = await screen.findByRole("button", { name: "Stop" });
    await waitFor(() => expect(stop).toBeEnabled());
    fireEvent.click(stop);
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    fireEvent.click(confirm);

    expect(await screen.findByText("Stop failed")).toBeInTheDocument();
  });
});

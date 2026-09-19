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
const stopVirtualDisplay = vi.fn();
const updateVirtualDisplayBounds = vi.fn();
const hideVirtualDisplayPreview = vi.fn();

vi.mock("../lib/api", () => ({
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  stopVirtualDisplay: () => stopVirtualDisplay(),
  updateVirtualDisplayBounds: (...args: unknown[]) =>
    updateVirtualDisplayBounds(...args),
  hideVirtualDisplayPreview: () => hideVirtualDisplayPreview(),
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
  updateVirtualDisplayBounds.mockResolvedValue(undefined);
  hideVirtualDisplayPreview.mockResolvedValue(undefined);
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
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
  });

  it("reports the preview bounds while the display is active", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: -16,
      top: -120,
      width: 320,
      height: 180,
    } as DOMRect);

    renderVirtualDisplayCard();

    expect(await screen.findByText("Display ID: 12")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Running").nextElementSibling).toHaveTextContent(
      "1280 x 720",
    );
    await waitFor(() =>
      expect(updateVirtualDisplayBounds).toHaveBeenCalledWith(
        -16,
        -120,
        320,
        180,
      ),
    );
  });

  it("reports preview bounds from an ancestor scroll container", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        left: -16,
        top: -120,
        width: 320,
        height: 180,
      } as DOMRect);

    render(
      <>
        <NotificationHost />
        <main>
          <VirtualDisplayCard />
        </main>
      </>,
    );

    await screen.findByText("Display ID: 12");
    await waitFor(() => expect(updateVirtualDisplayBounds).toHaveBeenCalled());
    updateVirtualDisplayBounds.mockClear();
    getBoundingClientRect.mockReturnValue({
      left: 8,
      top: 24,
      width: 360,
      height: 200,
    } as DOMRect);

    const scrollContainer = screen
      .getByRole("heading", { name: "Virtual display" })
      .closest("main");
    if (!scrollContainer) throw new Error("scroll container not found");
    fireEvent.scroll(scrollContainer);

    await waitFor(() =>
      expect(updateVirtualDisplayBounds).toHaveBeenCalledWith(8, 24, 360, 200),
    );
  });

  it("hides the native preview when the card unmounts", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    const { unmount } = renderVirtualDisplayCard();

    await screen.findByText("Display ID: 12");
    unmount();

    expect(hideVirtualDisplayPreview).toHaveBeenCalledTimes(1);
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
    getVirtualDisplayStatus.mockResolvedValueOnce(active);
    stopVirtualDisplay.mockResolvedValue(inactive);

    renderVirtualDisplayCard();
    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);

    expect(stopVirtualDisplay).toHaveBeenCalledTimes(1);
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

    expect(await screen.findByText("Stop failed")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualDisplayStatus } from "../lib/types";
import { VirtualDisplayCard } from "./VirtualDisplayCard";

const getVirtualDisplayStatus = vi.fn();
const stopVirtualDisplay = vi.fn();
const updateVirtualDisplayBounds = vi.fn();

vi.mock("../lib/api", () => ({
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  stopVirtualDisplay: () => stopVirtualDisplay(),
  updateVirtualDisplayBounds: (...args: unknown[]) =>
    updateVirtualDisplayBounds(...args),
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
  getVirtualDisplayStatus.mockResolvedValue(inactive);
  updateVirtualDisplayBounds.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VirtualDisplayCard", () => {
  it("renders the inactive state", async () => {
    render(<VirtualDisplayCard />);

    expect(
      await screen.findByRole("heading", { name: "1280 x 720" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Stopped")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
  });

  it("reports the preview bounds while the display is active", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 16,
      top: 120,
      width: 320,
      height: 180,
    } as DOMRect);

    render(<VirtualDisplayCard />);

    expect(await screen.findByText("Display ID: 12")).toBeInTheDocument();
    await waitFor(() =>
      expect(updateVirtualDisplayBounds).toHaveBeenCalledWith(
        16,
        120,
        320,
        180,
      ),
    );
  });

  it("stops the display", async () => {
    getVirtualDisplayStatus.mockResolvedValueOnce(active);
    stopVirtualDisplay.mockResolvedValue(inactive);

    render(<VirtualDisplayCard />);
    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);

    expect(stopVirtualDisplay).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText("Stopped")).toHaveLength(1);
  });

  it("shows stop failures", async () => {
    getVirtualDisplayStatus.mockResolvedValue(active);
    stopVirtualDisplay.mockRejectedValue(new Error("Stop failed"));

    render(<VirtualDisplayCard />);
    const stop = await screen.findByRole("button", { name: "Stop" });
    await waitFor(() => expect(stop).toBeEnabled());
    fireEvent.click(stop);

    expect(await screen.findByText("Stop failed")).toBeInTheDocument();
  });
});

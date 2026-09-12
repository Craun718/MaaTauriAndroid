import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualDisplayCard } from "./VirtualDisplayCard";
import type { VirtualDisplayStatus } from "../lib/types";

const getVirtualDisplayStatus = vi.fn();
const startVirtualDisplay = vi.fn();
const stopVirtualDisplay = vi.fn();
const updateVirtualDisplayBounds = vi.fn();

vi.mock("../lib/api", () => ({
  getVirtualDisplayStatus: () => getVirtualDisplayStatus(),
  startVirtualDisplay: () => startVirtualDisplay(),
  stopVirtualDisplay: () => stopVirtualDisplay(),
  updateVirtualDisplayBounds: (...args: unknown[]) => updateVirtualDisplayBounds(...args),
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

    expect(await screen.findByRole("heading", { name: "Virtual display" })).toBeInTheDocument();
    expect(screen.getAllByText("Stopped")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("starts the display and reports the preview bounds", async () => {
    startVirtualDisplay.mockResolvedValue(active);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 16,
      top: 120,
      width: 320,
      height: 180,
    } as DOMRect);

    render(<VirtualDisplayCard />);
    expect(await screen.findByText("1280 x 720")).toBeInTheDocument();
    const start = await screen.findByRole("button", { name: "Start" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(await screen.findByText("Display ID: 12")).toBeInTheDocument();
    await waitFor(() =>
      expect(updateVirtualDisplayBounds).toHaveBeenCalledWith(16, 120, 320, 180),
    );
  });

  it("shows action failures", async () => {
    startVirtualDisplay.mockRejectedValue(new Error("Start failed"));
    getVirtualDisplayStatus.mockResolvedValue(inactive);

    render(<VirtualDisplayCard />);
    expect(await screen.findByText("1280 x 720")).toBeInTheDocument();
    const start = await screen.findByRole("button", { name: "Start" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);

    expect(await screen.findByText("Start failed")).toBeInTheDocument();
  });
});

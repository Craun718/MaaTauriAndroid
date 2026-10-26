import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfiguration } from "../lib/api";
import { GUIDE_VERSION } from "../lib/guide";
import type { UserConfiguration } from "../lib/types";
import { useAppStore, waitForPendingSaves } from "./appStore";
import { useGuideStore } from "./guideStore";
import { useNotificationStore } from "./notificationStore";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  saveConfiguration: vi.fn(),
}));

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  closeTargetAppAfterRun: true,
  telemetryEnabled: false,
  activeResource: "original",
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

beforeEach(async () => {
  await waitForPendingSaves();
  vi.clearAllMocks();
  vi.mocked(saveConfiguration).mockImplementation(async (value) => value);
  useAppStore.setState({
    snapshot: { configuration },
    saving: false,
    error: undefined,
  });
  useGuideStore.setState({
    active: false,
    dismissed: false,
    target: undefined,
  });
  useNotificationStore.setState({ notifications: [], seenKeys: new Set() });
});

describe("guide lifecycle", () => {
  it("starts once and keeps the current target on a repeated start", () => {
    useGuideStore.getState().start();
    useGuideStore.getState().setTarget("tasks-run");
    useGuideStore.getState().start();

    expect(useGuideStore.getState()).toMatchObject({
      active: true,
      dismissed: true,
      target: "tasks-run",
    });
    expect(saveConfiguration).not.toHaveBeenCalled();
  });

  it("saves completion or explicit skip once with the latest configuration", async () => {
    useGuideStore.getState().start();
    useAppStore.setState({
      snapshot: {
        configuration: { ...configuration, activeResource: "updated" },
      },
    });
    useGuideStore.getState().finish();
    useGuideStore.getState().finish();
    await waitForPendingSaves();

    expect(saveConfiguration).toHaveBeenCalledExactlyOnceWith({
      ...configuration,
      activeResource: "updated",
      guideSeenVersion: GUIDE_VERSION,
    });
    expect(useGuideStore.getState()).toMatchObject({
      active: false,
      dismissed: true,
      target: undefined,
    });
    expect(
      useAppStore.getState().snapshot?.configuration.guideSeenVersion,
    ).toBe(GUIDE_VERSION);
  });

  it("cancels an interrupted guide without recording completion and allows replay", () => {
    useGuideStore.getState().start();
    useGuideStore.getState().cancel();
    useGuideStore.getState().setTarget("tasks-run");
    useGuideStore.getState().finish();
    expect(saveConfiguration).not.toHaveBeenCalled();
    expect(useGuideStore.getState()).toMatchObject({
      active: false,
      dismissed: true,
      target: undefined,
    });
    useGuideStore.getState().start();
    expect(useGuideStore.getState().active).toBe(true);
  });

  it("reports a failed save without reopening the guide in the current session", async () => {
    vi.mocked(saveConfiguration).mockRejectedValueOnce(new Error("disk full"));
    useGuideStore.getState().start();
    useGuideStore.getState().finish();
    await waitForPendingSaves();

    expect(useAppStore.getState().error).toBe("disk full");
    expect(useGuideStore.getState()).toMatchObject({
      active: false,
      dismissed: true,
    });
    expect(useNotificationStore.getState().notifications).toEqual([
      expect.objectContaining({ tone: "error" }),
    ]);
  });

  it("does not save on replay of the current or a newer revision", () => {
    for (const revision of [GUIDE_VERSION, GUIDE_VERSION + 1]) {
      useAppStore.setState({
        snapshot: {
          configuration: { ...configuration, guideSeenVersion: revision },
        },
      });
      useGuideStore.getState().start();
      useGuideStore.getState().finish();
    }
    expect(saveConfiguration).not.toHaveBeenCalled();
  });

  it("can close safely when the project snapshot disappears", () => {
    useGuideStore.getState().start();
    useAppStore.setState({ snapshot: undefined });
    useGuideStore.getState().finish();
    expect(useGuideStore.getState().active).toBe(false);
    expect(saveConfiguration).not.toHaveBeenCalled();
  });
});

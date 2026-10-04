import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPreset, saveConfiguration } from "../lib/api";
import type { AppStateSnapshot, UserConfiguration } from "../lib/types";
import { useAppStore, waitForPendingSaves } from "./appStore";
import { useNotificationStore } from "./notificationStore";

vi.mock("../lib/api", () => ({
  applyPreset: vi.fn(),
  bootstrapApp: vi.fn(),
  loadProject: vi.fn(),
  reinstallResources: vi.fn(),
  saveConfiguration: vi.fn(),
}));

const mockedSaveConfiguration = vi.mocked(saveConfiguration);
const mockedApplyPreset = vi.mocked(applyPreset);

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

function configurationWith(
  changes: Partial<UserConfiguration>,
): UserConfiguration {
  return { ...configuration, ...changes };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("appStore saveConfiguration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const snapshot: AppStateSnapshot = { configuration };
    useAppStore.setState({
      snapshot,
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("tracks a save without claiming that all app work is blocked", async () => {
    const next = configurationWith({ forceStopTargetApp: true });
    const persisted = configurationWith({ forceStopTargetApp: true });
    const request = deferred<UserConfiguration>();
    mockedSaveConfiguration.mockReturnValue(request.promise);

    const save = useAppStore.getState().saveConfiguration(next);

    expect(useAppStore.getState().saving).toBe(true);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().snapshot?.configuration).toBe(next);

    request.resolve(persisted);
    await save;

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
  });

  it("clears the saving state and reports a failed save", async () => {
    mockedSaveConfiguration.mockRejectedValue(new Error("Save failed"));

    await useAppStore
      .getState()
      .saveConfiguration(configurationWith({ telemetryEnabled: true }));

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBe("Save failed");
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { tone: "error", message: "Save failed" },
    ]);
  });
});

describe("appStore waitForPendingSaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      snapshot: { configuration },
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("resolves immediately when no save is queued", async () => {
    await expect(waitForPendingSaves()).resolves.toBeUndefined();
  });

  it("resolves only after the queued save reaches the backend", async () => {
    const request = deferred<UserConfiguration>();
    mockedSaveConfiguration.mockReturnValue(request.promise);

    const save = useAppStore
      .getState()
      .saveConfiguration(configurationWith({ forceStopTargetApp: true }));
    let settled = false;
    const waited = waitForPendingSaves().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const persisted = configurationWith({ forceStopTargetApp: true });
    request.resolve(persisted);
    await waited;
    await save;

    expect(settled).toBe(true);
    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
  });

  it("resolves after a failed save so a start is not blocked forever", async () => {
    mockedSaveConfiguration.mockRejectedValue(new Error("Save failed"));

    const save = useAppStore
      .getState()
      .saveConfiguration(configurationWith({ telemetryEnabled: true }));

    await expect(waitForPendingSaves()).resolves.toBeUndefined();
    await save;

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().error).toBe("Save failed");
  });

  it("waits for an in-flight preset before resolving", async () => {
    const persisted = configurationWith({ telemetryEnabled: true });
    const request = deferred<UserConfiguration>();
    mockedApplyPreset.mockReturnValue(request.promise);

    const applying = useAppStore.getState().applyPreset("daily");
    let settled = false;
    const waited = waitForPendingSaves().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useAppStore.getState().saving).toBe(true);
    expect(useAppStore.getState().busy).toBe(false);

    request.resolve(persisted);
    await waited;
    await applying;

    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
  });

  it("keeps a task edit made after a preset request", async () => {
    const presetResult = configurationWith({ telemetryEnabled: true });
    const edited = configurationWith({ forceStopTargetApp: true });
    const savedResult = configurationWith({ forceStopTargetApp: true });
    const applyRequest = deferred<UserConfiguration>();
    const saveRequest = deferred<UserConfiguration>();
    mockedApplyPreset.mockReturnValue(applyRequest.promise);
    mockedSaveConfiguration.mockReturnValue(saveRequest.promise);

    const applying = useAppStore.getState().applyPreset("daily");
    const saving = useAppStore.getState().saveConfiguration(edited);
    applyRequest.resolve(presetResult);
    await applying;

    expect(useAppStore.getState().snapshot?.configuration).toBe(edited);
    expect(useAppStore.getState().saving).toBe(true);

    saveRequest.resolve(savedResult);
    await saving;

    expect(useAppStore.getState().snapshot?.configuration).toBe(savedResult);
    expect(useAppStore.getState().saving).toBe(false);
  });

  it("clears the saving state and reports a failed preset", async () => {
    mockedApplyPreset.mockRejectedValue(new Error("Preset failed"));

    await useAppStore.getState().applyPreset("daily");

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBe("Preset failed");
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { tone: "error", message: "Preset failed" },
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelUpdate,
  checkForUpdate,
  getUpdatePrefs,
  getUpdateStatus,
  installUpdate,
  resolveUpdate,
  setUpdatePrefs,
} from "../lib/api";
import type { UpdatePrefs, UpdateStatus } from "../lib/types";
import { isActiveUpdatePhase, useUpdateStore } from "./updateStore";

vi.mock("../lib/api", () => ({
  getUpdateStatus: vi.fn(),
  checkForUpdate: vi.fn(),
  resolveUpdate: vi.fn(),
  cancelUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdatePrefs: vi.fn(),
  setUpdatePrefs: vi.fn(),
}));

function status(
  phase: UpdateStatus["phase"],
  overrides?: Partial<UpdateStatus>,
): UpdateStatus {
  return {
    phase,
    currentVersion: "0.1.0",
    latestVersion: null,
    releaseNote: null,
    failure: null,
    failureDetail: null,
    downloadedBytes: null,
    totalBytes: null,
    apkPath: null,
    ...overrides,
  };
}

const prefs: UpdatePrefs = { source: "auto", channel: "stable", cdk: "" };

const mocked = {
  getUpdateStatus: vi.mocked(getUpdateStatus),
  checkForUpdate: vi.mocked(checkForUpdate),
  resolveUpdate: vi.mocked(resolveUpdate),
  cancelUpdate: vi.mocked(cancelUpdate),
  installUpdate: vi.mocked(installUpdate),
  getUpdatePrefs: vi.mocked(getUpdatePrefs),
  setUpdatePrefs: vi.mocked(setUpdatePrefs),
};

describe("isActiveUpdatePhase", () => {
  it("marks only the phases with a backend task in flight", () => {
    expect(isActiveUpdatePhase("checking")).toBe(true);
    expect(isActiveUpdatePhase("resolving")).toBe(true);
    expect(isActiveUpdatePhase("downloading")).toBe(true);
    expect(isActiveUpdatePhase("idle")).toBe(false);
    expect(isActiveUpdatePhase("upToDate")).toBe(false);
    expect(isActiveUpdatePhase("available")).toBe(false);
    expect(isActiveUpdatePhase("installPrompted")).toBe(false);
    expect(isActiveUpdatePhase("installFailed")).toBe(false);
  });
});

describe("updateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateStore.setState({
      status: undefined,
      prefs: undefined,
      prefsBusy: false,
    });
  });

  it("loads status and prefs together", async () => {
    mocked.getUpdateStatus.mockResolvedValue(status("upToDate"));
    mocked.getUpdatePrefs.mockResolvedValue(prefs);

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().status?.phase).toBe("upToDate");
    expect(useUpdateStore.getState().prefs).toEqual(prefs);
  });

  it("keeps the store empty when the backend rejects during load", async () => {
    mocked.getUpdateStatus.mockRejectedValue(new Error("gone"));
    mocked.getUpdatePrefs.mockRejectedValue(new Error("gone"));

    await useUpdateStore.getState().load();

    expect(useUpdateStore.getState().status).toBeUndefined();
    expect(useUpdateStore.getState().prefs).toBeUndefined();
  });

  it("switches to checking right away and adopts the check result", async () => {
    useUpdateStore.setState({ status: status("idle") });
    let resolveCheck!: (value: UpdateStatus) => void;
    mocked.checkForUpdate.mockReturnValue(
      new Promise<UpdateStatus>((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const running = useUpdateStore.getState().check();

    // The backend returns only after spawning its task; the card must show
    // the active phase without waiting for the network round trip.
    expect(useUpdateStore.getState().status?.phase).toBe("checking");

    resolveCheck(status("available", { latestVersion: "0.2.0" }));
    await running;

    expect(useUpdateStore.getState().status?.phase).toBe("available");
    expect(useUpdateStore.getState().status?.latestVersion).toBe("0.2.0");
  });

  it("clears a stale failure when a new check starts", async () => {
    useUpdateStore.setState({
      status: status("idle", { failure: "network", failureDetail: "boom" }),
    });
    mocked.checkForUpdate.mockResolvedValue(status("upToDate"));

    await useUpdateStore.getState().check();

    expect(useUpdateStore.getState().status?.failure).toBeNull();
  });

  it("switches to resolving and keeps the pending update", async () => {
    useUpdateStore.setState({
      status: status("available", { latestVersion: "0.2.0" }),
    });
    mocked.resolveUpdate.mockResolvedValue(
      status("downloading", {
        latestVersion: "0.2.0",
        downloadedBytes: 1024,
        totalBytes: 2048,
      }),
    );

    await useUpdateStore.getState().resolve();

    // The optimistic echo happens before the response, then the response wins.
    expect(useUpdateStore.getState().status?.phase).toBe("downloading");
    expect(useUpdateStore.getState().status?.latestVersion).toBe("0.2.0");
    expect(useUpdateStore.getState().status?.downloadedBytes).toBe(1024);
  });

  it("applies cancel and install responses verbatim", async () => {
    useUpdateStore.setState({ status: status("downloading") });
    mocked.cancelUpdate.mockResolvedValue(status("available"));

    await useUpdateStore.getState().cancel();

    expect(useUpdateStore.getState().status?.phase).toBe("available");

    useUpdateStore.setState({
      status: status("available", { apkPath: "/cache/updates/a.apk" }),
    });
    mocked.installUpdate.mockResolvedValue(
      status("installPrompted", { apkPath: "/cache/updates/a.apk" }),
    );

    await useUpdateStore.getState().install();

    expect(useUpdateStore.getState().status?.phase).toBe("installPrompted");
    expect(useUpdateStore.getState().status?.apkPath).toBe(
      "/cache/updates/a.apk",
    );
  });

  it("polls and adopts the backend snapshot", async () => {
    useUpdateStore.setState({ status: status("downloading") });
    mocked.getUpdateStatus.mockResolvedValue(
      status("downloading", { downloadedBytes: 5, totalBytes: 10 }),
    );

    await useUpdateStore.getState().poll();

    expect(useUpdateStore.getState().status?.downloadedBytes).toBe(5);
  });

  it("saves prefs and keeps the response as authoritative", async () => {
    useUpdateStore.setState({ prefs });
    const next: UpdatePrefs = {
      source: "github",
      channel: "beta",
      cdk: "ignored",
    };
    const saved: UpdatePrefs = { ...next, cdk: "trimmed-away" };
    mocked.setUpdatePrefs.mockResolvedValue(saved);

    await useUpdateStore.getState().setPrefs(next);

    expect(mocked.setUpdatePrefs).toHaveBeenCalledWith(next);
    expect(useUpdateStore.getState().prefs).toEqual(saved);
    expect(useUpdateStore.getState().prefsBusy).toBe(false);
  });

  it("falls back to the requested prefs when saving fails", async () => {
    useUpdateStore.setState({ prefs });
    mocked.setUpdatePrefs.mockRejectedValue(new Error("disk full"));

    await useUpdateStore.getState().setPrefs({ ...prefs, channel: "beta" });

    expect(useUpdateStore.getState().prefs?.channel).toBe("beta");
    expect(useUpdateStore.getState().prefsBusy).toBe(false);
  });
});

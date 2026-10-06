import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNotificationStore } from "../store/notificationStore";
import {
  isControlUnitStartingDiagnostic,
  isPermissionRequiredDiagnostic,
  translate,
} from "./i18n";
import { useRunStartRetry } from "./useRunStartRetry";

const startRun = vi.fn();
const getPrivilegedStatus = vi.fn();
const requestPrivilegedAccess = vi.fn();

vi.mock("./api", () => ({
  startRun: (...args: unknown[]) => startRun(...args),
  getPrivilegedStatus: () => getPrivilegedStatus(),
  requestPrivilegedAccess: () => requestPrivilegedAccess(),
}));

/** The backend wording a run start reports when Shizuku was never authorized. */
const permissionMessage = translate(
  "en",
  "diagnosticShizukuPermissionRequired",
);
const unavailableMessage = translate("en", "diagnosticShizukuUnavailable");
const startingMessage = translate("en", "diagnosticControlServiceStarting");
const startingStatus = {
  status: "starting" as const,
  message: "connecting",
  setupRequired: [],
  backend: "shizuku" as const,
};
const permissionRequiredStatus = {
  status: "permissionRequired" as const,
  message: "grant it",
  setupRequired: [],
  backend: "shizuku" as const,
};
const requestFailedMessage = translate(
  "en",
  "diagnosticShizukuPermissionRequestFailed",
);

const started = {
  executionId: "run-1",
  message: "The run is starting",
  taskCount: 1,
};

function renderRetry(
  retry: { readyTimeoutMs?: number; readyPollIntervalMs?: number } = {
    readyTimeoutMs: 100,
    readyPollIntervalMs: 0,
  },
) {
  const onStarted = vi.fn();
  const onAttemptReset = vi.fn();
  const onFailure = vi.fn(async (_error: unknown) => undefined);
  const rendered = renderHook(() =>
    useRunStartRetry({
      onAttemptReset,
      onStarted,
      onNotice: (message: string) => {
        useNotificationStore.getState().notify(message);
      },
      onFailure,
      ...retry,
    }),
  );
  return {
    ...rendered,
    onStarted,
    onAttemptReset,
    onFailure,
  };
}

function notices(): string[] {
  return useNotificationStore
    .getState()
    .notifications.map((item) => item.message);
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.setState({ notifications: [], seenKeys: new Set() });
  startRun.mockResolvedValue(started);
  getPrivilegedStatus.mockResolvedValue({
    status: "connected",
    message: "connected",
    backend: "shizuku",
  });
  requestPrivilegedAccess.mockResolvedValue(undefined);
});

describe("useRunStartRetry", () => {
  it("reports a successful start without asking for anything", async () => {
    const { result, onStarted } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(getPrivilegedStatus).not.toHaveBeenCalled();
    expect(requestPrivilegedAccess).not.toHaveBeenCalled();
    expect(onStarted).toHaveBeenCalledWith(started);
    expect(notices()).toEqual([]);
  });

  it("asks for access once and starts again after the grant", async () => {
    startRun
      .mockRejectedValueOnce(new Error(permissionMessage))
      .mockResolvedValueOnce(started);
    getPrivilegedStatus.mockResolvedValue({
      status: "permissionRequired",
      message: "grant it",
      setupRequired: ["Grant MaaTauriAndroid access in Shizuku"],
      backend: "shizuku",
    });
    const { result, onStarted, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(requestPrivilegedAccess).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledTimes(2);
    expect(onStarted).toHaveBeenCalledWith(started);
    expect(onFailure).not.toHaveBeenCalled();
    expect(notices()).toEqual([
      translate("en", "diagnosticPermissionRequestInProgress"),
      translate("en", "diagnosticPermissionRequestSucceeded"),
    ]);
  });

  it("keeps a partial task selection across an access retry", async () => {
    const selection = {
      runConfigurationId: "default",
      instanceId: "task-2",
      mode: "currentAndFollowing" as const,
    };
    startRun
      .mockRejectedValueOnce(new Error(permissionMessage))
      .mockResolvedValueOnce(started);
    getPrivilegedStatus.mockResolvedValue(permissionRequiredStatus);
    const { result, onStarted } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess(selection);
    });

    expect(startRun).toHaveBeenNthCalledWith(1, selection);
    expect(startRun).toHaveBeenNthCalledWith(2, selection);
    expect(onStarted).toHaveBeenCalledWith(started);
  });

  it("waits for a control unit that is still starting and starts again", async () => {
    startRun
      .mockRejectedValueOnce(new Error(startingMessage))
      .mockResolvedValueOnce(started);
    getPrivilegedStatus
      .mockResolvedValueOnce(startingStatus)
      .mockResolvedValueOnce(startingStatus)
      .mockResolvedValue(permissionRequiredStatus);
    const { result, onStarted, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(getPrivilegedStatus).toHaveBeenCalledTimes(3);
    expect(startRun).toHaveBeenCalledTimes(2);
    expect(onStarted).toHaveBeenCalledWith(started);
    expect(onFailure).not.toHaveBeenCalled();
    // Waiting is silent: no prompt, and no notice to read about it.
    expect(requestPrivilegedAccess).not.toHaveBeenCalled();
    expect(notices()).toEqual([]);
  });

  it("gives up on waiting once the control unit never arrives", async () => {
    startRun.mockRejectedValue(new Error(startingMessage));
    getPrivilegedStatus.mockResolvedValue(startingStatus);
    const { result, onFailure } = renderRetry({
      readyTimeoutMs: 0,
      readyPollIntervalMs: 0,
    });

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(startRun).toHaveBeenCalledTimes(2);
    expect(requestPrivilegedAccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("waits when the readiness rejection only arrives as a run event", async () => {
    startRun
      .mockRejectedValueOnce(new Error(startingMessage))
      .mockResolvedValueOnce(started);
    getPrivilegedStatus
      .mockResolvedValueOnce(startingStatus)
      .mockResolvedValue({
        status: "connected",
        message: "connected",
        backend: "shizuku",
      });
    const { result, onStarted, onFailure } = renderRetry();

    await act(async () => {
      await result.current.retryAfterRunFailure(startingMessage);
    });

    expect(startRun).toHaveBeenCalledTimes(2);
    expect(onStarted).toHaveBeenCalledWith(started);
    expect(onFailure).not.toHaveBeenCalled();
    expect(notices()).toEqual([]);
  });

  it("leaves failures a prompt cannot repair alone", async () => {
    startRun.mockRejectedValue(new Error(unavailableMessage));
    const { result, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(getPrivilegedStatus).not.toHaveBeenCalled();
    expect(requestPrivilegedAccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(notices()).toEqual([]);
  });

  it("does not prompt while the control unit reports another state", async () => {
    startRun.mockRejectedValue(new Error(permissionMessage));
    getPrivilegedStatus.mockResolvedValue({
      status: "notInstalled",
      message: "Shizuku is unavailable",
      setupRequired: ["Install or start Shizuku"],
      backend: "shizuku",
    });
    const { result, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(requestPrivilegedAccess).not.toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("reports the denied prompt before the original rejection", async () => {
    startRun.mockRejectedValue(new Error(permissionMessage));
    getPrivilegedStatus.mockResolvedValue({
      status: "permissionRequired",
      message: "grant it",
      setupRequired: [],
      backend: "shizuku",
    });
    requestPrivilegedAccess.mockRejectedValue(new Error(requestFailedMessage));
    const { result, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(2);
    expect(onFailure.mock.calls[0][0]).toMatchObject({
      message: requestFailedMessage,
    });
    expect(notices()).toEqual([
      translate("en", "diagnosticPermissionRequestInProgress"),
      translate("en", "diagnosticPermissionRequestFailed"),
    ]);
  });

  it("spends the retry once per click", async () => {
    startRun.mockRejectedValue(new Error(permissionMessage));
    getPrivilegedStatus.mockResolvedValue({
      status: "permissionRequired",
      message: "grant it",
      setupRequired: [],
      backend: "shizuku",
    });
    const { result, onAttemptReset, onFailure } = renderRetry();

    await act(async () => {
      await result.current.startRunWithAccess();
    });

    expect(startRun).toHaveBeenCalledTimes(2);
    expect(requestPrivilegedAccess).toHaveBeenCalledTimes(1);
    // Once per attempt, and once for each rejection that follows it.
    expect(onAttemptReset).toHaveBeenCalledTimes(4);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(notices()).toEqual([
      translate("en", "diagnosticPermissionRequestInProgress"),
      translate("en", "diagnosticPermissionRequestSucceeded"),
    ]);

    // A later rejection in the same click must not prompt again...
    await act(async () => {
      await result.current.retryAfterRunFailure(permissionMessage);
    });
    expect(startRun).toHaveBeenCalledTimes(2);

    // ...until the next click resets the budget.
    act(() => result.current.resetRetry());
    await act(async () => {
      await result.current.startRunWithAccess();
    });
    expect(requestPrivilegedAccess).toHaveBeenCalledTimes(2);
  });

  it("recovers when a rejected start only reaches the UI as a run event", async () => {
    startRun
      .mockRejectedValueOnce(new Error(permissionMessage))
      .mockResolvedValueOnce(started);
    getPrivilegedStatus.mockResolvedValue({
      status: "permissionRequired",
      message: "grant it",
      setupRequired: [],
      backend: "shizuku",
    });
    const { result, onStarted } = renderRetry();

    // The listener forwards the raw backend message from the failure event.
    await act(async () => {
      await result.current.retryAfterRunFailure(permissionMessage);
    });

    expect(startRun).toHaveBeenCalledTimes(2);
    expect(requestPrivilegedAccess).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(started);
  });

  it("ignores run-event failures that are not about a missing grant", async () => {
    const { result } = renderRetry();

    await act(async () => {
      await result.current.retryAfterRunFailure(unavailableMessage);
    });

    expect(getPrivilegedStatus).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });
});

describe("permission diagnostics", () => {
  it("recognizes only the missing-grant wording", () => {
    expect(isPermissionRequiredDiagnostic(permissionMessage)).toBe(true);
    expect(isPermissionRequiredDiagnostic(unavailableMessage)).toBe(false);
    expect(isPermissionRequiredDiagnostic(requestFailedMessage)).toBe(false);
  });

  it("recognizes only the control unit that is still coming up", () => {
    expect(isControlUnitStartingDiagnostic(startingMessage)).toBe(true);
    expect(isControlUnitStartingDiagnostic(permissionMessage)).toBe(false);
    expect(isControlUnitStartingDiagnostic(unavailableMessage)).toBe(false);
  });
});

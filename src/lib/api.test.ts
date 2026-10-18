import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapApp,
  exportConfiguration,
  getDisplayHazards,
  getPrivilegedBackend,
  importConfiguration,
  loadProject,
  pressVirtualDisplayBack,
  readProjectText,
  readProjectTexts,
  reinstallResources,
  requestNotificationPermission,
  resolveFocusModal,
  setPrivilegedBackend,
  setVirtualDisplayLandscape,
  startRun,
  updateVirtualDisplayPip,
} from "./api";

const invoke = vi.hoisted(() => vi.fn());
const { isPermissionGranted, requestPermission } = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted,
  requestPermission,
}));

describe("notification permission", () => {
  beforeEach(() => {
    isPermissionGranted.mockReset().mockResolvedValue(false);
    requestPermission.mockReset().mockResolvedValue("granted");
  });

  it("skips the hanging plugin request when permission is already granted", async () => {
    isPermissionGranted.mockResolvedValue(true);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(requestNotificationPermission()).resolves.toBe(true);
    }

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests missing permission and checks again on later starts", async () => {
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledOnce();

    isPermissionGranted.mockResolvedValue(true);
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(isPermissionGranted).toHaveBeenCalledTimes(2);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("returns false after denial and allows a later retry", async () => {
    requestPermission.mockResolvedValueOnce("denied");

    await expect(requestNotificationPermission()).resolves.toBe(false);
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it("does not request permission if the permission check fails", async () => {
    isPermissionGranted.mockRejectedValueOnce(new Error("bridge unavailable"));

    await expect(requestNotificationPermission()).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    await expect(requestNotificationPermission()).resolves.toBe(true);
  });

  it("handles a failed request and allows a later retry", async () => {
    requestPermission.mockRejectedValueOnce(new Error("activity unavailable"));

    await expect(requestNotificationPermission()).resolves.toBe(false);
    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });

  it("shares concurrent calls while checking permission", async () => {
    let finishCheck: ((granted: boolean) => void) | undefined;
    isPermissionGranted.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        }),
    );

    const first = requestNotificationPermission();
    const second = requestNotificationPermission();
    expect(second).toBe(first);
    expect(isPermissionGranted).toHaveBeenCalledOnce();

    finishCheck?.(false);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("shares concurrent calls while the permission prompt is pending", async () => {
    let finishRequest: ((permission: string) => void) | undefined;
    requestPermission.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRequest = resolve;
        }),
    );

    const first = requestNotificationPermission();
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    const second = requestNotificationPermission();
    expect(second).toBe(first);

    finishRequest?.("granted");
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(isPermissionGranted).toHaveBeenCalledOnce();
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});

describe("version-aware app state snapshots", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("bootstraps and hands back the snapshot with its versions", async () => {
    const snapshot = {
      project: { name: "m9a", version: "v0.1.0" },
      configuration: {},
      versions: {
        appVersion: "0.1.0",
        frameworkVersion: "v5.13.1",
        appTag: "v0.2.0",
        resourceTag: "v4.9.0",
      },
    };
    invoke.mockResolvedValue(snapshot);

    await expect(bootstrapApp()).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenCalledWith("bootstrap");
  });

  it("propagates a failed bootstrap", async () => {
    invoke.mockRejectedValue(new Error("project offline"));

    await expect(bootstrapApp()).rejects.toThrow("project offline");
    expect(invoke).toHaveBeenCalledWith("bootstrap");
  });

  it("loads a project with its path and language", async () => {
    invoke.mockResolvedValue({
      project: { name: "m9a", version: "v0.1.0" },
      configuration: {},
      versions: {
        appVersion: "0.1.0",
        frameworkVersion: "v5.13.1",
        appTag: "v0.2.0",
        resourceTag: "v4.9.0",
      },
    });

    await loadProject("/tmp/m9a", "zh_cn");

    expect(invoke).toHaveBeenCalledWith("load_project", {
      path: "/tmp/m9a",
      language: "zh_cn",
    });
  });

  it("propagates a failed project load", async () => {
    invoke.mockRejectedValue(
      new Error("unsupported Project Interface version"),
    );

    await expect(loadProject("/tmp/broken", "zh_cn")).rejects.toThrow(
      "unsupported Project Interface version",
    );
  });
});

describe("resource reinstall", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("requests the backend reinstall command", async () => {
    const snapshot = { configuration: {} };
    invoke.mockResolvedValue(snapshot);

    await expect(reinstallResources()).resolves.toBe(snapshot);
    expect(invoke).toHaveBeenCalledWith("reinstall_resources");
  });

  it("propagates a failed reinstall", async () => {
    invoke.mockRejectedValue(new Error("a run is active"));

    await expect(reinstallResources()).rejects.toThrow("a run is active");
    expect(invoke).toHaveBeenCalledWith("reinstall_resources");
  });
});

describe("project text reader", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("requests text relative to the loaded project", async () => {
    invoke.mockResolvedValue('{"name":"fixture"}');

    await expect(readProjectText("interface.jsonc")).resolves.toBe(
      '{"name":"fixture"}',
    );
    expect(invoke).toHaveBeenCalledWith("read_project_text", {
      path: "interface.jsonc",
    });
  });

  it("propagates unsafe or failed reads", async () => {
    invoke.mockRejectedValue(
      new Error("Project Interface text paths must stay inside the project"),
    );

    await expect(readProjectText("../interface.json")).rejects.toThrow(
      "Project Interface text paths must stay inside the project",
    );
  });

  it("requests several texts in one IPC call and preserves path errors", async () => {
    invoke.mockResolvedValue([
      { path: "interface.json", text: '{"name":"fixture"}' },
      { path: "missing.json", error: "entity not found" },
    ]);

    await expect(
      readProjectTexts(["interface.json", "missing.json"]),
    ).rejects.toThrow("entity not found");
    expect(invoke).toHaveBeenCalledWith("read_project_texts", {
      paths: ["interface.json", "missing.json"],
    });
  });
});

describe("virtual display fullscreen orientation", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("requests orientation changes with an explicit flag", async () => {
    invoke.mockResolvedValue(undefined);

    await expect(setVirtualDisplayLandscape(true)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("set_virtual_display_landscape", {
      enabled: true,
    });
  });

  it("propagates an orientation bridge failure", async () => {
    invoke.mockRejectedValue(new Error("host activity unavailable"));

    await expect(setVirtualDisplayLandscape(false)).rejects.toThrow(
      "host activity unavailable",
    );
    expect(invoke).toHaveBeenCalledWith("set_virtual_display_landscape", {
      enabled: false,
    });
  });
});

describe("privileged backend selection", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reads and switches the selected privileged backend", async () => {
    invoke.mockResolvedValueOnce("root").mockResolvedValueOnce(undefined);

    await expect(getPrivilegedBackend()).resolves.toBe("root");
    await expect(setPrivilegedBackend("root")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "get_privileged_backend");
    expect(invoke).toHaveBeenNthCalledWith(2, "set_privileged_backend", {
      backend: "root",
    });
  });

  it("propagates a failed backend switch", async () => {
    invoke.mockRejectedValue(new Error("Root access was denied or timed out"));

    await expect(setPrivilegedBackend("root")).rejects.toThrow(
      "Root access was denied or timed out",
    );
    expect(invoke).toHaveBeenCalledWith("set_privileged_backend", {
      backend: "root",
    });
  });
});

describe("virtual display back key", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("requests a back-key press", async () => {
    invoke.mockResolvedValue(undefined);

    await expect(pressVirtualDisplayBack()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("virtual_display_back");
  });

  it("propagates a back-key bridge failure", async () => {
    invoke.mockRejectedValue(new Error("The virtual display is not active"));

    await expect(pressVirtualDisplayBack()).rejects.toThrow(
      "The virtual display is not active",
    );
    expect(invoke).toHaveBeenCalledWith("virtual_display_back");
  });
});

describe("focus modal acks", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("acknowledges one blocking modal on the backend", async () => {
    invoke.mockResolvedValue(undefined);

    await expect(resolveFocusModal()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("resolve_focus_modal");
  });
});

describe("configuration backup", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("exports a configuration backup", async () => {
    const exportResult = { path: "/cache/backup.json" };
    invoke.mockResolvedValue(exportResult);

    await expect(exportConfiguration()).resolves.toBe(exportResult);
    expect(invoke).toHaveBeenCalledWith("export_configuration");
  });

  it("imports a configuration backup", async () => {
    const importResult = { imported: true, snapshot: undefined };
    invoke.mockResolvedValue(importResult);

    await expect(importConfiguration()).resolves.toBe(importResult);
    expect(invoke).toHaveBeenCalledWith("import_configuration");
  });
});

describe("run start selection", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("starts the full queue when no selection is provided", async () => {
    invoke.mockResolvedValue({
      executionId: "run-1",
      message: "The run is starting",
      taskCount: 2,
    });

    await expect(startRun()).resolves.toHaveProperty("taskCount", 2);
    expect(invoke).toHaveBeenCalledWith("start_run");
  });

  it("passes a one-time task selection in camel case", async () => {
    invoke.mockResolvedValue({
      executionId: "run-2",
      message: "The run is starting",
      taskCount: 1,
    });
    const selection = {
      runConfigurationId: "default",
      instanceId: "task-2",
      mode: "current" as const,
    };

    await expect(startRun(selection)).resolves.toHaveProperty("taskCount", 1);
    expect(invoke).toHaveBeenCalledWith("start_run", { selection });
  });
});

describe("display hazards", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("reads the advisory display state before a run", async () => {
    const hazards = {
      smartResolution: true,
      eyeProtectionSource: "xiaomi:screen_paper_mode_enabled",
    };
    invoke.mockResolvedValue(hazards);

    await expect(getDisplayHazards()).resolves.toBe(hazards);
    expect(invoke).toHaveBeenCalledWith("display_hazards");
  });
});

describe("PiP IPC ordering", () => {
  const request = {
    eligible: true,
    width: 1280,
    height: 720,
    unavailableLabel: "Unavailable",
    sourceRect: { left: 10, top: 20, right: 110, bottom: 80 },
  };

  beforeEach(() => {
    invoke.mockReset();
  });

  it("preserves request geometry and orders disarming after pending updates", async () => {
    let complete: (() => void) | undefined;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    invoke.mockResolvedValueOnce(undefined);
    const first = updateVirtualDisplayPip(request);
    const disarm = { ...request, eligible: false, sourceRect: null };
    const second = updateVirtualDisplayPip(disarm);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenNthCalledWith(1, "update_virtual_display_pip", {
      request,
    });
    complete?.();
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenNthCalledWith(2, "update_virtual_display_pip", {
      request: disarm,
    });
  });

  it("reports IPC failures and lets the next disarm through", async () => {
    invoke.mockRejectedValueOnce(new Error("host unavailable"));
    await expect(updateVirtualDisplayPip(request)).rejects.toThrow(
      "host unavailable",
    );
    invoke.mockResolvedValueOnce(undefined);
    await expect(
      updateVirtualDisplayPip({ ...request, eligible: false }),
    ).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

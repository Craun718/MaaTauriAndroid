import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapApp,
  getPrivilegedBackend,
  loadProject,
  pressVirtualDisplayBack,
  resolveFocusModal,
  setPrivilegedBackend,
  setVirtualDisplayLandscape,
} from "./api";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

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

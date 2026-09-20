import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapApp, loadProject } from "./api";

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

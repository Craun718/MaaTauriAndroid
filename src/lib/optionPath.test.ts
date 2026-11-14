import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickOptionPath } from "./api";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
}));

describe("PI option path picker IPC", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it.each(["file", "directory"] as const)(
    "requests a %s and preserves the native path",
    async (kind) => {
      const path =
        "/storage/emulated/0/Download/MaaTauriAndroid/id/中文 name.txt";
      invoke.mockResolvedValue(path);
      await expect(pickOptionPath(kind)).resolves.toBe(path);
      expect(invoke).toHaveBeenCalledExactlyOnceWith("pick_option_path", {
        kind,
      });
    },
  );

  it("returns null on cancellation", async () => {
    invoke.mockResolvedValue(null);
    await expect(pickOptionPath("directory")).resolves.toBeNull();
  });

  it.each([
    "tooLarge",
    "readFailed",
    "unavailable",
    "busy",
    "timeout",
    "unsupportedDirectory",
  ])("propagates %s instead of treating it as cancellation", async (reason) => {
    const failure = new Error(`Option path selection failed: ${reason}`);
    invoke.mockRejectedValue(failure);
    await expect(pickOptionPath("file")).rejects.toBe(failure);
  });
});

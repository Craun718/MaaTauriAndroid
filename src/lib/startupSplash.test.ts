import { describe, expect, it, vi } from "vitest";
import { releaseStartupSplashAfterBootstrap } from "./startupSplash";

describe("releaseStartupSplashAfterBootstrap", () => {
  it("releases the splash after bootstrap finishes", async () => {
    const release = vi.fn(async () => undefined);
    const reportError = vi.fn();

    await expect(
      releaseStartupSplashAfterBootstrap(release, reportError),
    ).resolves.toBe(true);

    expect(release).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a release failure", async () => {
    const failure = new Error("Bridge unavailable");
    const release = vi.fn(async () => {
      throw failure;
    });
    const reportError = vi.fn();

    await expect(
      releaseStartupSplashAfterBootstrap(release, reportError),
    ).resolves.toBe(false);

    expect(release).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});

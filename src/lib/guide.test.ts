import { describe, expect, it } from "vitest";
import {
  GUIDE_VERSION,
  markGuideSeen,
  shouldDeferAnnouncement,
  shouldShowGuide,
} from "./guide";
import type { UserConfiguration } from "./types";

function configurationWith(
  overrides: Partial<UserConfiguration>,
): UserConfiguration {
  return {
    schemaVersion: 1,
    initialized: false,
    forceStopTargetApp: false,
    closeTargetAppAfterRun: true,
    telemetryEnabled: false,
    globalOptionValues: {},
    controllerOptionValues: {},
    resourceOptionValues: {},
    runConfigurations: [],
    ...overrides,
  };
}

describe("guide state", () => {
  it("shows the guide for a first launch and an outdated revision", () => {
    expect(shouldShowGuide(undefined)).toBe(false);
    expect(
      shouldShowGuide(configurationWith({ guideSeenVersion: undefined })),
    ).toBe(true);
    expect(
      shouldShowGuide(
        configurationWith({ guideSeenVersion: GUIDE_VERSION - 1 }),
      ),
    ).toBe(true);
  });

  it("does not show the current or newer guide revision again", () => {
    expect(
      shouldShowGuide(configurationWith({ guideSeenVersion: GUIDE_VERSION })),
    ).toBe(false);
    expect(
      shouldShowGuide(
        configurationWith({ guideSeenVersion: GUIDE_VERSION + 1 }),
      ),
    ).toBe(false);
  });

  it("persists the current guide revision without changing unrelated fields", () => {
    const current = configurationWith({ activeResource: "resource" });
    const next = markGuideSeen(current);

    expect(next.guideSeenVersion).toBe(GUIDE_VERSION);
    expect(next.activeResource).toBe("resource");
    expect(markGuideSeen(next)).toBe(next);
  });

  it("does not downgrade a newer revision during a manual replay", () => {
    const current = configurationWith({ guideSeenVersion: GUIDE_VERSION + 1 });
    expect(markGuideSeen(current)).toBe(current);
  });

  it("defers automatic announcements before the first guide has started", () => {
    const current = configurationWith({});
    expect(shouldDeferAnnouncement(current, false, false)).toBe(true);
    expect(shouldDeferAnnouncement(current, true, true)).toBe(true);
    expect(shouldDeferAnnouncement(current, false, true)).toBe(false);
  });

  it("allows announcements after completion but defers them during replay", () => {
    const seen = configurationWith({ guideSeenVersion: GUIDE_VERSION });
    expect(shouldDeferAnnouncement(seen, false, false)).toBe(false);
    expect(shouldDeferAnnouncement(seen, true, true)).toBe(true);
  });
});

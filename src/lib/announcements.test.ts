import { describe, expect, it } from "vitest";
import {
  acknowledgeAnnouncement,
  isAnnouncementAcknowledged,
  shouldShowAnnouncement,
} from "./announcements";
import type { UserConfiguration } from "./types";

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  telemetryEnabled: false,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
  welcomeFingerprint: "old",
  welcomeAcknowledgedAppVersion: "1.0.0",
  skipWelcomeAnnouncement: true,
};

describe("isAnnouncementAcknowledged", () => {
  it("acknowledges only the same welcome and installed version", () => {
    expect(
      isAnnouncementAcknowledged({
        fingerprint: "old",
        appVersion: "1.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
      }),
    ).toBe(true);
  });

  it("rejects changed content and app updates or downgrades", () => {
    expect(
      isAnnouncementAcknowledged({
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
      }),
    ).toBe(false);
    expect(
      isAnnouncementAcknowledged({
        fingerprint: "old",
        appVersion: "2.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
      }),
    ).toBe(false);
    expect(
      isAnnouncementAcknowledged({
        fingerprint: "old",
        appVersion: "0.9.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
      }),
    ).toBe(false);
  });
});

describe("shouldShowAnnouncement", () => {
  it("hides the acknowledged announcement", () => {
    expect(
      shouldShowAnnouncement({
        hasContent: true,
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "new",
        welcomeAcknowledgedAppVersion: "1.0.0",
        skipWelcomeAnnouncement: true,
      }),
    ).toBe(false);
  });

  it("shows new content, unacknowledged content, and changed app installs", () => {
    expect(
      shouldShowAnnouncement({
        hasContent: true,
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
        skipWelcomeAnnouncement: true,
      }),
    ).toBe(true);
    expect(
      shouldShowAnnouncement({
        hasContent: true,
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
        skipWelcomeAnnouncement: false,
      }),
    ).toBe(true);
    expect(
      shouldShowAnnouncement({
        hasContent: true,
        fingerprint: "old",
        appVersion: "2.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
        skipWelcomeAnnouncement: true,
      }),
    ).toBe(true);
  });

  it("treats a legacy configuration as not skipped", () => {
    expect(
      shouldShowAnnouncement({
        hasContent: true,
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "new",
        welcomeAcknowledgedAppVersion: "1.0.0",
      }),
    ).toBe(true);
  });

  it("ignores empty announcements", () => {
    expect(
      shouldShowAnnouncement({
        hasContent: false,
        fingerprint: "new",
        appVersion: "1.0.0",
        welcomeFingerprint: "old",
        welcomeAcknowledgedAppVersion: "1.0.0",
        skipWelcomeAnnouncement: false,
      }),
    ).toBe(false);
  });
});

describe("acknowledgeAnnouncement", () => {
  it("records the fingerprint and app version when skipping future launches", () => {
    const next = acknowledgeAnnouncement(
      configuration,
      { fingerprint: "new", appVersion: "2.0.0" },
      true,
    );

    expect(next.welcomeFingerprint).toBe("new");
    expect(next.welcomeAcknowledgedAppVersion).toBe("2.0.0");
    expect(next.skipWelcomeAnnouncement).toBe(true);
  });

  it("resets skipping and records a changed fingerprint", () => {
    const next = acknowledgeAnnouncement(
      configuration,
      { fingerprint: "new", appVersion: "0.9.0" },
      false,
    );

    expect(next.welcomeFingerprint).toBe("new");
    expect(next.welcomeAcknowledgedAppVersion).toBe("0.9.0");
    expect(next.skipWelcomeAnnouncement).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  acknowledgeAnnouncement,
  announcementTitle,
  isAnnouncementAcknowledged,
  resolveAnnouncementRemember,
  shouldShowAnnouncement,
} from "./announcements";
import type { UserConfiguration } from "./types";

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  closeTargetAppAfterRun: false,
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

describe("resolveAnnouncementRemember", () => {
  it("defaults to the stored preference before the user picks", () => {
    expect(resolveAnnouncementRemember(undefined, {})).toBe(false);
    expect(
      resolveAnnouncementRemember(undefined, {
        skipWelcomeAnnouncement: true,
      }),
    ).toBe(true);
    expect(
      resolveAnnouncementRemember(undefined, {
        skipWelcomeAnnouncement: false,
      }),
    ).toBe(false);
  });

  it("keeps the user's selection on an unacknowledged announcement", () => {
    expect(resolveAnnouncementRemember(true, {})).toBe(true);
    expect(
      resolveAnnouncementRemember(false, { skipWelcomeAnnouncement: true }),
    ).toBe(false);
  });
});

describe("announcementTitle", () => {
  it("uses the first heading of the body", () => {
    expect(announcementTitle("# 更新公告\n\n本次更新内容如下")).toBe(
      "更新公告",
    );
    expect(announcementTitle("第一行\n\n## 二级标题")).toBe("二级标题");
  });

  it("skips headings inside fenced code blocks", () => {
    expect(announcementTitle("```sh\n# 安装依赖\n```\n\n# 真正的标题")).toBe(
      "真正的标题",
    );
    expect(announcementTitle("~~~\n# 只是注释\n~~~")).toBeUndefined();
  });

  it("strips inline markup and closing hashes", () => {
    expect(
      announcementTitle("## [下载地址](https://example.test) **新版本** ##"),
    ).toBe("下载地址 新版本");
    expect(announcementTitle("# `maa-tauri` 说明")).toBe("maa-tauri 说明");
    expect(announcementTitle("# C# 支持")).toBe("C# 支持");
  });

  it("returns undefined when the body has no usable heading", () => {
    expect(announcementTitle("纯文本公告")).toBeUndefined();
    expect(announcementTitle("#\n\n###")).toBeUndefined();
    expect(announcementTitle("")).toBeUndefined();
  });
});

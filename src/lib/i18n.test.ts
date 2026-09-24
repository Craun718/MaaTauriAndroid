import { describe, expect, it } from "vitest";
import {
  isChineseLocale,
  localizeDiagnostic,
  localizeRunEvent,
  projectLanguage,
  resolveLanguage,
  translate,
} from "./i18n";
import type { RunEvent } from "./types";

describe("isChineseLocale", () => {
  it("matches every Chinese tag Android and the desktop webviews report", () => {
    expect(isChineseLocale("zh")).toBe(true);
    expect(isChineseLocale("zh-CN")).toBe(true);
    expect(isChineseLocale("zh-Hans-CN")).toBe(true);
    expect(isChineseLocale("zh_TW")).toBe(true);
    expect(isChineseLocale(" ZH-cn ")).toBe(true);
  });

  it("rejects other locales", () => {
    expect(isChineseLocale("en-US")).toBe(false);
    expect(isChineseLocale("ja-JP")).toBe(false);
    expect(isChineseLocale("")).toBe(false);
    expect(isChineseLocale(undefined)).toBe(false);
  });
});

describe("resolveLanguage", () => {
  it("falls back to English for anything that is not a Chinese locale", () => {
    expect(resolveLanguage(undefined, ["en-US"])).toBe("en");
    expect(resolveLanguage(undefined, ["ja-JP", "zh-CN"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });

  it("follows the device language when set to system", () => {
    expect(resolveLanguage("system", ["zh-CN"])).toBe("zh");
    expect(resolveLanguage("system", ["zh-Hans-CN", "en-US"])).toBe("zh");
    // A legacy configuration persisted before the field existed reads as undefined.
    expect(resolveLanguage(undefined, ["zh-CN"])).toBe("zh");
  });

  it("lets an explicit choice override the device language", () => {
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
    expect(resolveLanguage("zh", ["en-US"])).toBe("zh");
  });
});

describe("projectLanguage", () => {
  it("maps the interface language onto the project locale", () => {
    expect(projectLanguage("zh")).toBe("zh_cn");
    expect(projectLanguage("en")).toBe("en_us");
  });
});

describe("translate", () => {
  it("interpolates named parameters", () => {
    expect(translate("en", "enabledTasks", { count: 3 })).toBe("3 tasks");
    expect(translate("zh", "deletedRuns", { count: 0 })).toBe(
      "已删除 0 个运行目录，并清空日志文件",
    );
  });

  it("leaves the placeholder alone when no value is supplied", () => {
    expect(translate("en", "enabledTasks")).toBe("{count} tasks");
  });

  it("returns plain strings unchanged", () => {
    expect(translate("en", "startRun")).toBe("Start run");
    expect(translate("zh", "startRun")).toBe("开始运行");
  });
});

describe("localizeDiagnostic", () => {
  const permission =
    "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again";

  it("keeps the backend wording in English and translates known failures in Chinese", () => {
    expect(localizeDiagnostic(permission, "en")).toBe(permission);
    expect(localizeDiagnostic(permission, "zh")).toBe(
      "尚未授予 Shizuku 权限；请在 Shizuku 中授权本应用后重试",
    );
    expect(
      localizeDiagnostic(
        "The privileged control service rejected the virtual display",
        "zh",
      ),
    ).toBe("特权控制服务拒绝了虚拟屏请求");
  });

  it("translates the privileged backend action failures", () => {
    expect(
      localizeDiagnostic("Root access was denied or timed out", "zh"),
    ).toBe("root 授权被拒绝或已超时；请重试，并在 su 弹窗中选择允许");
    expect(
      localizeDiagnostic("Root access was denied or timed out", "en"),
    ).toBe("Root access was denied or timed out");
    expect(
      localizeDiagnostic(
        "The Shizuku control unit could not be connected",
        "zh",
      ),
    ).toBe("Shizuku 控制服务连接失败；请确认 Shizuku 正在运行后重试");
    expect(
      localizeDiagnostic(
        "The Shizuku permission request failed, was denied, or timed out",
        "zh",
      ),
    ).toBe(
      "Shizuku 授权请求失败、被拒绝或已超时；请在 Shizuku 的授权弹窗中允许本应用",
    );
    expect(
      localizeDiagnostic("Shizuku is not installed or cannot be opened", "zh"),
    ).toBe("无法打开 Shizuku；请确认它已安装，且未被系统拦截");
  });

  it("collapses task-abort messages to a short localized notice", () => {
    expect(localizeDiagnostic("Maa task Sugar failed: timeout", "zh")).toBe(
      "任务异常中止",
    );
    expect(localizeDiagnostic("Maa task Sugar failed: timeout", "en")).toBe(
      "The task aborted abnormally",
    );
    expect(localizeDiagnostic("Maa task StartUp failed: Failed", "zh")).toBe(
      "任务异常中止",
    );
  });

  it("passes unknown backend text through unchanged", () => {
    expect(localizeDiagnostic("Pipeline exploded", "zh")).toBe(
      "Pipeline exploded",
    );
  });
});

describe("localizeRunEvent", () => {
  const event: RunEvent = {
    executionId: "run-1",
    sequence: 1,
    atUnixMs: 0,
    kind: "warning",
    state: "Running",
    message: "Game frame rate is low: median 30 FPS over the last 15 seconds.",
    data: {
      diagnostic: "gameFps",
      level: "degraded",
      windowSeconds: 15,
      medianFps: 30.4,
      thresholdFps: 50,
      source: "taskCallback",
    },
  };

  it("renders known runtime warnings with structured event data", () => {
    expect(localizeRunEvent(event, "en")).toBe(event.message);
    expect(localizeRunEvent(event, "zh")).toBe(
      "游戏帧率较低：最近 15 秒的中位数为 30 FPS。",
    );
  });

  it("falls back to diagnostic localization or the backend text", () => {
    expect(
      localizeRunEvent(
        {
          ...event,
          message: "Maa task Sugar failed: timeout",
          data: { diagnostic: "gameFps" },
        },
        "zh",
      ),
    ).toBe("任务异常中止");
  });
});

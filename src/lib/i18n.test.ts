import { describe, expect, it } from "vitest";
import {
  isChineseLocale,
  localizeDiagnostic,
  projectLanguage,
  resolveLanguage,
  translate,
} from "./i18n";

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
      "已删除 0 个运行目录",
    );
  });

  it("leaves the placeholder alone when no value is supplied", () => {
    expect(translate("en", "enabledTasks")).toBe("{count} tasks");
  });

  it("returns plain strings unchanged", () => {
    expect(translate("en", "start")).toBe("Start");
    expect(translate("zh", "start")).toBe("开始");
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

  it("passes unknown backend text through unchanged", () => {
    expect(localizeDiagnostic("Maa task Sugar failed: timeout", "zh")).toBe(
      "Maa task Sugar failed: timeout",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  isChineseLocale,
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
    expect(translate("en", "tasksReady", { count: 3 })).toBe("3 tasks ready");
    expect(translate("zh", "tasksReady", { count: 3 })).toBe("3 个任务待运行");
    expect(translate("zh", "deletedRuns", { count: 0 })).toBe("已删除 0 个运行目录");
  });

  it("leaves the placeholder alone when no value is supplied", () => {
    expect(translate("en", "tasksReady")).toBe("{count} tasks ready");
  });

  it("returns plain strings unchanged", () => {
    expect(translate("en", "start")).toBe("Start");
    expect(translate("zh", "start")).toBe("开始");
  });
});

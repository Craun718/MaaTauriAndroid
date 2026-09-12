import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import type { UiLanguage } from "./types";

/** Language the interface actually renders in, after resolving "system". */
export type AppLanguage = "zh" | "en";

const en = {
  // Bottom navigation
  navHome: "Home",
  navTasks: "Tasks",
  navSettings: "Settings",

  // Shared
  working: "Working",
  saving: "Saving",
  checking: "Checking",
  unavailable: "Unavailable",
  defaultRunName: "Default",
  controller: "Controller",
  resource: "Resource",
  preset: "Preset",
  enabled: "Enabled",

  // Home
  project: "Project",
  noProject: "No project is loaded.",
  loadProjectHint: "Load a project from Settings.",
  currentSelection: "Current selection",
  refreshStatus: "Refresh status",
  enabledTasks: "{count} tasks",
  privilegedHost: "Privileged host",

  // Settings, project scope
  noResources: "No resources are declared.",
  globalOptions: "Global options",
  resourceOptions: "Resource options",

  // Tasks
  tasksAndRun: "Tasks & Run",
  presets: "Presets",
  toggleOn: "On",
  requiresOtherController: "Requires a different controller or resource.",

  // Run controls
  tasksReady: "{count} tasks ready",
  start: "Start",
  stop: "Stop",
  exportDiagnostics: "Export",
  captureScreenshot: "Shot",
  exportConfirm:
    "Export a full diagnostic package? It includes screenshots, device logs and a complete bug report.",
  diagnosticsStatus: "Diagnostics: {status}",
  diagnosticsComplete: "complete",
  diagnosticsPartial: "partial with gaps",
  diagnosticsExported: "Diagnostics exported: {path}",
  diagnosticsExportedWithGaps: "Diagnostics exported with gaps: {reasons}",
  screenshotSaved: "Screenshot saved: {path}",

  // Settings
  settings: "Settings",
  language: "Language",
  languageDescription:
    "Defaults to the device language: Chinese for Chinese locales, English otherwise.",
  languageSystem: "System",
  languageChinese: "简体中文",
  languageEnglish: "English",
  projectDirectory: "Project directory",
  loadProject: "Load project",
  runBehavior: "Run behavior",
  forceStopTargetApp: "Force stop target app",
  diagnostics: "Diagnostics",
  deleteRuns: "Delete runs",
  deleting: "Deleting",
  deleteRunsConfirm:
    "Delete all stored run directories? Diagnostic exports inside them will also be removed.",
  deletedRuns: "Deleted {count} run directories",
  privileges: "Privileges",
};

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  navHome: "首页",
  navTasks: "任务",
  navSettings: "设置",

  working: "处理中",
  saving: "保存中",
  checking: "检查中",
  unavailable: "不可用",
  defaultRunName: "默认",
  controller: "控制器",
  resource: "资源",
  preset: "预设",
  enabled: "已启用",

  project: "项目",
  noProject: "尚未加载项目。",
  loadProjectHint: "请在设置页加载项目。",
  currentSelection: "当前选择",
  refreshStatus: "刷新状态",
  enabledTasks: "{count} 个任务",
  privilegedHost: "特权宿主",

  noResources: "未声明资源。",
  globalOptions: "全局选项",
  resourceOptions: "资源选项",

  tasksAndRun: "任务与运行",
  presets: "预设",
  toggleOn: "启用",
  requiresOtherController: "需要其他控制器或资源。",

  tasksReady: "{count} 个任务待运行",
  start: "开始",
  stop: "停止",
  exportDiagnostics: "导出",
  captureScreenshot: "截图",
  exportConfirm: "要导出完整诊断包吗？其中包含截图、设备日志和完整的错误报告。",
  diagnosticsStatus: "诊断：{status}",
  diagnosticsComplete: "完整",
  diagnosticsPartial: "部分内容缺失",
  diagnosticsExported: "诊断已导出：{path}",
  diagnosticsExportedWithGaps: "诊断已导出，但存在缺口：{reasons}",
  screenshotSaved: "截图已保存：{path}",

  settings: "设置",
  language: "语言",
  languageDescription: "默认跟随设备语言：系统语言为中文时使用中文，否则使用英文。",
  languageSystem: "跟随系统",
  languageChinese: "简体中文",
  languageEnglish: "English",
  projectDirectory: "项目目录",
  loadProject: "加载项目",
  runBehavior: "运行行为",
  forceStopTargetApp: "运行前强制停止目标应用",
  diagnostics: "诊断",
  deleteRuns: "删除运行记录",
  deleting: "删除中",
  deleteRunsConfirm: "要删除全部运行目录吗？其中的诊断导出也会一并删除。",
  deletedRuns: "已删除 {count} 个运行目录",
  privileges: "权限",
};

const catalog: Record<AppLanguage, Record<MessageKey, string>> = { en, zh };

/**
 * Locale tags the device reports, most preferred first. Android's WebView and the
 * desktop webviews both expose the device setting here, so no native bridge is needed.
 */
export function systemLanguageTags(): string[] {
  if (typeof navigator === "undefined") return [];
  const tags: string[] = [];
  if (navigator.language) tags.push(navigator.language);
  for (const tag of navigator.languages ?? []) {
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** "zh", "zh-CN", "zh-Hans-CN" and "zh_TW" all count as Chinese; nothing else does. */
export function isChineseLocale(tag: string | undefined): boolean {
  return typeof tag === "string" && tag.trim().toLowerCase().startsWith("zh");
}

/** Explicit choice wins; "system" (and a missing value) follows the device locale. */
export function resolveLanguage(
  setting: UiLanguage | undefined,
  tags: readonly string[],
): AppLanguage {
  if (setting === "zh" || setting === "en") return setting;
  return isChineseLocale(tags[0]) ? "zh" : "en";
}

/** Language a project's own labels should be loaded in. */
export function projectLanguage(language: AppLanguage): string {
  return language === "zh" ? "zh_cn" : "en_us";
}

export function translate(
  language: AppLanguage,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalog[language][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

export interface Translation {
  language: AppLanguage;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Translated strings for the current configuration, re-rendering when it changes. */
export function useTranslation(): Translation {
  const setting = useAppStore((state) => state.snapshot?.configuration.uiLanguage);
  const language = resolveLanguage(setting, systemLanguageTags());
  return useMemo(
    () => ({
      language,
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(language, key, params),
    }),
    [language],
  );
}

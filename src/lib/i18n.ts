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
  versions: "Summary",
  device: "Device",
  androidVersion: "Android version",
  resourceName: "Resource name",
  resourceVersion: "Resource version",
  abi: "Architecture",
  loadProjectHint: "Load a project from Settings.",
  currentSelection: "Current selection",
  refreshStatus: "Refresh status",
  enabledTasks: "{count} tasks",
  privilegedHost: "Permissions",
  virtualDisplay: "Virtual display",
  virtualDisplayGeometry: "{width} x {height}",
  virtualDisplayRunning: "Running",
  virtualDisplayStopped: "Stopped",
  virtualDisplayStreamConnecting: "Connecting stream",
  virtualDisplayStreamUnavailable: "Stream unavailable",
  virtualDisplayCodecUnsupported: "WebView cannot decode the stream",
  virtualDisplayStreamError: "Stream error",
  virtualDisplayFullscreen: "Fullscreen",
  virtualDisplayExitFullscreen: "Exit fullscreen",
  displayId: "Display ID: {id}",
  permissionGranted: "Granted",
  permissionRequiredStatus: "Required",
  shizuku: "Shizuku",
  shizukuOffline: "Offline",
  privilegedStarting: "Connecting",
  privilegedDisconnected: "Disconnected",
  privilegedError: "Error",
  privilegedConnectedDescription:
    "The privileged control unit is connected and ready to run tasks.",
  shizukuPermissionDescription:
    "Shizuku is running, but this app still needs authorization. Request access, then approve it in the Shizuku prompt.",
  shizukuNotInstalledDescription:
    "Shizuku is not running. Install or open Shizuku, start its service, then return here to retry.",
  privilegedStartingDescription:
    "Connecting to the privileged control unit through Shizuku.",
  privilegedDisconnectedDescription:
    "The privileged control unit is no longer connected. Restart Shizuku if needed, then retry.",
  privilegedErrorDescription:
    "The privileged control unit failed to start. Check Shizuku and the Android service logs, then retry.",
  requestPermission: "Request Shizuku permission",
  openShizuku: "Open Shizuku",
  announcement: "Announcement",
  openAnnouncement: "View announcement",
  hideAnnouncementOnLaunch: "Don't show this announcement again",
  confirm: "Confirm",

  // Known backend diagnostics, localized when shown as notifications
  diagnosticShizukuUnavailable:
    "Shizuku is unavailable; install or start Shizuku, then try again",
  diagnosticShizukuPermissionRequired:
    "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again",
  diagnosticControlServiceDisconnected:
    "The privileged control service disconnected; restart Shizuku and reopen the app, then try again",
  diagnosticControlServiceFailedToStart:
    "The privileged control unit failed to start; check Shizuku and the app logs, then try again",
  diagnosticControlServiceStarting:
    "The privileged control unit is starting; try again shortly",
  diagnosticVirtualDisplayRejected:
    "The privileged control service rejected the virtual display",
  diagnosticVirtualDisplayInactive: "The virtual display is not active",
  diagnosticVirtualDisplayBackRejected:
    "Android rejected the virtual display back-key injection",
  diagnosticVirtualDisplayBackUnavailable:
    "The privileged control service is unavailable for the virtual display back key",

  // Settings, project scope
  noResources: "No resources are declared.",
  globalOptions: "Global options",
  resourceOptions: "Resource options",
  invalidInput: "Invalid value",

  // Tasks
  tasksAndRun: "Tasks & Run",
  runActivity: "Run activity",
  taskList: "Task list",
  taskLogs: "Task logs",
  addTask: "Add task",
  newConfiguration: "New configuration",
  configurationLabel: "Configuration {n}",
  dragReorder: "Drag to reorder",
  removeTask: "Remove",
  noTasksToAdd: "All tasks are already in this configuration.",
  noRunLogs: "No run activity yet.",
  runLogStatus: "Status",
  runLogTask: "Task",
  runLogFocus: "Focus",
  runLogAgent: "Agent",
  runLogWarning: "Warning",
  runLogError: "Error",
  presets: "Presets",
  applyPreset: "Apply",
  toggleOn: "On",
  requiresOtherController: "Requires a different controller or resource.",

  // Run controls
  taskOperations: "Task actions",
  start: "Start",
  stop: "Stop",
  captureScreenshot: "Shot",
  back: "Back",
  screenshotSavedNotice: "Screenshot saved to this run.",

  // Settings
  settings: "Settings",
  apply: "Apply",
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
  closeTargetAppAfterRun: "Close target app after the run",
  touchPreview: "Touch preview",
  touchPreviewDescription:
    "Show touch positions on the virtual display preview.",
  showTouchPositions: "Show click positions",
  telemetry: "Anonymous telemetry",
  telemetryDescription:
    "Share crash and task statistics with the resource author. Debug builds never upload anything, and you can turn this off at any time.",
  telemetryEnabled: "Allow anonymous telemetry",
  focusDismiss: "OK",
  close: "Close",
  dismissNotification: "Dismiss notification",
  diagnostics: "Diagnostics",
  exportLogs: "Export logs",
  exportingLogs: "Exporting",
  logsExported: "Logs exported to Downloads: {name}",
  logsExportedPath: "Logs exported: {path}",
  deleteRuns: "Delete runs",
  deleting: "Deleting",
  deleteRunsConfirm:
    "Delete all stored run directories? Diagnostic exports inside them will also be removed.",
  deletedRuns: "Deleted {count} run directories",
  privileges: "Privileges",
  about: "About",
  appName: "MaaTauriAndroid",
  aboutFramework: "MaaFramework version",
  aboutUnknown: "Unknown",
  aboutSummaryHint: "Device basics are collected when exporting diagnostics.",
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
  versions: "概要",
  device: "设备",
  androidVersion: "Android 版本",
  resourceName: "资源名称",
  resourceVersion: "资源版本",
  abi: "架构",
  loadProjectHint: "请在设置页加载项目。",
  currentSelection: "当前选择",
  refreshStatus: "刷新状态",
  enabledTasks: "{count} 个任务",
  privilegedHost: "权限",
  virtualDisplay: "虚拟屏",
  virtualDisplayGeometry: "{width} x {height}",
  virtualDisplayRunning: "运行中",
  virtualDisplayStopped: "已停止",
  virtualDisplayStreamConnecting: "正在连接画面流",
  virtualDisplayStreamUnavailable: "画面流不可用",
  virtualDisplayCodecUnsupported: "WebView 不支持解码该画面流",
  virtualDisplayStreamError: "画面流出错",
  virtualDisplayFullscreen: "全屏",
  virtualDisplayExitFullscreen: "退出全屏",
  displayId: "Display ID：{id}",

  noResources: "未声明资源。",
  globalOptions: "全局选项",
  resourceOptions: "资源选项",
  invalidInput: "输入不合法",

  tasksAndRun: "任务与运行",
  runActivity: "运行活动",
  taskList: "任务列表",
  taskLogs: "任务日志",
  addTask: "添加任务",
  newConfiguration: "新建配置",
  configurationLabel: "配置 {n}",
  dragReorder: "拖动排序",
  removeTask: "移除",
  noTasksToAdd: "所有任务都已添加。",
  noRunLogs: "暂无运行日志。",
  runLogStatus: "状态",
  runLogTask: "任务",
  runLogFocus: "Focus",
  runLogAgent: "Agent",
  runLogWarning: "警告",
  runLogError: "错误",
  presets: "预设",
  applyPreset: "启用",
  toggleOn: "启用",
  requiresOtherController: "需要其他控制器或资源。",

  taskOperations: "任务操作",
  start: "开始",
  stop: "停止",
  captureScreenshot: "截图",
  back: "返回",
  screenshotSavedNotice: "截图已保存到本次运行记录。",

  settings: "设置",
  apply: "应用",
  language: "语言",
  languageDescription:
    "默认跟随设备语言：系统语言为中文时使用中文，否则使用英文。",
  languageSystem: "跟随系统",
  languageChinese: "简体中文",
  languageEnglish: "English",
  projectDirectory: "项目目录",
  loadProject: "加载项目",
  runBehavior: "运行行为",
  forceStopTargetApp: "运行前强制停止目标应用",
  closeTargetAppAfterRun: "运行结束后关闭目标应用",
  touchPreview: "触点预览",
  touchPreviewDescription: "在虚拟屏预览中显示点击的位置。",
  showTouchPositions: "显示点击位置",
  telemetry: "匿名遥测",
  telemetryDescription:
    "向资源作者共享崩溃与任务统计数据。调试构建不会上传任何内容，你也可以随时关闭。",
  telemetryEnabled: "允许匿名遥测",
  focusDismiss: "知道了",
  close: "关闭",
  dismissNotification: "关闭通知",
  diagnostics: "诊断",
  exportLogs: "导出日志",
  exportingLogs: "导出中",
  logsExported: "日志已导出到下载目录：{name}",
  logsExportedPath: "日志已导出：{path}",
  deleteRuns: "删除运行记录",
  deleting: "删除中",
  deleteRunsConfirm: "要删除全部运行目录吗？其中的诊断导出也会一并删除。",
  deletedRuns: "已删除 {count} 个运行目录",
  privileges: "权限",
  about: "关于",
  appName: "MaaTauriAndroid",
  aboutFramework: "MaaFramework版本",
  aboutUnknown: "未知",
  aboutSummaryHint: "导出诊断信息时将会收集设备基础信息。",
  permissionGranted: "已授权",
  permissionRequiredStatus: "未授权",
  shizuku: "Shizuku",
  shizukuOffline: "未运行",
  privilegedStarting: "连接中",
  privilegedDisconnected: "已断开",
  privilegedError: "错误",
  privilegedConnectedDescription: "特权控制单元已连接，可以运行任务。",
  shizukuPermissionDescription:
    "Shizuku 正在运行，但尚未授权本应用。请先请求权限，并在 Shizuku 弹窗中完成授权。",
  shizukuNotInstalledDescription:
    "Shizuku 未运行。请安装或打开 Shizuku 并启动服务，然后回到这里重试。",
  privilegedStartingDescription: "正在通过 Shizuku 连接特权控制单元。",
  privilegedDisconnectedDescription:
    "特权控制单元已断开。如需要请重启 Shizuku，然后重试。",
  privilegedErrorDescription:
    "特权控制单元启动失败。请检查 Shizuku 和 Android 服务日志，然后重试。",
  requestPermission: "申请 Shizuku 权限",
  openShizuku: "打开 Shizuku",
  announcement: "公告",
  openAnnouncement: "查看公告",
  hideAnnouncementOnLaunch: "下次启动不再展示",
  confirm: "确认",

  diagnosticShizukuUnavailable: "Shizuku 不可用；请安装或启动 Shizuku 后重试",
  diagnosticShizukuPermissionRequired:
    "尚未授予 Shizuku 权限；请在 Shizuku 中授权本应用后重试",
  diagnosticControlServiceDisconnected:
    "特权控制服务已断开；请重启 Shizuku 并重新打开本应用后重试",
  diagnosticControlServiceFailedToStart:
    "特权控制单元启动失败；请检查 Shizuku 和应用日志后重试",
  diagnosticControlServiceStarting: "特权控制单元正在启动；请稍后重试",
  diagnosticVirtualDisplayRejected: "特权控制服务拒绝了虚拟屏请求",
  diagnosticVirtualDisplayInactive: "虚拟屏未启动",
  diagnosticVirtualDisplayBackRejected: "Android 拒绝了虚拟屏返回键注入",
  diagnosticVirtualDisplayBackUnavailable:
    "特权控制服务不可用，无法发送虚拟屏返回键",
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

/**
 * Backend diagnostics arrive as fixed English strings. The known run-start
 * failures map onto catalog keys so notifications can follow the interface
 * language; anything unknown is shown as the original backend text.
 */
const diagnosticKeys: Record<string, MessageKey> = {
  "Shizuku is unavailable; install or start Shizuku, then try again":
    "diagnosticShizukuUnavailable",
  "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again":
    "diagnosticShizukuPermissionRequired",
  "The privileged control service disconnected; restart Shizuku and reopen the app, then try again":
    "diagnosticControlServiceDisconnected",
  "The privileged control unit failed to start; check Shizuku and the app logs, then try again":
    "diagnosticControlServiceFailedToStart",
  "The privileged control unit is starting; try again shortly":
    "diagnosticControlServiceStarting",
  "The privileged control service rejected the virtual display":
    "diagnosticVirtualDisplayRejected",
  "The virtual display is not active": "diagnosticVirtualDisplayInactive",
  "Android rejected the virtual display back-key injection":
    "diagnosticVirtualDisplayBackRejected",
  "The privileged control service is unavailable for the virtual display back key":
    "diagnosticVirtualDisplayBackUnavailable",
};

/** Localizes a known backend diagnostic; unknown text passes through unchanged. */
export function localizeDiagnostic(
  message: string,
  language: AppLanguage,
): string {
  const key = diagnosticKeys[message];
  return key ? translate(language, key) : message;
}

/** Translated strings for the current configuration, re-rendering when it changes. */
export function useTranslation(): Translation {
  const setting = useAppStore(
    (state) => state.snapshot?.configuration.uiLanguage,
  );
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

import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import {
  type AppLanguage,
  isChineseLocale,
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
} from "./language";
import type { PrivilegedStatus, RunEvent } from "./types";

export type { AppLanguage } from "./language";
export {
  isChineseLocale,
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
};

/** Backend diagnostic for a run start rejected because Shizuku was never
 * authorized. Shared by the English catalog and the localization table that
 * keys off this exact wording, so the two cannot drift apart. */
const SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC =
  "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again";

const en = {
  // Bottom navigation
  navHome: "Home",
  navTasks: "Tasks",
  navRuns: "Runs",
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
  virtualDisplayBack: "Back",
  virtualDisplayStopTitle: "Stop virtual display",
  virtualDisplayStopWarning:
    "This will close the virtual display and the running app.",
  virtualDisplayStopHint: "To stop the task, use the task action panel.",
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
  privilegedBackend: "Privileged backend",
  backendShizuku: "Shizuku",
  backendRoot: "Root",
  rootStartingDescription:
    "Requesting root access. Approve the su prompt if it appears.",
  rootPermissionDescription:
    "Root access has not been granted. Request access again and approve the su prompt.",
  rootUnavailableDescription:
    "Root access is unavailable. Check that the device is rooted and that the su tool grants this app access.",
  rootDisconnectedDescription:
    "The root control unit is no longer connected. Request root access again.",
  rootErrorDescription:
    "The root control unit failed to start. Check the root prompt and the Android service logs, then retry.",
  requestPermission: "Request Shizuku permission",
  requestRootAccess: "Request root access",
  openShizuku: "Open Shizuku",
  announcement: "Announcement",
  openAnnouncement: "View announcement",
  announcementPreparing: "Loading announcement",
  announcementUnavailable: "Announcement is unavailable right now.",
  hideAnnouncementOnLaunch: "Don't show this announcement again",
  confirm: "Confirm",
  cancel: "Cancel",

  // Known backend diagnostics, localized when shown as notifications
  diagnosticShizukuUnavailable:
    "Shizuku is unavailable; install or start Shizuku, then try again",
  diagnosticShizukuPermissionRequired: SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC,
  diagnosticControlServiceDisconnected:
    "The privileged control service disconnected; restart Shizuku and reopen the app, then try again",
  diagnosticControlServiceFailedToStart:
    "The privileged control unit failed to start; check Shizuku and the app logs, then try again",
  diagnosticControlServiceStarting:
    "The privileged control unit is starting; try again shortly",
  diagnosticRootAccessDenied: "Root access was denied or timed out",
  diagnosticShizukuConnectFailed:
    "The Shizuku control unit could not be connected",
  diagnosticShizukuPermissionRequestFailed:
    "The Shizuku permission request failed, was denied, or timed out",
  diagnosticShizukuOpenFailed: "Shizuku is not installed or cannot be opened",
  diagnosticVirtualDisplayRejected:
    "The privileged control service rejected the virtual display",
  diagnosticVirtualDisplayInactive: "The virtual display is not active",
  diagnosticVirtualDisplayScreenEmpty:
    "No app is running on the virtual display. Start the game or select a start task.",
  diagnosticPermissionRequestInProgress:
    "The run needs permission; requesting it now.",
  diagnosticPermissionRequestSucceeded:
    "Permission granted; starting the run again.",
  diagnosticPermissionRequestFailed:
    "Permission was not granted; request it again and allow it in the prompt.",
  diagnosticVirtualDisplayBackRejected:
    "Android rejected the virtual display back-key injection",
  diagnosticVirtualDisplayBackUnavailable:
    "The privileged control service is unavailable for the virtual display back key",
  diagnosticGameFpsLow:
    "Low game frame rate: median {medianFps} FPS over the last {windowSeconds} seconds (threshold {thresholdFps} FPS), reported by {source}.",
  diagnosticGameFpsDegraded:
    "Game frame rate is low: median {medianFps} FPS over the last {windowSeconds} seconds.",
  diagnosticGameFpsSourceCallback: "the system frame-rate callback",
  diagnosticGameFpsSourceCounter: "the approximate frame counter",

  // Settings, project scope
  noResources: "No resources are declared.",
  globalOptions: "Global options",
  resourceOptions: "Resource options",
  taskSettings: "Task settings",
  taskSettingsEmpty: "No settings available to display",
  invalidInput: "Invalid value",
  invalidTimeInput: "Enter a 24-hour time (HH:mm)",

  // Tasks
  tasksAndRun: "Tasks & Run",
  runActivity: "Run activity",
  taskList: "Task list",
  taskLogs: "Task logs",
  addTask: "Add task",
  newConfiguration: "New configuration",
  configurationLabel: "Configuration {n}",
  dragReorder: "Drag to reorder",
  openTaskDetails: "Task details: {task}",
  taskName: "Task name",
  removeTask: "Remove",
  removeTaskConfirmTitle: "Remove task",
  removeTaskConfirmWarning:
    "This removes {task} from the current configuration.",
  removeTaskConfirmHint: "The task options are discarded as well.",
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
  taskConfigLocked: "Task configuration is locked while a run is in progress.",
  taskActionsTitle: "Task actions: {task}",
  runCurrentTask: "Run this task",
  runCurrentAndFollowingTasks: "Run this and later tasks",

  // Run controls
  taskOperations: "Task actions",
  startRun: "Start run",
  noRunnableTasksNotice: "No runnable task is available.",
  startUnavailableNotice: "Starting is unavailable right now.",
  enginePreparingNotice: "The engine is still preparing.",
  enginePreparationFailed: "Engine preparation failed.",
  stop: "Stop",
  stopRun: "Stop run",
  captureScreenshot: "Shot",
  back: "Back",
  screenshotSavedNotice: "Screenshot saved to this run.",

  // Startup preparation
  preparing: "Preparing",
  preparationTitle: "Preparing app",
  preparationFailed: "Preparation failed.",
  preparationRetry: "Retry",
  preparationCopying: "Copying packaged resources",
  preparationExtracting: "Extracting resources ({count})",
  preparationStageCheckingInstallation: "Checking installed resources",
  preparationStageInstallingProject: "Preparing project resources",
  preparationStageInitializingSecrets: "Initializing secure storage",
  preparationStageLoadingProject: "Loading project",
  preparationStageLoadingRuntimeLibraries: "Loading runtime libraries",
  preparationStageConnectingControl: "Connecting control service",
  preparationStageEngineReady: "Engine ready",

  // Settings
  settings: "Settings",
  apply: "Apply",
  language: "Language",
  languageSystem: "System",
  languageChinese: "简体中文",
  languageEnglish: "English",
  projectDirectory: "Project directory",
  loadProject: "Load project",
  runBehavior: "Run behavior",
  forceStopTargetApp: "Force stop target app",
  closeTargetAppAfterRun: "Close target app after the run",
  closeTargetAppAfterRunDescription:
    "Off keeps the virtual display, the preview and the target app after the run. Stop the display to end the session.",
  foregroundMode: "Foreground mode",
  foregroundModeDescription:
    "Run on the physical screen instead of a virtual display. Android will show the target app while the run is active.",
  showTouchPositions: "Show click positions",
  showVirtualDisplayFps: "Show current frame rate",
  telemetry: "Anonymous telemetry",
  telemetryDescription:
    "Share crash and task statistics with the resource author. Debug builds never upload anything, and you can turn this off at any time.",
  telemetryEnabled: "Allow anonymous telemetry",
  focusDismiss: "OK",
  close: "Close",
  dismissNotification: "Dismiss notification",
  diagnostics: "Diagnostics",
  reinstallResources: "Re-extract resources",
  reinstallingResources: "Re-extracting",
  debugMode: "Debug mode",
  debugModeRestartConfirm:
    "Enabling debug mode restarts the app: app debug logging starts, MaaFramework attaches recognition snapshots and debug draws, and a running task is interrupted. Restart now?",
  debugModeDescription:
    "Enables the app's own debug logging and asks MaaFramework to attach recognition snapshots and debug draws to its details for easier diagnosis. Enabling it restarts the app; MaaFramework picks it up from the next run.",
  exportLogs: "Export logs",
  exportingLogs: "Exporting",
  logsExported: "Logs exported to Downloads: {name}",
  logsExportedPath: "Logs exported: {path}",
  deleteRuns: "Delete logs",
  deleting: "Deleting",
  deleteRunsConfirm:
    "Delete all stored run directories and log files? Diagnostic exports inside them will also be removed, and the app restarts immediately afterwards.",
  deletedRuns: "Deleted {count} run directories and cleared log files",
  runHistoryTitle: "Run history",
  runHistoryDescription: "Each run is saved locally for 30 days.",
  runHistoryBack: "Back to run list",
  runHistoryEmpty: "No run records yet",
  runHistoryTaskCount: "{count} tasks",
  runHistoryRunCount: "{count} runs",
  runHistoryDelete: "Delete this record",
  runHistoryDeleteConfirm:
    "Delete this run record? The saved log file will be removed with it.",
  runHistoryDeleted: "Run record deleted",
  runHistoryCleanup: "Clean up old records",
  runHistoryCleanupConfirm: "Delete run records older than 30 days?",
  runHistoryCleanedUp: "Deleted {count} run records",
  runHistoryStartedAt: "Started at",
  runHistoryTasks: "Tasks",
  runHistoryDuration: "Duration",
  runHistoryEndedAt: "Ended at",
  runHistoryEventDetails: "Event details",
  runHistoryOutcomeCompleted: "Completed",
  runHistoryOutcomeCancelled: "Stopped",
  runHistoryOutcomeFailed: "Failed",
  runHistoryOutcomeInterrupted: "Incomplete",
  runHistoryMissing: "No readable record for this run",
  runTaskAborted: "The task aborted abnormally",
  privileges: "Privileges",
  about: "About",
  appName: "MaaTauriAndroid",
  aboutFramework: "MaaFramework version",
  aboutUnknown: "Unknown",
  aboutSummaryHint: "Device basics are collected when exporting diagnostics.",
  aboutContact: "Contact",
  aboutLicense: "License",
  aboutRepository: "Repository",

  scheduleTitle: "Scheduled runs",
  scheduleDescription: "Start tasks automatically at fixed or repeating times.",
  scheduleEnabledCount: "{count} enabled rules",
  scheduleNext: "Next",
  scheduleLastTrigger: "Last trigger",
  scheduleNoRules: "No scheduled rules yet.",
  scheduleNewRule: "New",
  scheduleAutoStart: "Allow auto-start",
  scheduleAutoStartHint:
    "When the app is not running, the system may launch it to run this schedule. You must also enable auto-start for this app in your device settings.",
  scheduleEdit: "Edit",
  scheduleDelete: "Delete",
  scheduleSave: "Save",
  scheduleCancel: "Cancel",
  scheduleName: "Name",
  scheduleRunConfiguration: "Run configuration",
  scheduleTriggerType: "Trigger",
  scheduleForceStart: "Force start",
  scheduleForceStartTip:
    "Interrupt a run already in progress and run this rule instead",
  scheduleFixedTime: "Clock times",
  scheduleInterval: "Interval",
  scheduleWeekdays: "Weekdays",
  scheduleWeekdayMonday: "Mon",
  scheduleWeekdayTuesday: "Tue",
  scheduleWeekdayWednesday: "Wed",
  scheduleWeekdayThursday: "Thu",
  scheduleWeekdayFriday: "Fri",
  scheduleWeekdaySaturday: "Sat",
  scheduleWeekdaySunday: "Sun",
  scheduleTime: "Time",
  scheduleAddTime: "Add time",
  scheduleEditTime: "Edit time",
  pickerYear: "Year",
  pickerMonth: "Month",
  pickerDay: "Day",
  pickerHour: "Hour",
  pickerMinute: "Min",
  scheduleIntervalStart: "First start",
  scheduleIntervalDays: "Days",
  scheduleIntervalHours: "Hours",
  scheduleIntervalSummary: "Every {hours} hours",
  scheduleNoNext: "No next trigger",
  scheduleErrorNameRequired: "Enter a rule name",
  scheduleErrorRunConfigurationRequired: "Select a run configuration",
  scheduleErrorWeekdayRequired: "Select at least one weekday",
  scheduleErrorTimeRequired: "Add at least one time",
  scheduleErrorTimeInvalid: "Use a 24-hour HH:mm time",
  scheduleErrorIntervalInvalid: "Choose a valid start and interval",
  scheduleResultStarted: "Started",
  scheduleResultDuplicate: "Duplicate",
  scheduleResultRejectedActive: "Another run was active",
  scheduleResultFailedValidation: "Validation failed",
  scheduleResultFailedServiceStart: "Service start failed",
  scheduleResultForegroundServiceDenied: "Foreground service denied",
  // Update
  update: "Update",
  updateSource: "Source",
  updateSourceAuto: "Auto",
  updateSourceMirrorchyan: "MirrorChyan",
  updateSourceGithub: "GitHub",
  updateChannel: "Channel",
  updateChannelStable: "Stable",
  updateChannelBeta: "Beta",
  updateCdk: "MirrorChyan CDK",
  updateCdkDescription: "The CDK is only stored on this device.",
  updateCdkPlaceholder: "CDK (optional)",
  updateApplyPrefs: "Save",
  updatePrefsSaved: "Update settings saved",
  updateCurrentVersion: "Current version",
  updateNewVersion: "New version",
  updateCheck: "Check for updates",
  updateChecking: "Checking for updates",
  updateUpToDate: "Already on the latest version.",
  updateAvailable: "Version {version} is available.",
  updateDownload: "Download update",
  updateResolving: "Preparing download",
  updateDownloading: "Downloading {size}",
  updateCancel: "Cancel",
  updateInstall: "Install update",
  updateInstallAgain: "Open the installer again",
  updateRetryInstall: "Retry install",
  updateInstallPrompted:
    "Handed to the Android installer. Finish the update in the system prompt.",
  updateInstallFailed: "The installer did not start.",
  updateReleaseNote: "Release notes",
  updateFailureNetwork: "Network error. Check the connection and retry.",
  updateFailureInvalidResponse:
    "The update service returned an unreadable response.",
  updateFailureCdkRequired: "Enter a MirrorChyan CDK first.",
  updateFailureCdkInvalid: "MirrorChyan rejected the CDK.",
  updateFailureCdkExpired: "The MirrorChyan CDK has expired.",
  updateFailureCdkDisabled: "The MirrorChyan CDK is disabled.",
  updateFailureCdkQuotaExceeded:
    "The MirrorChyan CDK has used up its download quota.",
  updateFailureCdkMismatch: "The MirrorChyan CDK does not cover this resource.",
  updateFailureResourceNotFound: "The update resource does not exist.",
  updateFailureResourceUnavailable: "The update resource is unavailable.",
  updateFailureInvalidDigest: "The release does not publish a usable checksum.",
  updateFailureNoMatchingAsset: "No release file matches this device.",
  updateFailureDownloadFailed: "The download failed. Retry when ready.",
  updateFailureStorage: "The download could not be written to storage.",
  updateFailureInstallerNotFound: "No app on this device can install updates.",
  updateFailureInternal: "Unexpected error. See the logs for details.",
};

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  navHome: "首页",
  navTasks: "任务",
  navRuns: "运行记录",
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
  virtualDisplayBack: "返回",
  virtualDisplayStopTitle: "停止虚拟屏",
  virtualDisplayStopWarning: "当前操作会关闭虚拟屏以及正在运行的应用。",
  virtualDisplayStopHint: "如需停止任务请在任务操作面板操作。",
  displayId: "Display ID：{id}",

  noResources: "未声明资源。",
  globalOptions: "全局选项",
  resourceOptions: "资源选项",
  taskSettings: "任务设置",
  taskSettingsEmpty: "暂无可显示的设置",
  invalidInput: "输入不合法",
  invalidTimeInput: "请输入 24 小时制时间（HH:mm）",

  tasksAndRun: "任务与运行",
  runActivity: "运行活动",
  taskList: "任务列表",
  taskLogs: "任务日志",
  addTask: "添加任务",
  newConfiguration: "新建配置",
  configurationLabel: "配置 {n}",
  dragReorder: "拖动排序",
  openTaskDetails: "任务详情：{task}",
  taskName: "任务名称",
  removeTask: "移除",
  removeTaskConfirmTitle: "移除任务",
  removeTaskConfirmWarning: "将从当前配置中移除「{task}」。",
  removeTaskConfirmHint: "该任务的选项配置也会一并丢弃。",
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
  taskConfigLocked: "任务运行中，任务配置已锁定，仅可查看详情。",
  taskActionsTitle: "任务操作：{task}",
  runCurrentTask: "执行当前任务",
  runCurrentAndFollowingTasks: "执行当前及后续任务",

  taskOperations: "任务操作",
  startRun: "开始运行",
  noRunnableTasksNotice: "当前没有可运行的任务。",
  startUnavailableNotice: "暂时无法开始运行。",
  enginePreparingNotice: "引擎仍在准备中。",
  enginePreparationFailed: "引擎准备失败。",
  stop: "停止",
  stopRun: "停止运行",
  captureScreenshot: "截图",
  back: "返回",
  screenshotSavedNotice: "截图已保存到本次运行记录。",

  // 启动准备
  preparing: "准备中",
  preparationTitle: "正在准备应用",
  preparationFailed: "准备失败。",
  preparationRetry: "重试",
  preparationCopying: "正在复制打包资源",
  preparationExtracting: "正在解压资源（{count}）",
  preparationStageCheckingInstallation: "正在检查已安装资源",
  preparationStageInstallingProject: "正在准备项目资源",
  preparationStageInitializingSecrets: "正在初始化安全存储",
  preparationStageLoadingProject: "正在加载项目",
  preparationStageLoadingRuntimeLibraries: "正在加载运行库",
  preparationStageConnectingControl: "正在连接控制服务",
  preparationStageEngineReady: "引擎已就绪",

  settings: "设置",
  apply: "应用",
  language: "语言",
  languageSystem: "跟随系统",
  languageChinese: "简体中文",
  languageEnglish: "English",
  projectDirectory: "项目目录",
  loadProject: "加载项目",
  runBehavior: "运行行为",
  forceStopTargetApp: "运行前强制停止目标应用",
  closeTargetAppAfterRun: "运行结束后关闭目标应用",
  closeTargetAppAfterRunDescription:
    "关闭后，运行结束会保留虚拟屏、画面与目标应用，直到你手动停止画面。",
  foregroundMode: "前台模式",
  foregroundModeDescription:
    "在物理屏幕上运行，而不是虚拟屏。运行期间 Android 会显示目标应用。",
  showTouchPositions: "显示点击位置",
  showVirtualDisplayFps: "显示当前帧率",
  telemetry: "匿名遥测",
  telemetryDescription:
    "向资源作者共享崩溃与任务统计数据。调试构建不会上传任何内容，你也可以随时关闭。",
  telemetryEnabled: "允许匿名遥测",
  focusDismiss: "知道了",
  close: "关闭",
  dismissNotification: "关闭通知",
  diagnostics: "诊断",
  reinstallResources: "重新解压资源",
  reinstallingResources: "解压中",
  debugMode: "调试模式",
  debugModeRestartConfirm:
    "启用调试模式需要重启应用：重启后将记录应用调试日志，MaaFramework 会附带识别原图与调试绘制，正在运行的任务会被中断。现在重启吗？",
  debugModeDescription:
    "记录应用自身的调试日志，并让 MaaFramework 在识别详情中附带识别原图与调试绘制，便于排查问题。开启后需要重启应用；MaaFramework 从下一轮运行起生效。",
  exportLogs: "导出日志",
  exportingLogs: "导出中",
  logsExported: "日志已导出到下载目录：{name}",
  logsExportedPath: "日志已导出：{path}",
  deleteRuns: "删除日志",
  deleting: "删除中",
  deleteRunsConfirm:
    "要删除全部运行目录和日志文件吗？其中的诊断导出也会一并删除，删除完成后应用会立即重启。",
  deletedRuns: "已删除 {count} 个运行目录，并清空日志文件",
  runHistoryTitle: "运行记录",
  runHistoryDescription: "每轮运行都会在本地保存 30 天。",
  runHistoryBack: "返回运行列表",
  runHistoryEmpty: "还没有运行记录",
  runHistoryTaskCount: "{count} 项任务",
  runHistoryRunCount: "{count} 次运行",
  runHistoryDelete: "删除这条记录",
  runHistoryDeleteConfirm:
    "要删除这条运行记录吗？其中保存的日志文件会一并删除。",
  runHistoryDeleted: "已删除运行记录",
  runHistoryCleanup: "清理旧记录",
  runHistoryCleanupConfirm: "要删除 30 天前的运行记录吗？",
  runHistoryCleanedUp: "已删除 {count} 条运行记录",
  runHistoryStartedAt: "开始时间",
  runHistoryTasks: "任务",
  runHistoryDuration: "耗时",
  runHistoryEndedAt: "结束时间",
  runHistoryEventDetails: "事件详情",
  runHistoryOutcomeCompleted: "已完成",
  runHistoryOutcomeCancelled: "已停止",
  runHistoryOutcomeFailed: "失败",
  runHistoryOutcomeInterrupted: "未完成",
  runHistoryMissing: "该轮没有可读的运行记录",
  runTaskAborted: "任务异常中止",
  privileges: "权限",
  about: "关于",
  appName: "MaaTauriAndroid",
  aboutFramework: "MaaFramework版本",
  aboutUnknown: "未知",
  aboutSummaryHint: "导出诊断信息时将会收集设备基础信息。",
  aboutContact: "联系方式",
  aboutLicense: "开源许可",
  aboutRepository: "项目仓库",
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
  privilegedBackend: "特权后端",
  backendShizuku: "Shizuku",
  backendRoot: "Root",
  rootStartingDescription: "正在请求 root 权限。如出现 su 弹窗，请完成授权。",
  rootPermissionDescription:
    "尚未授予 root 权限。请重新请求权限，并在 su 弹窗中完成授权。",
  rootUnavailableDescription:
    "root 权限不可用。请确认设备已 root，并且 su 工具允许本应用访问。",
  rootDisconnectedDescription: "root 控制单元已断开。请重新请求 root 权限。",
  rootErrorDescription:
    "root 控制单元启动失败。请检查 root 授权提示和 Android 服务日志，然后重试。",
  requestPermission: "申请 Shizuku 权限",
  requestRootAccess: "请求 root 权限",
  openShizuku: "打开 Shizuku",
  announcement: "公告",
  openAnnouncement: "查看公告",
  announcementPreparing: "正在加载公告",
  announcementUnavailable: "公告暂时不可用。",
  hideAnnouncementOnLaunch: "下次启动不再展示",
  confirm: "确认",
  cancel: "取消",

  diagnosticShizukuUnavailable: "Shizuku 不可用；请安装或启动 Shizuku 后重试",
  diagnosticShizukuPermissionRequired:
    "尚未授予 Shizuku 权限；请在 Shizuku 中授权本应用后重试",
  diagnosticControlServiceDisconnected:
    "特权控制服务已断开；请重启 Shizuku 并重新打开本应用后重试",
  diagnosticControlServiceFailedToStart:
    "特权控制单元启动失败；请检查 Shizuku 和应用日志后重试",
  diagnosticControlServiceStarting: "特权控制单元正在启动；请稍后重试",
  diagnosticRootAccessDenied:
    "root 授权被拒绝或已超时；请重试，并在 su 弹窗中选择允许",
  diagnosticShizukuConnectFailed:
    "Shizuku 控制服务连接失败；请确认 Shizuku 正在运行后重试",
  diagnosticShizukuPermissionRequestFailed:
    "Shizuku 授权请求失败、被拒绝或已超时；请在 Shizuku 的授权弹窗中允许本应用",
  diagnosticShizukuOpenFailed:
    "无法打开 Shizuku；请确认它已安装，且未被系统拦截",
  diagnosticVirtualDisplayRejected: "特权控制服务拒绝了虚拟屏请求",
  diagnosticVirtualDisplayInactive: "虚拟屏未启动",
  diagnosticVirtualDisplayScreenEmpty:
    "虚拟屏上没有 App 在运行，请启动游戏或选择启动任务",
  diagnosticPermissionRequestInProgress: "本次运行需要权限，正在申请。",
  diagnosticPermissionRequestSucceeded: "已获得权限，正在重新开始运行。",
  diagnosticPermissionRequestFailed:
    "权限未授予；请重新申请，并在弹窗中选择允许。",
  diagnosticVirtualDisplayBackRejected: "Android 拒绝了虚拟屏返回键注入",
  diagnosticVirtualDisplayBackUnavailable:
    "特权控制服务不可用，无法发送虚拟屏返回键",
  diagnosticGameFpsLow:
    "游戏帧率过低：最近 {windowSeconds} 秒的中位数为 {medianFps} FPS（阈值 {thresholdFps} FPS），数据来自{source}。",
  diagnosticGameFpsDegraded:
    "游戏帧率较低：最近 {windowSeconds} 秒的中位数为 {medianFps} FPS。",
  diagnosticGameFpsSourceCallback: "系统帧率回调",
  diagnosticGameFpsSourceCounter: "近似帧计数器",

  scheduleTitle: "定时任务",
  scheduleDescription: "按固定时间或重复间隔自动启动任务。",
  scheduleEnabledCount: "{count} 个已启用规则",
  scheduleNext: "下一次",
  scheduleLastTrigger: "最近触发",
  scheduleNoRules: "还没有定时规则。",
  scheduleNewRule: "新建",
  scheduleAutoStart: "允许自启动",
  scheduleAutoStartHint:
    "应用未运行时，系统可能启动应用来执行此定时任务。同时需要在系统设置中允许本应用自启动。",
  scheduleEdit: "编辑",
  scheduleDelete: "删除",
  scheduleSave: "保存",
  scheduleCancel: "取消",
  scheduleName: "名称",
  scheduleRunConfiguration: "运行配置",
  scheduleTriggerType: "触发方式",
  scheduleForceStart: "强制启动",
  scheduleForceStartTip: "到达设定时间时若有任务正在执行，中断后执行本规则",
  scheduleFixedTime: "固定时间",
  scheduleInterval: "间隔",
  scheduleWeekdays: "星期",
  scheduleWeekdayMonday: "周一",
  scheduleWeekdayTuesday: "周二",
  scheduleWeekdayWednesday: "周三",
  scheduleWeekdayThursday: "周四",
  scheduleWeekdayFriday: "周五",
  scheduleWeekdaySaturday: "周六",
  scheduleWeekdaySunday: "周日",
  scheduleTime: "时间",
  scheduleAddTime: "添加时间",
  scheduleEditTime: "编辑时间",
  pickerYear: "年",
  pickerMonth: "月",
  pickerDay: "日",
  pickerHour: "时",
  pickerMinute: "分",
  scheduleIntervalStart: "首次开始",
  scheduleIntervalDays: "天数",
  scheduleIntervalHours: "小时数",
  scheduleIntervalSummary: "每 {hours} 小时",
  scheduleNoNext: "没有下一次",
  scheduleErrorNameRequired: "请输入规则名称",
  scheduleErrorRunConfigurationRequired: "请选择运行配置",
  scheduleErrorWeekdayRequired: "请选择至少一个星期",
  scheduleErrorTimeRequired: "请添加至少一个时间",
  scheduleErrorTimeInvalid: "时间请使用 24 小时制 HH:mm",
  scheduleErrorIntervalInvalid: "请选择有效的开始时间和间隔",
  scheduleResultStarted: "已启动",
  scheduleResultDuplicate: "重复投递",
  scheduleResultRejectedActive: "已有任务运行",
  scheduleResultFailedValidation: "校验失败",
  scheduleResultFailedServiceStart: "服务启动失败",
  scheduleResultForegroundServiceDenied: "前台服务被拒绝",
  update: "更新",
  updateSource: "更新源",
  updateSourceAuto: "自动",
  updateSourceMirrorchyan: "Mirror酱",
  updateSourceGithub: "GitHub",
  updateChannel: "更新渠道",
  updateChannelStable: "稳定版",
  updateChannelBeta: "测试版",
  updateCdk: "Mirror酱 CDK",
  updateCdkDescription: "CDK 仅保存在本机。",
  updateCdkPlaceholder: "CDK（可选）",
  updateApplyPrefs: "保存",
  updatePrefsSaved: "更新设置已保存",
  updateCurrentVersion: "当前版本",
  updateNewVersion: "新版本",
  updateCheck: "检查更新",
  updateChecking: "正在检查更新",
  updateUpToDate: "已是最新版本。",
  updateAvailable: "发现新版本 {version}。",
  updateDownload: "下载更新",
  updateResolving: "正在准备下载",
  updateDownloading: "正在下载 {size}",
  updateCancel: "取消",
  updateInstall: "安装更新",
  updateInstallAgain: "重新打开安装器",
  updateRetryInstall: "重试安装",
  updateInstallPrompted: "已交给系统安装器，请在系统弹窗中完成更新。",
  updateInstallFailed: "安装器未能启动。",
  updateReleaseNote: "更新说明",
  updateFailureNetwork: "网络错误，请检查网络连接后重试。",
  updateFailureInvalidResponse: "更新服务返回了无法解析的响应。",
  updateFailureCdkRequired: "请先填写 Mirror酱 CDK。",
  updateFailureCdkInvalid: "Mirror酱拒绝了该 CDK。",
  updateFailureCdkExpired: "Mirror酱 CDK 已过期。",
  updateFailureCdkDisabled: "Mirror酱 CDK 已被禁用。",
  updateFailureCdkQuotaExceeded: "Mirror酱 CDK 的下载额度已用完。",
  updateFailureCdkMismatch: "Mirror酱 CDK 不适用于该资源。",
  updateFailureResourceNotFound: "更新资源不存在。",
  updateFailureResourceUnavailable: "更新资源暂不可用。",
  updateFailureInvalidDigest: "发布产物没有可用的校验值。",
  updateFailureNoMatchingAsset: "发布产物中没有适配本机的安装包。",
  updateFailureDownloadFailed: "下载失败，请稍后重试。",
  updateFailureStorage: "下载数据无法写入存储。",
  updateFailureInstallerNotFound: "本机没有可以安装更新包的应用。",
  updateFailureInternal: "出现意外错误，详情请查看日志。",
};

const catalog: Record<AppLanguage, Record<MessageKey, string>> = { en, zh };

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
 * and privileged-action failures map onto catalog keys so notifications can
 * follow the interface language; generic "Maa task … failed: …" task-abort
 * messages collapse to a short localized notice. Anything unknown is shown
 * as the original backend text.
 */
const diagnosticKeys: Record<string, MessageKey> = {
  "Shizuku is unavailable; install or start Shizuku, then try again":
    "diagnosticShizukuUnavailable",
  [SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC]:
    "diagnosticShizukuPermissionRequired",
  "The privileged control service disconnected; restart Shizuku and reopen the app, then try again":
    "diagnosticControlServiceDisconnected",
  "The privileged control unit failed to start; check Shizuku and the app logs, then try again":
    "diagnosticControlServiceFailedToStart",
  "The privileged control unit is starting; try again shortly":
    "diagnosticControlServiceStarting",
  "Root access was denied or timed out": "diagnosticRootAccessDenied",
  "The Shizuku control unit could not be connected":
    "diagnosticShizukuConnectFailed",
  "The Shizuku permission request failed, was denied, or timed out":
    "diagnosticShizukuPermissionRequestFailed",
  "Shizuku is not installed or cannot be opened": "diagnosticShizukuOpenFailed",
  "The privileged control service rejected the virtual display":
    "diagnosticVirtualDisplayRejected",
  "The virtual display is not active": "diagnosticVirtualDisplayInactive",
  "Android rejected the virtual display back-key injection":
    "diagnosticVirtualDisplayBackRejected",
  "The privileged control service is unavailable for the virtual display back key":
    "diagnosticVirtualDisplayBackUnavailable",
};

const TASK_ABORT_PATTERN = /^Maa task \S+ failed: /;

/** English wording of the notices the run-start permission retry shows. They
 * are also the activity-log keys, so the same sentence never gets a second
 * name. */
export const runStartPermissionNotices = {
  requesting: translate("en", "diagnosticPermissionRequestInProgress"),
  succeeded: translate("en", "diagnosticPermissionRequestSucceeded"),
  failed: translate("en", "diagnosticPermissionRequestFailed"),
} as const;

/**
 * Whether a failed run start can be repaired by requesting privileged access.
 * Only a missing Shizuku grant qualifies: an uninstalled, disconnected, or
 * failed control unit reports a different diagnostic, where prompting the user
 * for permission would not help.
 */
export function isPermissionRequiredDiagnostic(message: string): boolean {
  return message === SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC;
}

/**
 * Whether a failed run start was refused because the privileged control unit
 * was still coming up. That state resolves on its own, so the start can simply
 * wait for it and try again.
 */
export function isControlUnitStartingDiagnostic(message: string): boolean {
  return message === translate("en", "diagnosticControlServiceStarting");
}

/** Only a missing grant can be advanced by asking; other states cannot. */
export function canRequestPrivilegedAccess(status: PrivilegedStatus): boolean {
  return status.status === "permissionRequired";
}

/**
 * Localizes a known backend diagnostic. Task failures collapse to the short
 * localized notice (details live in the run history/logs); unknown text
 * passes through unchanged.
 */
export function localizeDiagnostic(
  message: string,
  language: AppLanguage,
): string {
  const key = diagnosticKeys[message];
  if (key) return translate(language, key);
  if (TASK_ABORT_PATTERN.test(message)) {
    return translate(language, "runTaskAborted");
  }
  return message;
}

/**
 * Runtime warnings stay in the exported backend log in English. Known events
 * also carry structured values so the live UI can render the interface locale.
 */
export function localizeRunEvent(
  event: RunEvent,
  language: AppLanguage,
): string {
  const data = event.data;
  if (data?.diagnostic === "screenEmpty") {
    return translate(language, "diagnosticVirtualDisplayScreenEmpty");
  }
  if (data?.diagnostic === "gameFps") {
    const level =
      data.level === "low"
        ? "diagnosticGameFpsLow"
        : data.level === "degraded"
          ? "diagnosticGameFpsDegraded"
          : undefined;
    if (
      level &&
      typeof data.windowSeconds === "number" &&
      typeof data.medianFps === "number" &&
      typeof data.thresholdFps === "number"
    ) {
      const source =
        data.source === "taskCallback"
          ? translate(language, "diagnosticGameFpsSourceCallback")
          : data.source === "frameCounter"
            ? translate(language, "diagnosticGameFpsSourceCounter")
            : undefined;
      if (source) {
        return translate(language, level, {
          windowSeconds: Math.round(data.windowSeconds),
          medianFps: Math.round(data.medianFps),
          thresholdFps: Math.round(data.thresholdFps),
          source,
        });
      }
    }
  }
  return localizeDiagnostic(event.message, language);
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

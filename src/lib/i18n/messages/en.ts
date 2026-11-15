export const SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC =
  "Shizuku permission has not been granted; grant MaaTauriAndroid access in Shizuku, then try again";

export const en = {
  checkboxMinimumSelection: "Select at least {count} options.",
  optionPathFile: "Choose file",
  optionPathDirectory: "Choose directory",
  optionPathPicking: "Selecting / importing…",
  optionPathClear: "Clear path",
  optionPathCopyHint:
    "Resolvable local files and directories keep their original shared-storage paths. Other files are copied to shared Downloads (up to 256 MiB). Directories without a local path are not supported. You can also enter a native path manually.",
  optionPathPickFailed:
    "Could not select this path. Use a shared-storage location accessible to the privileged Agent; cloud directories are unsupported. File imports require Android 10+ and must be within 256 MiB. Close any open picker and retry, or enter a native path manually.",

  settingHelpFor: "Explain {name}",
  demoTitle: "Try configuring tasks",
  demoReplay: "Practice task setup",
  demoResource: "Practice resource",
  demoTaskFirst: "Daily collection",
  demoTaskSecond: "Inventory check",
  demoTaskDescription:
    "Open this task’s details to change the practice options.",
  demoOptionSwitch: "Extra collection",
  demoOptionMode: "Collection mode",
  demoOff: "Off",
  demoOn: "On",
  demoModeNormal: "Normal",
  demoModeFast: "Quick",
  demoConfigurationA: "Daily",
  demoConfigurationB: "Weekly",
  demoIsolated:
    "This practice uses temporary data. It does not change your tasks or run automation.",
  demoEnableStep: "1. Enable “Daily collection” using its checkbox.",
  demoOptionsStep:
    "2. Open “Daily collection” details, enable “Extra collection” and choose “Quick” mode, then close the details.",
  demoReorderStep: "3. Drag “Inventory check” above “Daily collection”.",
  demoConfigurationStep: "4. Switch to the “Weekly” configuration.",

  settingHelp: "Show setting explanation",
  githubTokenValidate: "Validate token",
  githubTokenValid: "Token is valid.",
  githubTokenInvalid: "Token is invalid or expired.",
  credentialValidate: "Validate CDK",
  credentialChecking: "Validating…",
  credentialUnknown: "Not verified in this session.",
  credentialExpiresIn: "Valid · expires in {days} days",
  credentialKnownExpiry:
    "Last known expiry: in {days} days · not verified this session",
  credentialValidUnknownExpiry: "Valid · expiry time unavailable",
  releaseNotesTitle: "Update history",
  releaseNotesEmpty: "No saved release notes yet.",
  releaseNotesInstalled: "Installed version",
  releaseNotesPending: "Available version",
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

  // First-use guide
  guideSummaryTitle: "Know your project",
  guideSummaryBody:
    "Check the app, framework, and resource versions here. Include them when reporting a problem after an update.",
  guidePrivilegeTitle: "Authorize the control unit",
  guidePrivilegeBody:
    "Tasks need Root or Shizuku access. Pick a backend, request access, and wait for the granted state here before starting a run.",
  guideTasksTabTitle: "Open the Tasks tab",
  guideTasksTabBody:
    "Use the bottom navigation to switch to Tasks. The next steps cover resource selection, plans, and run controls.",
  guideResourceTitle: "Choose the resource",
  guideResourceBody:
    "The resource decides which task bundle, options, and updates the app uses. Switch it before arranging tasks.",
  guideConfigurationTitle: "Arrange task plans",
  guideConfigurationBody:
    "Use tabs to switch plans, add a new plan, enable or reorder tasks, and open a task to adjust its parameters.",
  guideRunTitle: "Start and stop runs",
  guideRunBody:
    "The main button starts the enabled tasks and stops an active run. The menu beside it lets you export logs, capture a screenshot, or send a Back action.",
  guideActivitiesTitle: "Follow the run",
  guideActivitiesBody:
    "Switch between the task list and live run logs. Logs remain collected while the task list is visible.",
  guideRunsTabTitle: "Open the Runs tab",
  guideRunsTabBody:
    "Use the bottom navigation to switch to Runs. This is where past runs are reviewed.",
  guideHistoryTitle: "Inspect past runs",
  guideHistoryBody:
    "Every run is kept locally for 30 days. Open a record to review timing, task outcome, and detailed events.",
  guideSettingsTabTitle: "Open the Settings tab",
  guideSettingsTabBody:
    "Use the bottom navigation to switch to Settings. The next steps cover diagnostics and this guide.",
  guideSettingsTitle: "Configure and diagnose",
  guideSettingsBody:
    "Settings contains run behavior, backup, diagnostics, updates, and this guide. Export logs before reporting an issue.",
  guideExportLogsTitle: "Export logs",
  guideExportLogsBody:
    "Choose Export logs under diagnostics. The logs are saved to Downloads; attach them when reporting an issue.",
  guideBack: "Back",
  guideNext: "Next",
  guideDone: "Done",
  guideSkip: "Skip",
  guideReplay: "View guide",
  guideProgress: "{current} / {total}",
  guideRunActive: "View the guide after the current run finishes.",
  guideUnavailable:
    "The guide is unavailable right now. Try again from Settings.",

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
  directoryPermissionRuntime:
    "The privileged process cannot access {path}. Reconnect the selected Root/Shizuku backend and retry. If you switched backends, try preparing the runtime again with Root; inspect ownership and mount details in the logs if it still fails.",
  directoryPermissionLogs:
    "The app cannot write logs to {path}. Check app storage access and the directory ownership shown in the logs. Tasks can continue, but file logs may be missing.",
  directoryReadOnly:
    "The directory {path} is on read-only storage. Check the storage or ROM restrictions before retrying; switching Root/Shizuku alone may not fix it.",
  directoryNoSpace:
    "Storage is full or its quota is exhausted at {path}. Free space, then retry.",
  directoryNotDirectory:
    "A file or invalid path blocks the directory {path}. Inspect the path in the logs before re-extracting resources or preparing the runtime again.",
  directoryUnknown:
    "Could not use {path}. Check the original error, process identity, directory ownership and mount information in the logs, then retry.",
  virtualDisplayRunning: "Running",
  virtualDisplayCompatibilityWarning:
    "Virtual display compatibility mode: screen off or lock may pause tasks, and input may take focus from the main screen.",
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
  announcementDismissCountdown: "You can close this in {seconds}s",
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
  diagnosticRunStopped: "The run was stopped",
  diagnosticRunAborted: "The run was aborted because it could not continue",
  diagnosticRunTimeLimit:
    "The run was stopped after reaching the configured maximum duration",
  diagnosticControlServiceLost:
    "the privileged control service became unavailable during the run; stopping the run",
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
  displayHazardAdbInput:
    "USB debugging (Security settings) is disabled. Enable it in Developer options to allow shell touch input. Root can try to enable it for you.",
  adbInputEnableRoot: "Enable with Root",
  adbInputOpenSettings: "Developer options",
  adbInputRepairFailed:
    "Could not enable USB debugging (Security settings). Enable it manually in Developer options.",
  displayHazardTitle: "Before you start",
  displayHazardSmartResolution:
    'System "Smart resolution" is enabled. It can break recognition in background mode. Turn it off in the system display settings first. Start anyway?',
  displayHazardEyeProtection:
    "Eye comfort / night mode is enabled. It may affect color recognition accuracy. Start anyway?",
  displayHazardStartAnyway: "Start anyway",
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
  exitAppAfterRun: "Exit app after the run",
  exitAppAfterRunDescription:
    "After a natural completion or failure, flush notifications and telemetry, stop Android services, and exit this app. Manual stops never exit.",
  maxRunDuration: "Max run duration (minutes)",
  maxRunDurationDescription:
    "Stops the run once it reaches this limit. Leave empty for no limit.",
  maxRunDurationInvalid:
    "Enter whole minutes between 1 and 1440, or leave empty for no limit.",
  foregroundMode: "Foreground mode",
  foregroundModeDescription:
    "Run on the physical screen instead of a virtual display. Android will show the target app while the run is active.",
  foregroundOverlay: "Floating control panel",
  foregroundOverlayDescription:
    "While a foreground run is active, draws a draggable ball over the physical screen: tap it to stop the run or open this app without leaving the target app. Needs the display-over-other-apps permission, and the ball itself is captured by the automation's screenshots.",
  foregroundOverlayPermission: "Display over other apps",
  foregroundOverlayGrant: "Grant permission",
  foregroundOverlayForegroundOnly: "Only takes effect in foreground mode.",
  showTouchPositions: "Show click positions",
  showVirtualDisplayFps: "Show current frame rate",
  pipOnHome: "Picture-in-picture on Home",
  pipOnHomeDescription:
    "Return home from the tasks page during a background run to show the virtual display in a small window. Viewing only; game input is unavailable.",
  telemetry: "Anonymous telemetry",
  telemetryDescription:
    "Share crash and task statistics with the resource author. Debug builds never upload anything, and you can turn this off at any time.",
  telemetryEnabled: "Allow anonymous telemetry",
  focusDismiss: "OK",
  close: "Close",
  dismissNotification: "Dismiss notification",
  diagnostics: "Diagnostics",
  backupRestore: "Backup & restore",
  backupRestoreDescription:
    "Export settings, run configurations and schedules. Password inputs are never exported; import replaces all of them.",
  exportConfiguration: "Export configuration",
  exportingConfiguration: "Exporting",
  configurationExported: "Backup exported to Downloads: {name}",
  configurationExportedPath: "Backup exported: {path}",
  importConfiguration: "Import configuration",
  importingConfiguration: "Importing",
  configurationImportConfirm:
    "Import this backup? All current settings, run configurations and schedules will be replaced. Password inputs will be empty and must be entered again.",
  configurationImported:
    "Backup imported. Enter password fields again before running tasks.",
  configurationImportTooLarge: "The backup exceeds the 4 MiB size limit.",
  configurationImportReadFailed:
    "Could not read the selected backup. Please select it again.",
  customBackground: "Custom background",
  customBackgroundDescription:
    "Choose a picture on this device. It fills the background without distortion, is kept in app-private storage, and is not included in backups.",
  backgroundCardOpacity: "Card opacity",
  backgroundCardOpacityDescription:
    "Lower values let more of the background show through cards.",
  backgroundImageImport: "Choose image",
  backgroundImageImporting: "Importing",
  backgroundImageRemove: "Remove",
  backgroundImageRemoving: "Removing",
  backgroundImageEmpty: "No background image",
  backgroundImageImported: "Background image updated",
  backgroundImageRemoved: "Background image removed",
  configurationRecoveryBackupRestored:
    "Settings could not be read; the latest usable backup was restored.",
  configurationRecoveryResetForParse:
    "Settings could not be read and were reset to defaults. The damaged file was kept for troubleshooting.",
  configurationRecoveryResetForSecret:
    "Settings could not be decrypted and were reset to defaults. The unreadable file was kept for troubleshooting.",
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
  scheduleResultMissed: "Alarm was not delivered",
  scheduleResultStarted: "Started",
  scheduleResultDuplicate: "Duplicate",
  scheduleResultRejectedActive: "Another run was active",
  scheduleResultFailedValidation: "Validation failed",
  scheduleResultFailedServiceStart: "Service start failed",
  scheduleResultForegroundServiceDenied: "Foreground service denied",
  scheduleHealthTitle: "Schedule environment",
  scheduleHealthHint:
    "Scheduled runs depend on these; fix the items below so they can start in the background.",
  scheduleHealthFix: "Fix",
  scheduleHealthBackendDown: "The privileged backend is not running",
  scheduleHealthBackendNotGranted:
    "The privileged backend has not been authorized",
  scheduleHealthBattery: "Battery optimization is not ignored",
  scheduleHealthExactAlarm: "Exact alarms are not allowed",
  scheduleHealthNotification: "Notification permission is off",
  scheduleHealthOverlay: "Overlay permission is off",
  scheduleOpenAutostartSettings: "Open auto-start settings",
  // Update
  update: "Update",
  updateSource: "Source",
  updateSourceMirrorchyan: "MirrorChyan",
  updateSourceGithub: "GitHub",
  updateChannel: "Channel",
  updateChannelStable: "Stable",
  updateChannelBeta: "Beta",
  updateGithubToken: "GitHub Token",
  updateGithubTokenPlaceholder: "Token (optional)",
  updateGithubTokenDescription:
    "Used to authenticate GitHub release queries and API asset downloads, with a higher API rate limit. Stored encrypted on this device. Leave empty for anonymous requests; clear and save to remove.",
  updatePrefsSaveFailed:
    "Could not save update settings. Try again when no update is running.",
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
  pretasks: "Pre-tasks",
};

export type MessageKey = keyof typeof en;

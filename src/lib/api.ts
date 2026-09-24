import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type {
  AppStateSnapshot,
  LogExport,
  PrivilegedBackend,
  PrivilegedStatus,
  ResolvedRun,
  RunEvent,
  RunHistoryEntry,
  RunResult,
  ScheduleRule,
  ScheduleRuleStatus,
  ScheduleSummary,
  UpdatePrefs,
  UpdateStatus,
  UserConfiguration,
  VirtualDisplayStatus,
} from "./types";

export async function bootstrapApp() {
  return invoke<AppStateSnapshot>("bootstrap");
}

export async function loadProject(path: string, language?: string) {
  return invoke<AppStateSnapshot>("load_project", { path, language });
}

export async function readProjectImage(path: string) {
  return invoke<ArrayBuffer>("read_project_image", { path });
}

export async function saveConfiguration(configuration: UserConfiguration) {
  return invoke<UserConfiguration>("save_configuration", { configuration });
}

export async function applyPreset(presetName: string) {
  return invoke<UserConfiguration>("apply_preset", { presetName });
}

export async function resolveCurrent() {
  return invoke<ResolvedRun>("resolve_current");
}

export async function getPrivilegedStatus() {
  return invoke<PrivilegedStatus>("privileged_status");
}

export async function getPrivilegedBackend() {
  return invoke<PrivilegedBackend>("get_privileged_backend");
}

export async function setPrivilegedBackend(backend: PrivilegedBackend) {
  return invoke<void>("set_privileged_backend", { backend });
}

export async function requestPrivilegedAccess() {
  return invoke<void>("request_privileged_access");
}

export async function openShizuku() {
  return invoke<void>("open_shizuku");
}

export async function startVirtualDisplay() {
  return invoke<VirtualDisplayStatus>("start_virtual_display");
}

export async function stopVirtualDisplay() {
  return invoke<VirtualDisplayStatus>("stop_virtual_display");
}

export async function getVirtualDisplayStatus() {
  return invoke<VirtualDisplayStatus>("virtual_display_status");
}

export async function getVirtualDisplayStream() {
  return invoke<{ url: string | null }>("virtual_display_stream");
}

export async function setVirtualDisplayLandscape(enabled: boolean) {
  return invoke<void>("set_virtual_display_landscape", { enabled });
}

export async function touchVirtualDisplay(input: {
  displayId: number;
  action: 6 | 7 | 8;
  x: number;
  y: number;
  contact: number;
}) {
  return invoke<{ accepted: boolean; code: number; message: string }>(
    "virtual_display_touch",
    input,
  );
}

export async function pressVirtualDisplayBack() {
  return invoke<void>("virtual_display_back");
}

export async function setVirtualDisplayTouchMarkers(enabled: boolean) {
  return invoke<
    Array<{
      id: number;
      x: number;
      y: number;
      action: number;
      contact: number;
    }>
  >("set_virtual_display_touch_markers", { enabled });
}

export async function getRunStatus() {
  return invoke<RunResult>("run_status");
}

export async function stopRun(executionId?: string) {
  return invoke<string>("stop_run", { executionId });
}

/// Acknowledges one blocking (`display: "modal"`) focus message, releasing
/// the backend queue gate that pauses task advancement.
export async function resolveFocusModal() {
  return invoke<void>("resolve_focus_modal");
}

/// Asks Android for the POST_NOTIFICATIONS runtime permission (once per
/// install). Backend OS notifications for focus `display: "notification"`
/// are silently dropped without it.
export async function requestNotificationPermission() {
  try {
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function isNotificationGranted() {
  try {
    return (await isPermissionGranted()) === true;
  } catch {
    return false;
  }
}

export async function startRun() {
  return invoke<{ executionId: string; message: string; taskCount: number }>(
    "start_run",
  );
}

export async function exportLogs() {
  return invoke<LogExport>("export_logs");
}

export async function captureManualScreenshot(executionId?: string) {
  return invoke<{ executionId: string; path: string }>(
    "capture_manual_screenshot",
    {
      executionId,
    },
  );
}

export async function clearDiagnosticData() {
  return invoke<{ deletedRunCount: number; runsDir: string }>(
    "clear_diagnostic_data",
  );
}

export async function reinstallResources() {
  return invoke<AppStateSnapshot>("reinstall_resources");
}

export async function restartApp() {
  return invoke("restart_app");
}

export async function listRunHistory() {
  return invoke<Array<RunHistoryEntry>>("list_run_history");
}

export async function readRunHistory(executionId: string) {
  return invoke<Array<RunEvent>>("read_run_history", { executionId });
}

export async function deleteRunHistory(executionId: string) {
  return invoke<boolean>("delete_run_history", { executionId });
}

export async function cleanupRunHistory(keepDays?: number) {
  return invoke<number>("cleanup_run_history", { keepDays });
}

export async function listScheduleRules() {
  return invoke<Array<ScheduleRuleStatus>>("list_schedule_rules");
}

export async function saveScheduleRule(rule: ScheduleRule) {
  return invoke<ScheduleRule>("save_schedule_rule", { rule });
}

export async function deleteScheduleRule(id: string) {
  return invoke<void>("delete_schedule_rule", { id });
}

export async function setScheduleRuleEnabled(id: string, enabled: boolean) {
  return invoke<ScheduleRule>("set_schedule_rule_enabled", { id, enabled });
}

export async function getScheduleStatus() {
  return invoke<ScheduleSummary>("get_schedule_status");
}

export async function getUpdateStatus() {
  return invoke<UpdateStatus>("update_get_status");
}

export async function checkForUpdate() {
  return invoke<UpdateStatus>("update_check");
}

export async function resolveUpdate() {
  return invoke<UpdateStatus>("update_resolve");
}

export async function cancelUpdate() {
  return invoke<UpdateStatus>("update_cancel");
}

export async function installUpdate() {
  return invoke<UpdateStatus>("update_install");
}

export async function getUpdatePrefs() {
  return invoke<UpdatePrefs>("update_get_prefs");
}

export async function setUpdatePrefs(prefs: UpdatePrefs) {
  return invoke<UpdatePrefs>("update_set_prefs", { prefs });
}

/** Physical-pixel insets to keep clear of; null on desktop or without an activity. */
export async function windowInsets() {
  return invoke<{ top: number; bottom: number } | null>("window_insets");
}

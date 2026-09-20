import { invoke } from "@tauri-apps/api/core";
import type {
  AppStateSnapshot,
  LogExport,
  PrivilegedStatus,
  ResolvedRun,
  RunResult,
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

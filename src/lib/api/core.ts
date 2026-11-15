import { invoke } from "@tauri-apps/api/core";
import type {
  AppStateSnapshot,
  ConfigurationExport,
  ConfigurationImportResult,
  LogExport,
  PreparationState,
  ResolvedRun,
  RunEvent,
  RunHistoryEntry,
  UserConfiguration,
} from "../types";

export interface ProjectTextReadResult {
  path: string;
  text?: string | null;
  error?: string | null;
}

export async function bootstrapApp() {
  return invoke<AppStateSnapshot>("bootstrap");
}

export async function prepareApp() {
  return invoke<AppStateSnapshot>("prepare_app");
}

export async function releaseStartupSplash() {
  return invoke<void>("release_startup_splash");
}

export async function getPreparationStatus() {
  return invoke<PreparationState>("get_preparation_status");
}

export async function retryPreparation() {
  return invoke<PreparationState>("retry_preparation");
}

export async function loadProject(path: string, language?: string) {
  return invoke<AppStateSnapshot>("load_project", { path, language });
}

export async function readProjectImage(path: string) {
  return invoke<ArrayBuffer>("read_project_image", { path });
}

export async function readProjectText(path: string) {
  return invoke<string>("read_project_text", { path });
}

export async function readProjectTextResults(paths: string[]) {
  return invoke<ProjectTextReadResult[]>("read_project_texts", { paths });
}

export async function readProjectTexts(paths: string[]) {
  const results = await readProjectTextResults(paths);
  return results.map((result) => {
    if (result.error != null) throw new Error(result.error);
    if (typeof result.text !== "string") {
      throw new Error(
        `Project Interface text read had no body: ${result.path}`,
      );
    }
    return result.text;
  });
}

export async function applyPreset(presetName: string) {
  return invoke<UserConfiguration>("apply_preset", { presetName });
}

export async function saveConfiguration(configuration: UserConfiguration) {
  return invoke<UserConfiguration>("save_configuration", { configuration });
}

export async function exportLogs() {
  return invoke<LogExport>("export_logs");
}

export async function exportConfiguration() {
  return invoke<ConfigurationExport>("export_configuration");
}

export async function importConfiguration() {
  return invoke<ConfigurationImportResult>("import_configuration");
}

export async function importBackgroundImage() {
  return invoke<UserConfiguration>("import_background_image");
}

export async function removeBackgroundImage() {
  return invoke<UserConfiguration>("remove_background_image");
}

export async function readBackgroundImage() {
  return invoke<ArrayBuffer>("read_background_image");
}

export async function captureManualScreenshot(executionId?: string) {
  return invoke<{ executionId: string; path: string }>(
    "capture_manual_screenshot",
    { executionId },
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

export async function resolveCurrent() {
  return invoke<ResolvedRun>("resolve_current");
}

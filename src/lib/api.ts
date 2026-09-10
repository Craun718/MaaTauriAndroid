import { invoke } from "@tauri-apps/api/core";
import type {
  AppStateSnapshot,
  DiagnosticExport,
  ResolvedRun,
  RunState,
  UserConfiguration,
} from "./types";

export async function bootstrapApp() {
  return invoke<AppStateSnapshot>("bootstrap");
}

export async function loadProject(path: string, language?: string) {
  return invoke<AppStateSnapshot>("load_project", { path, language });
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
  return invoke<{ message: string; setupRequired: string[] }>("privileged_status");
}

export async function getRunStatus() {
  return invoke<{ executionId?: string; state: RunState; message: string }>("run_status");
}

export async function stopRun(executionId?: string) {
  return invoke<string>("stop_run", { executionId });
}

export async function startRun() {
  return invoke<{ executionId: string; message: string; taskCount: number }>("start_run");
}

export async function exportDiagnostics(executionId?: string) {
  return invoke<DiagnosticExport>("export_diagnostics", { executionId });
}

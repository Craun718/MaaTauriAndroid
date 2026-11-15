import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import type { RunResult, StartRunStatus, TaskRunSelection } from "../types";

export async function getRunStatus() {
  return invoke<RunResult>("run_status");
}

export async function stopRun(executionId?: string) {
  return invoke<string>("stop_run", { executionId });
}

export async function resolveFocusModal() {
  return invoke<void>("resolve_focus_modal");
}

let pendingNotificationPermission: Promise<boolean> | undefined;

/// Checks Android's POST_NOTIFICATIONS permission before requesting it.
/// notification 2.4.0 never resolves an Android request when already granted;
/// each such call blocks a Tokio worker. Share in-flight checks/requests too,
/// so concurrent starts cannot enqueue duplicate permission prompts.
export function requestNotificationPermission(): Promise<boolean> {
  if (pendingNotificationPermission) return pendingNotificationPermission;
  pendingNotificationPermission = (async () => {
    try {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      // A failed check must not fall through to the potentially hanging request.
      return false;
    }
  })().finally(() => {
    pendingNotificationPermission = undefined;
  });
  return pendingNotificationPermission;
}

export async function isNotificationGranted() {
  try {
    return (await isPermissionGranted()) === true;
  } catch {
    return false;
  }
}

/// Whether Android lets the app draw over other apps. The foreground floating
/// control panel cannot be shown without it.
export async function getOverlayPermissionStatus() {
  return invoke<boolean>("overlay_permission_status");
}

/// Opens the system "display over other apps" screen for this app. The user
/// comes back with the app in the foreground; callers re-query the status then.
export async function requestOverlayPermission() {
  return invoke<void>("request_overlay_permission");
}

export async function startRun(selection?: TaskRunSelection) {
  if (!selection) return invoke<StartRunStatus>("start_run");
  return invoke<StartRunStatus>("start_run", { taskSelection: selection });
}

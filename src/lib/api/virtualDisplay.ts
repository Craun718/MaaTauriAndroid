import { invoke } from "@tauri-apps/api/core";
import type { DisplayHazards, VirtualDisplayStatus } from "../types";

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

/** Physical-pixel insets to keep clear of; null on desktop or without an activity. */
export async function windowInsets() {
  return invoke<{ top: number; bottom: number } | null>("window_insets");
}

export async function getDisplayHazards() {
  return invoke<DisplayHazards>("display_hazards");
}

export interface VirtualDisplayPipRequest {
  displayId?: number;
  viewing?: boolean;
  eligible: boolean;
  width: number;
  height: number;
  sourceRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
}

let pendingPipUpdate = Promise.resolve();

export function updateVirtualDisplayPip(
  request: VirtualDisplayPipRequest,
): Promise<void> {
  const update = pendingPipUpdate.then(() =>
    invoke<void>("update_virtual_display_pip", { request }),
  );
  pendingPipUpdate = update.catch(() => undefined);
  return update;
}

export async function enableAdbInput(): Promise<boolean> {
  return invoke<boolean>("enable_adb_input");
}

export async function openDeveloperSettings(): Promise<boolean> {
  return invoke<boolean>("open_developer_settings");
}

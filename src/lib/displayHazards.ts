import type { DisplayHazards } from "./types";

export type DisplayHazard = "smartResolution" | "eyeProtection";

/**
 * Orders the pre-run warnings the same way MaaFwApp does: smart resolution
 * first and only in background mode, then eye-comfort mode.
 */
export function pendingDisplayHazards(
  hazards: DisplayHazards,
  foregroundMode: boolean,
): DisplayHazard[] {
  const pending: DisplayHazard[] = [];
  if (!foregroundMode && hazards.smartResolution) {
    pending.push("smartResolution");
  }
  if (hazards.eyeProtectionSource) {
    pending.push("eyeProtection");
  }
  return pending;
}

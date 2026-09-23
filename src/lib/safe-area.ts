import { windowInsets } from "./api";

/**
 * CSS safe-area overrides for the Android system bars.
 *
 * Chromium only delivers system-bar and cutout insets to `env(safe-area-inset-*)`
 * from M136 in fullscreen WebViews (M144 everywhere), so on older WebViews — the
 * majority in the wild — those env values read 0 and the three-button navigation
 * bar draws right on top of the bottom tab. This module pulls the real insets
 * from the Android shell over IPC and applies them as CSS variables.
 *
 * `max()` prefers whichever side reports the larger inset: on new WebViews the
 * env value is correct and equal, on old ones the native reading wins. Values
 * stay physical px, matching the env() convention (never rem).
 */
export function safeAreaOverrides(insets: {
  top: number;
  bottom: number;
}): Record<string, string> {
  const top = Math.max(0, Math.round(insets.top));
  const bottom = Math.max(0, Math.round(insets.bottom));
  return {
    "--tt-safe-top": `max(env(safe-area-inset-top, 0px), ${top}px)`,
    "--tt-safe-bottom": `max(env(safe-area-inset-bottom, 0px), ${bottom}px)`,
  };
}

export function applySafeAreaOverrides(insets: {
  top: number;
  bottom: number;
}): void {
  for (const [name, value] of Object.entries(safeAreaOverrides(insets))) {
    document.documentElement.style.setProperty(name, value);
  }
}

/**
 * Reads insets once and applies them. Failures are swallowed by design: on
 * desktop (and before the JNI bridge is attached) the command reports nothing
 * and the CSS env()-only defaults stay in place.
 */
export async function syncSafeAreaInsets(): Promise<void> {
  try {
    const insets = await windowInsets();
    if (insets) {
      applySafeAreaOverrides(insets);
    }
  } catch {
    // Keep the env()-only defaults.
  }
}

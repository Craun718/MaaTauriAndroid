import type { VirtualDisplayPipRequest } from "./api";
import type { VirtualDisplayStatus } from "./types";

export function pipEligible(input: {
  enabled: boolean;
  foreground: boolean;
  running: boolean;
  fullscreen: boolean;
  ready: boolean;
  status?: VirtualDisplayStatus;
}): boolean {
  return (
    input.enabled &&
    !input.foreground &&
    input.running &&
    !input.fullscreen &&
    input.ready &&
    input.status?.active === true &&
    input.status.width > 0 &&
    input.status.height > 0
  );
}

/** Clip the actual video bounds to the viewport before converting CSS to physical pixels. */
export function pipSourceRect(
  bounds: { left: number; top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  dpr: number,
): VirtualDisplayPipRequest["sourceRect"] {
  const values = [
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom,
    viewport.width,
    viewport.height,
    dpr,
  ];
  if (!values.every(Number.isFinite) || dpr <= 0) return null;
  const left = Math.round(Math.max(0, bounds.left) * dpr);
  const top = Math.round(Math.max(0, bounds.top) * dpr);
  const right = Math.round(Math.min(viewport.width, bounds.right) * dpr);
  const bottom = Math.round(Math.min(viewport.height, bounds.bottom) * dpr);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

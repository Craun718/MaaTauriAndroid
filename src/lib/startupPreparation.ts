import type { PreparationState } from "./types";

export type BootstrapStatus = "loading" | "ready" | "failed";

export interface PreparationOverlayState {
  visible: boolean;
  running: boolean;
  failed: boolean;
}

export function preparationOverlayState(
  bootstrapStatus: BootstrapStatus,
  preparation?: PreparationState,
): PreparationOverlayState {
  const running =
    bootstrapStatus === "loading" ||
    (preparation?.status === "running" && !preparation.projectReady);
  const failed =
    bootstrapStatus === "failed" ||
    (preparation?.status === "failed" && !preparation.uiReady);
  return { visible: running || failed, running, failed };
}

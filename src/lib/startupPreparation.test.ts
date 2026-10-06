import { describe, expect, it } from "vitest";
import { preparationOverlayState } from "./startupPreparation";
import type { PreparationState } from "./types";

function preparation(
  changes: Partial<PreparationState> = {},
): PreparationState {
  return {
    revision: 1,
    status: "running",
    stage: "loadingProject",
    projectReady: true,
    uiReady: true,
    engineReady: false,
    ...changes,
  };
}

describe("preparationOverlayState", () => {
  it("keeps the overlay while frontend bootstrap is loading", () => {
    expect(
      preparationOverlayState("loading", preparation({ projectReady: true })),
    ).toEqual({ visible: true, running: true, failed: false });
  });

  it("hides the overlay once the project UI can mount", () => {
    expect(
      preparationOverlayState("ready", preparation({ projectReady: true })),
    ).toEqual({ visible: false, running: false, failed: false });
  });

  it("blocks when native preparation has not reached the project root", () => {
    expect(
      preparationOverlayState("ready", preparation({ projectReady: false })),
    ).toEqual({ visible: true, running: true, failed: false });
  });

  it("shows engine failures in page only after UI readiness", () => {
    expect(
      preparationOverlayState(
        "ready",
        preparation({ status: "failed", error: "library failed" }),
      ),
    ).toEqual({ visible: false, running: false, failed: false });
  });

  it("keeps startup failures modal before the UI is ready", () => {
    expect(
      preparationOverlayState(
        "ready",
        preparation({
          status: "failed",
          projectReady: false,
          uiReady: false,
          error: "extract failed",
        }),
      ),
    ).toEqual({ visible: true, running: false, failed: true });
  });
});

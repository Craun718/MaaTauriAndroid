import { beforeEach, describe, expect, it } from "vitest";
import { useBackgroundPreviewStore } from "./backgroundPreviewStore";

beforeEach(() => {
  useBackgroundPreviewStore.getState().clearCardOpacity();
});

describe("background card opacity preview", () => {
  it("publishes each drag value before committing configuration", () => {
    const { previewCardOpacity } = useBackgroundPreviewStore.getState();
    previewCardOpacity(75);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBe(75);
    previewCardOpacity(40);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBe(40);
  });

  it("clears the completed preview so the saved value can take over", () => {
    const { previewCardOpacity, clearCardOpacity } =
      useBackgroundPreviewStore.getState();
    previewCardOpacity(50);
    clearCardOpacity(useBackgroundPreviewStore.getState().revision);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBeUndefined();
  });

  it("keeps a newer drag when an earlier save finishes, even at the same value", () => {
    const { previewCardOpacity, clearCardOpacity } =
      useBackgroundPreviewStore.getState();
    previewCardOpacity(50);
    const revision = useBackgroundPreviewStore.getState().revision;
    previewCardOpacity(75);
    previewCardOpacity(50);
    clearCardOpacity(revision);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBe(50);
  });

  it("discards a preview when leaving settings", () => {
    const { previewCardOpacity, clearCardOpacity } =
      useBackgroundPreviewStore.getState();
    previewCardOpacity(50);
    clearCardOpacity();
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBeUndefined();
  });

  it("normalizes out-of-range and invalid preview values", () => {
    const { previewCardOpacity } = useBackgroundPreviewStore.getState();
    previewCardOpacity(0);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBe(25);
    previewCardOpacity(Number.NaN);
    expect(useBackgroundPreviewStore.getState().cardOpacity).toBe(100);
  });
});

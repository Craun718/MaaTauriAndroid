import { create } from "zustand";
import { backgroundCardOpacity } from "../lib/backgroundImage";

interface BackgroundPreviewStore {
  cardOpacity?: number;
  revision: number;
  previewCardOpacity: (value: number) => void;
  clearCardOpacity: (revision?: number) => void;
}

/** Drag previews stay separate from the configuration persisted on commit. */
export const useBackgroundPreviewStore = create<BackgroundPreviewStore>(
  (set) => ({
    cardOpacity: undefined,
    revision: 0,
    previewCardOpacity(value) {
      set((state) => ({
        cardOpacity: backgroundCardOpacity(value),
        revision: state.revision + 1,
      }));
    },
    clearCardOpacity(revision) {
      set((state) =>
        revision === undefined || revision === state.revision
          ? { cardOpacity: undefined, revision: state.revision + 1 }
          : state,
      );
    },
  }),
);

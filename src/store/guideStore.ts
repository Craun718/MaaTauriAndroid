import { create } from "zustand";
import { type GuideTargetName, markGuideSeen } from "../lib/guide";
import { useAppStore } from "./appStore";

interface GuideStore {
  active: boolean;
  /** Also suppresses automatic retries if saving fails during this session. */
  dismissed: boolean;
  target?: GuideTargetName;
  start: () => void;
  setTarget: (target: GuideTargetName) => void;
  cancel: () => void;
  finish: () => void;
}

export const useGuideStore = create<GuideStore>((set, get) => ({
  active: false,
  dismissed: false,
  start() {
    if (get().active) return;
    set({ active: true, dismissed: true, target: undefined });
  },
  setTarget(target) {
    if (get().active) set({ target });
  },
  cancel() {
    set({ active: false, target: undefined });
  },
  finish() {
    if (!get().active) return;
    set({ active: false, target: undefined });
    const { snapshot, saveConfiguration } = useAppStore.getState();
    if (!snapshot) return;
    const configuration = markGuideSeen(snapshot.configuration);
    // Use the normal save queue and its error notification, including on Skip.
    if (configuration !== snapshot.configuration) {
      void saveConfiguration(configuration);
    }
  },
}));

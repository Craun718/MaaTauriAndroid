import { create } from "zustand";
import {
  applyPreset as invokeApplyPreset,
  bootstrapApp,
  loadProject as invokeLoadProject,
  saveConfiguration as invokeSaveConfiguration,
} from "../lib/api";
import type { AppStateSnapshot, UserConfiguration } from "../lib/types";

interface AppStore {
  snapshot?: AppStateSnapshot;
  busy: boolean;
  error?: string;
  bootstrap: () => Promise<void>;
  loadProject: (path: string, language?: string) => Promise<void>;
  applyPreset: (presetName: string) => Promise<void>;
  saveConfiguration: (configuration: UserConfiguration) => Promise<void>;
  setError: (error?: string) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const useAppStore = create<AppStore>((set) => ({
  busy: false,
  async bootstrap() {
    set({ busy: true, error: undefined });
    try {
      set({ snapshot: await bootstrapApp(), busy: false });
    } catch (error) {
      set({ error: message(error), busy: false });
    }
  },
  async loadProject(path, language) {
    set({ busy: true, error: undefined });
    try {
      set({ snapshot: await invokeLoadProject(path, language), busy: false });
    } catch (error) {
      set({ error: message(error), busy: false });
    }
  },
  async applyPreset(presetName) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    set({ busy: true, error: undefined });
    try {
      set({
        snapshot: {
          ...current,
          configuration: await invokeApplyPreset(presetName),
        },
        busy: false,
      });
    } catch (error) {
      set({ error: message(error), busy: false });
    }
  },
  async saveConfiguration(configuration) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    set({ busy: true, error: undefined });
    try {
      set({
        snapshot: {
          ...current,
          configuration: await invokeSaveConfiguration(configuration),
        },
        busy: false,
      });
    } catch (error) {
      set({ error: message(error), busy: false });
    }
  },
  setError(error) {
    set({ error });
  },
}));

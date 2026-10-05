import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getPreparationStatus, retryPreparation } from "../lib/api";
import type { PreparationState } from "../lib/types";
import { useAppStore } from "./appStore";

interface PreparationStore {
  state?: PreparationState;
  retrying: boolean;
  initialize: () => Promise<void>;
  retry: () => Promise<void>;
}

export function acceptPreparationState(
  current: PreparationState | undefined,
  next: PreparationState,
): PreparationState {
  if (current && next.revision <= current.revision) return current;
  return next;
}

let activeListener: Promise<UnlistenFn> | undefined;

async function connectListener(): Promise<UnlistenFn> {
  if (!activeListener) {
    const pending = listen<PreparationState>("preparation-state", (event) => {
      usePreparationStore.setState((state) => ({
        state: acceptPreparationState(state.state, event.payload),
      }));
    });
    activeListener = pending;
    void pending.catch(() => {
      if (activeListener === pending) activeListener = undefined;
    });
  }
  return activeListener;
}

export const usePreparationStore = create<PreparationStore>((set) => ({
  retrying: false,
  async initialize() {
    await connectListener();
    try {
      const queried = await getPreparationStatus();
      set((state) => ({
        state: acceptPreparationState(state.state, queried),
      }));
    } catch {
      // Native preparation may fail before the Tauri app handle exists. The
      // bootstrap command and later events still report the authoritative state.
    }
  },
  async retry() {
    if (usePreparationStore.getState().retrying) return;
    set({ retrying: true });
    try {
      const next = await retryPreparation();
      set((state) => ({ state: acceptPreparationState(state.state, next) }));
      await useAppStore.getState().bootstrap();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        state: state.state
          ? {
              ...state.state,
              revision: state.state.revision + 1,
              status: "failed",
              stage: "failed",
              projectReady: false,
              uiReady: false,
              engineReady: false,
              error: message,
            }
          : undefined,
      }));
    } finally {
      set({ retrying: false });
    }
  },
}));

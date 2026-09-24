import { create } from "zustand";
import {
  bootstrapApp,
  applyPreset as invokeApplyPreset,
  loadProject as invokeLoadProject,
  reinstallResources as invokeReinstallResources,
  saveConfiguration as invokeSaveConfiguration,
} from "../lib/api";
import type { AppStateSnapshot, UserConfiguration } from "../lib/types";
import { useNotificationStore } from "./notificationStore";

interface AppStore {
  snapshot?: AppStateSnapshot;
  busy: boolean;
  error?: string;
  dismissedWelcomeFingerprint?: string;
  bootstrap: () => Promise<void>;
  reinstallResources: () => Promise<void>;
  loadProject: (path: string, language?: string) => Promise<void>;
  applyPreset: (presetName: string) => Promise<void>;
  saveConfiguration: (configuration: UserConfiguration) => Promise<void>;
  setError: (error?: string) => void;
  dismissWelcome: (fingerprint: string) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportError(error: unknown) {
  useNotificationStore.getState().notify(message(error), { tone: "error" });
}

/** 串行化保存请求：上一笔落盘完成后才发下一笔，响应不会互相超车。 */
let saveQueue: Promise<void> = Promise.resolve();
let pendingSaves = 0;

export const useAppStore = create<AppStore>((set) => ({
  busy: false,
  dismissedWelcomeFingerprint: undefined,
  async bootstrap() {
    set({ busy: true, error: undefined });
    try {
      set({ snapshot: await bootstrapApp(), busy: false });
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async reinstallResources() {
    set({ busy: true, error: undefined });
    try {
      set({ snapshot: await invokeReinstallResources(), busy: false });
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async loadProject(path, language) {
    set({ busy: true, error: undefined });
    try {
      set({ snapshot: await invokeLoadProject(path, language), busy: false });
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
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
      reportError(error);
    }
  },
  async saveConfiguration(configuration) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    // 先乐观更新：受控控件（任务启用勾选等）必须立刻反映点击结果，
    // 否则要等一整轮 IPC 往返才会变化，视觉上像是「点了一下又弹回去」。
    set({
      busy: true,
      error: undefined,
      snapshot: { ...current, configuration },
    });
    pendingSaves += 1;
    const request = saveQueue.then(async () => {
      const persisted = await invokeSaveConfiguration(configuration);
      const state = useAppStore.getState();
      // 仅当乐观更新的对象仍是最新状态时才采用后端归一化的副本，
      // 避免响应把用户在此期间做出的新改动覆盖掉。
      if (state.snapshot?.configuration === configuration) {
        set({ snapshot: { ...state.snapshot, configuration: persisted } });
      }
    });
    saveQueue = request.catch(() => undefined);
    try {
      await request;
    } catch (error) {
      set({ error: message(error) });
      reportError(error);
    } finally {
      pendingSaves -= 1;
      if (pendingSaves === 0) set({ busy: false });
    }
  },
  setError(error) {
    set({ error });
  },
  dismissWelcome(fingerprint) {
    set({ dismissedWelcomeFingerprint: fingerprint });
  },
}));

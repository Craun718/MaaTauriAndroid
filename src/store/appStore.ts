import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  applyPreset as invokeApplyPreset,
  loadProject as invokeLoadProject,
  reinstallResources as invokeReinstallResources,
  saveConfiguration as invokeSaveConfiguration,
  prepareApp,
} from "../lib/api";
import type {
  AppStateSnapshot,
  UserConfiguration,
  WelcomeState,
} from "../lib/types";
import { useNotificationStore } from "./notificationStore";

interface AppStore {
  snapshot?: AppStateSnapshot;
  busy: boolean;
  saving: boolean;
  error?: string;
  dismissedWelcomeFingerprint?: string;
  bootstrap: () => Promise<void>;
  reinstallResources: () => Promise<void>;
  loadProject: (path: string, language?: string) => Promise<void>;
  applyPreset: (presetName: string) => Promise<void>;
  saveConfiguration: (configuration: UserConfiguration) => Promise<void>;
  setError: (error?: string) => void;
  dismissWelcome: (fingerprint: string) => void;
  applyWelcomeState: (state: WelcomeState) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportError(error: unknown) {
  useNotificationStore.getState().notify(message(error), { tone: "error" });
}

/** 串行化配置写入请求：上一笔落盘完成后才发下一笔，响应不会互相超车。 */
let saveQueue: Promise<void> = Promise.resolve();
let pendingSaves = 0;
let configurationRevision = 0;
let welcomeListener: Promise<UnlistenFn> | undefined;

function ensureWelcomeListener() {
  if (!welcomeListener) {
    const pending = listen<WelcomeState>("welcome-state", (event) => {
      useAppStore.getState().applyWelcomeState(event.payload);
    });
    welcomeListener = pending;
    void pending.catch(() => {
      if (welcomeListener === pending) welcomeListener = undefined;
    });
  }
  return welcomeListener;
}

function revisedSnapshot(snapshot: AppStateSnapshot) {
  configurationRevision += 1;
  return { snapshot, busy: false };
}

export function canApplyWelcomeState(
  snapshot: AppStateSnapshot | undefined,
  state: WelcomeState,
): boolean {
  return (
    snapshot?.welcomeRevision === undefined ||
    state.revision === snapshot.welcomeRevision
  );
}

/**
 * 等所有已入队的配置保存和预设套用真正落到后端。启动运行前用它替代「保存
 * 中禁用开始按钮」：任务列表的改动是乐观更新加后台落盘，`saving` 只表示还有
 * 请求在路上，拿它去改按钮外观的话，每改一次任务列表或套用一次预设按钮就
 * 闪一下。队列里的失败各自上报且已被 catch，所以这里不抛错；等待期间新入队
 * 的写入也会一并等完。
 */
export async function waitForPendingSaves(): Promise<void> {
  while (pendingSaves > 0) await saveQueue;
}

export const useAppStore = create<AppStore>((set) => ({
  busy: false,
  saving: false,
  dismissedWelcomeFingerprint: undefined,
  async bootstrap() {
    set({ busy: true, error: undefined });
    void ensureWelcomeListener();
    try {
      set(revisedSnapshot(await prepareApp()));
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async reinstallResources() {
    set({ busy: true, error: undefined });
    try {
      set(revisedSnapshot(await invokeReinstallResources()));
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async loadProject(path, language) {
    set({ busy: true, error: undefined });
    try {
      set(revisedSnapshot(await invokeLoadProject(path, language)));
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async applyPreset(presetName) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    const revision = ++configurationRevision;
    set({ saving: true, error: undefined });
    pendingSaves += 1;
    const request = saveQueue.then(async () => {
      const persisted = await invokeApplyPreset(presetName);
      const state = useAppStore.getState();
      // Only the latest queued configuration change may update the snapshot.
      // Otherwise an older normalized response can overwrite a newer edit.
      if (configurationRevision === revision && state.snapshot) {
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
      if (pendingSaves === 0) set({ saving: false });
    }
  },
  async saveConfiguration(configuration) {
    const current = useAppStore.getState().snapshot;
    if (!current) return;
    const revision = ++configurationRevision;
    // 先乐观更新：受控控件（任务启用勾选等）必须立刻反映点击结果，
    // 否则要等一整轮 IPC 往返才会变化，视觉上像是「点了一下又弹回去」。
    set({
      saving: true,
      error: undefined,
      snapshot: { ...current, configuration },
    });
    pendingSaves += 1;
    const request = saveQueue.then(async () => {
      const persisted = await invokeSaveConfiguration(configuration);
      const state = useAppStore.getState();
      // 仅当这次乐观更新仍是最后一次配置变更时才采用后端归一化的副本，
      // 避免响应把用户在此期间做出的新改动覆盖掉。
      if (configurationRevision === revision && state.snapshot) {
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
      if (pendingSaves === 0) set({ saving: false });
    }
  },
  setError(error) {
    set({ error });
  },
  dismissWelcome(fingerprint) {
    set({ dismissedWelcomeFingerprint: fingerprint });
  },
  applyWelcomeState(state) {
    set((current) => {
      if (
        !current.snapshot?.project ||
        !canApplyWelcomeState(current.snapshot, state)
      ) {
        return {};
      }
      return {
        snapshot: {
          ...current.snapshot,
          project: {
            ...current.snapshot.project,
            metadata: {
              ...current.snapshot.project.metadata,
              welcome: state.welcome,
              welcomeFingerprint: state.welcomeFingerprint,
              welcomePending: state.welcomePending,
              welcomeErrors: state.welcomeErrors,
            },
          },
        },
      };
    });
  },
}));

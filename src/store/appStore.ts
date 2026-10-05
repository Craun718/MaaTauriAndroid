import { create } from "zustand";
import {
  bootstrapApp,
  applyPreset as invokeApplyPreset,
  loadProject as invokeLoadProject,
  reinstallResources as invokeReinstallResources,
  saveConfiguration as invokeSaveConfiguration,
  readProjectText,
} from "../lib/api";
import {
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
} from "../lib/language";
import { buildAndroidProject, loadProjectSource } from "../lib/pi";
import type { ProjectSource } from "../lib/pi/rawTypes";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
} from "../lib/types";
import { useNotificationStore } from "./notificationStore";

interface AppStore {
  snapshot?: AppStateSnapshot;
  projectSource?: ProjectSource;
  busy: boolean;
  saving: boolean;
  error?: string;
  dismissedWelcomeFingerprint?: string;
  bootstrap: () => Promise<void>;
  reinstallResources: () => Promise<void>;
  loadProject: (path: string, language?: string) => Promise<void>;
  setProjectLanguage: (language: string) => Promise<void>;
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

/** 串行化配置写入请求：上一笔落盘完成后才发下一笔，响应不会互相超车。 */
let saveQueue: Promise<void> = Promise.resolve();
let pendingSaves = 0;
let configurationRevision = 0;

function revisedSnapshot(snapshot: AppStateSnapshot) {
  configurationRevision += 1;
  return { snapshot, busy: false };
}

function normalizedDirectory(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function interfacePath(snapshot: AppStateSnapshot): string | undefined {
  const projectPath = snapshot.projectPath;
  const project = snapshot.project;
  if (!projectPath || !project) return undefined;

  const root = normalizedDirectory(project.root);
  const path = normalizedDirectory(projectPath);
  if (path === root) return "interface.json";
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(separator + 1);
}

function preferredProjectLanguage(configuration: UserConfiguration): string {
  return projectLanguage(
    resolveLanguage(configuration.uiLanguage, systemLanguageTags()),
  );
}

function preserveResolvedWelcome(
  project: Project,
  backend?: Project,
): Project {
  if (!backend?.metadata) return project;
  return {
    ...project,
    metadata: {
      ...project.metadata,
      welcome: backend.metadata.welcome,
      welcomeFingerprint: backend.metadata.welcomeFingerprint,
      welcomeErrors: backend.metadata.welcomeErrors,
    },
  };
}

async function parseSnapshotProject(
  snapshot: AppStateSnapshot,
): Promise<{ snapshot: AppStateSnapshot; source?: ProjectSource }> {
  const interfacePathValue = interfacePath(snapshot);
  if (!interfacePathValue || !snapshot.project) return { snapshot };

  const readProjectFile = (path: string) => readProjectText(path);
  const source = await loadProjectSource(
    snapshot.project.root,
    readProjectFile,
    interfacePathValue,
  );
  const parsed = await buildAndroidProject(
    source,
    preferredProjectLanguage(snapshot.configuration),
    readProjectFile,
  );
  const project = preserveResolvedWelcome(parsed, snapshot.project);
  return { snapshot: { ...snapshot, project }, source };
}

async function adoptSnapshot(snapshot: AppStateSnapshot) {
  const parsed = await parseSnapshotProject(snapshot);
  set({
    ...revisedSnapshot(parsed.snapshot),
    projectSource: parsed.source,
  });
  return parsed.snapshot;
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
    try {
      await adoptSnapshot(await bootstrapApp());
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async reinstallResources() {
    set({ busy: true, error: undefined });
    try {
      await adoptSnapshot(await invokeReinstallResources());
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async loadProject(path, language) {
    set({ busy: true, error: undefined });
    try {
      await adoptSnapshot(await invokeLoadProject(path, language));
    } catch (error) {
      set({ error: message(error), busy: false });
      reportError(error);
    }
  },
  async setProjectLanguage(language) {
    const current = useAppStore.getState().snapshot;
    const source = useAppStore.getState().projectSource;
    if (!current?.project || !source) return;
    set({ busy: true, error: undefined });
    try {
      const parsed = await buildAndroidProject(source, language, (path) =>
        readProjectText(path),
      );
      const project = preserveResolvedWelcome(parsed, current.project);
      set({ snapshot: { ...current, project }, busy: false });
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
}));

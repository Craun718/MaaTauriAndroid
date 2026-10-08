import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPreset,
  importConfiguration,
  loadProject,
  prepareApp,
  reinstallResources,
  saveConfiguration,
} from "../lib/api";
import {
  buildAndroidProject,
  createStartupProjectTextReader,
  loadProjectSource,
} from "../lib/pi";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
  WelcomeState,
} from "../lib/types";
import {
  canApplyWelcomeState,
  useAppStore,
  waitForPendingSaves,
} from "./appStore";
import { useNotificationStore } from "./notificationStore";

const welcomeEvents = vi.hoisted(() => ({
  handler: undefined as ((event: { payload: unknown }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (_event: unknown, handler: (event: { payload: unknown }) => void) => {
      welcomeEvents.handler = handler;
      return () => undefined;
    },
  ),
}));

vi.mock("../lib/api", () => ({
  applyPreset: vi.fn(),
  importConfiguration: vi.fn(),
  prepareApp: vi.fn(),
  loadProject: vi.fn(),
  reinstallResources: vi.fn(),
  saveConfiguration: vi.fn(),
}));

vi.mock("../lib/pi", () => ({
  buildAndroidProject: vi.fn(),
  loadProjectSource: vi.fn(),
  createStartupProjectTextReader: vi.fn(),
}));

const mockedSaveConfiguration = vi.mocked(saveConfiguration);
const mockedApplyPreset = vi.mocked(applyPreset);
const mockedPrepareApp = vi.mocked(prepareApp);
const mockedLoadProject = vi.mocked(loadProject);
const mockedReinstallResources = vi.mocked(reinstallResources);
const mockedImportConfiguration = vi.mocked(importConfiguration);
const mockedBuildAndroidProject = vi.mocked(buildAndroidProject);
const mockedLoadProjectSource = vi.mocked(loadProjectSource);
const mockedCreateStartupReader = vi.mocked(createStartupProjectTextReader);

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  closeTargetAppAfterRun: false,
  telemetryEnabled: false,
  activeResource: undefined,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

function configurationWith(
  changes: Partial<UserConfiguration>,
): UserConfiguration {
  return { ...configuration, ...changes };
}

function project(label: string): Project {
  return {
    root: "/project",
    name: "fixture",
    label,
  } as Project;
}

function snapshot(projectPath?: string): AppStateSnapshot {
  return {
    configuration: configurationWith({ uiLanguage: "en" }),
    project: project("Rust view"),
    projectPath,
  };
}

function source() {
  return {
    root: "/project",
    document: {},
    languages: [],
    translations: {},
  };
}

function startupReader() {
  return Object.assign(
    vi.fn(async () => "interface text"),
    {
      preloadInterface: vi.fn(async () => undefined),
      preloadMetadata: vi.fn(async () => undefined),
    },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function welcomeState(revision: number): WelcomeState {
  return {
    revision,
    welcome: ["Welcome"],
    welcomePending: false,
    welcomeErrors: [],
  };
}

function emitWelcomeState(payload: WelcomeState) {
  welcomeEvents.handler?.({ payload });
}

describe("appStore importConfiguration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      snapshot: { configuration },
      projectSource: undefined,
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("clears the busy state when the file picker is canceled", async () => {
    const result = { imported: false, snapshot: undefined };
    mockedImportConfiguration.mockResolvedValue(result);

    await expect(useAppStore.getState().importConfiguration()).resolves.toBe(
      result,
    );

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().snapshot?.configuration).toBe(configuration);
  });

  it("adopts the backend snapshot after a successful import", async () => {
    const imported = configurationWith({
      forceStopTargetApp: true,
      telemetryEnabled: true,
    });
    const result = {
      imported: true,
      snapshot: { configuration: imported } satisfies AppStateSnapshot,
    };
    mockedImportConfiguration.mockResolvedValue(result);

    await expect(useAppStore.getState().importConfiguration()).resolves.toBe(
      result,
    );

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBeUndefined();
    expect(useAppStore.getState().snapshot?.configuration).toBe(imported);
  });

  it("exposes an error and rethrows a failed import", async () => {
    mockedImportConfiguration.mockRejectedValue(new Error("Import failed"));

    await expect(useAppStore.getState().importConfiguration()).rejects.toThrow(
      "Import failed",
    );

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBe("Import failed");
  });
});

describe("canApplyWelcomeState", () => {
  it("applies only the event revision represented by the snapshot", () => {
    const snapshot: AppStateSnapshot = {
      configuration,
      welcomeRevision: 3,
    };

    expect(canApplyWelcomeState(snapshot, welcomeState(2))).toBe(false);
    expect(canApplyWelcomeState(snapshot, welcomeState(3))).toBe(true);
    expect(canApplyWelcomeState(snapshot, welcomeState(4))).toBe(false);
  });

  it("keeps accepting snapshots from versions without a welcome revision", () => {
    expect(canApplyWelcomeState(undefined, welcomeState(1))).toBe(true);
    expect(
      canApplyWelcomeState(
        { configuration, welcomeRevision: undefined },
        welcomeState(0),
      ),
    ).toBe(true);
  });
});

describe("appStore saveConfiguration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const snapshot: AppStateSnapshot = { configuration };
    useAppStore.setState({
      snapshot,
      projectSource: undefined,
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("tracks a save without claiming that all app work is blocked", async () => {
    const next = configurationWith({ forceStopTargetApp: true });
    const persisted = configurationWith({ forceStopTargetApp: true });
    const request = deferred<UserConfiguration>();
    mockedSaveConfiguration.mockReturnValue(request.promise);

    const save = useAppStore.getState().saveConfiguration(next);

    expect(useAppStore.getState().saving).toBe(true);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().snapshot?.configuration).toBe(next);

    request.resolve(persisted);
    await save;

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
  });

  it("clears the saving state and reports a failed save", async () => {
    mockedSaveConfiguration.mockRejectedValue(new Error("Save failed"));

    await useAppStore
      .getState()
      .saveConfiguration(configurationWith({ telemetryEnabled: true }));

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBe("Save failed");
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { tone: "error", message: "Save failed" },
    ]);
  });
});

describe("appStore waitForPendingSaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      snapshot: { configuration },
      projectSource: undefined,
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("resolves immediately when no save is queued", async () => {
    await expect(waitForPendingSaves()).resolves.toBeUndefined();
  });

  it("resolves only after the queued save reaches the backend", async () => {
    const request = deferred<UserConfiguration>();
    mockedSaveConfiguration.mockReturnValue(request.promise);

    const save = useAppStore
      .getState()
      .saveConfiguration(configurationWith({ forceStopTargetApp: true }));
    let settled = false;
    const waited = waitForPendingSaves().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const persisted = configurationWith({ forceStopTargetApp: true });
    request.resolve(persisted);
    await waited;
    await save;

    expect(settled).toBe(true);
    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
  });

  it("resolves after a failed save so a start is not blocked forever", async () => {
    mockedSaveConfiguration.mockRejectedValue(new Error("Save failed"));

    const save = useAppStore
      .getState()
      .saveConfiguration(configurationWith({ telemetryEnabled: true }));

    await expect(waitForPendingSaves()).resolves.toBeUndefined();
    await save;

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().error).toBe("Save failed");
  });

  it("waits for an in-flight preset before resolving", async () => {
    const persisted = configurationWith({ telemetryEnabled: true });
    const request = deferred<UserConfiguration>();
    mockedApplyPreset.mockReturnValue(request.promise);

    const applying = useAppStore.getState().applyPreset("daily");
    let settled = false;
    const waited = waitForPendingSaves().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useAppStore.getState().saving).toBe(true);
    expect(useAppStore.getState().busy).toBe(false);

    request.resolve(persisted);
    await waited;
    await applying;

    expect(useAppStore.getState().snapshot?.configuration).toBe(persisted);
    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
  });

  it("keeps a task edit made after a preset request", async () => {
    const presetResult = configurationWith({ telemetryEnabled: true });
    const edited = configurationWith({ forceStopTargetApp: true });
    const savedResult = configurationWith({ forceStopTargetApp: true });
    const applyRequest = deferred<UserConfiguration>();
    const saveRequest = deferred<UserConfiguration>();
    mockedApplyPreset.mockReturnValue(applyRequest.promise);
    mockedSaveConfiguration.mockReturnValue(saveRequest.promise);

    const applying = useAppStore.getState().applyPreset("daily");
    const saving = useAppStore.getState().saveConfiguration(edited);
    applyRequest.resolve(presetResult);
    await applying;

    expect(useAppStore.getState().snapshot?.configuration).toBe(edited);
    expect(useAppStore.getState().saving).toBe(true);

    saveRequest.resolve(savedResult);
    await saving;

    expect(useAppStore.getState().snapshot?.configuration).toBe(savedResult);
    expect(useAppStore.getState().saving).toBe(false);
  });

  it("clears the saving state and reports a failed preset", async () => {
    mockedApplyPreset.mockRejectedValue(new Error("Preset failed"));

    await useAppStore.getState().applyPreset("daily");

    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().error).toBe("Preset failed");
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { tone: "error", message: "Preset failed" },
    ]);
  });
});

describe("appStore WebView Project Interface parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateStartupReader.mockImplementation(() => startupReader());
    useAppStore.setState({
      snapshot: undefined,
      projectSource: undefined,
      bootstrapStatus: "loading",
      busy: false,
      saving: false,
      error: undefined,
      dismissedWelcomeFingerprint: undefined,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("leaves generic busy handling to actions without preparation progress", async () => {
    const request = deferred<AppStateSnapshot>();
    mockedPrepareApp.mockReturnValue(request.promise);

    const bootstrap = useAppStore.getState().bootstrap();
    await Promise.resolve();

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().bootstrapStatus).toBe("loading");

    request.resolve(snapshot());
    await bootstrap;

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().bootstrapStatus).toBe("ready");
  });

  it("parses a bootstrapped project through the scoped reader", async () => {
    const backendSnapshot = snapshot("/project");
    const parsed = project("WebView view");
    const projectSource = source();
    mockedPrepareApp.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(projectSource);
    mockedBuildAndroidProject.mockResolvedValue(parsed);

    await useAppStore.getState().bootstrap();

    expect(mockedLoadProjectSource).toHaveBeenCalledTimes(1);
    const [root, reader, path] = mockedLoadProjectSource.mock.calls[0];
    expect(root).toBe("/project");
    expect(path).toBe("interface.json");
    await expect(reader("interface.json")).resolves.toBe("interface text");
    expect(mockedBuildAndroidProject).toHaveBeenCalledWith(
      projectSource,
      "en_us",
      reader,
    );
    expect(useAppStore.getState().snapshot).toMatchObject({
      project: parsed,
      projectPath: "/project",
    });
    expect(useAppStore.getState().projectSource).toBe(projectSource);
    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().bootstrapStatus).toBe("ready");
  });

  it("uses the basename when a named interface file is loaded", async () => {
    const backendSnapshot = snapshot("/project/custom.json");
    const projectSource = source();
    mockedLoadProject.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(projectSource);
    mockedBuildAndroidProject.mockResolvedValue(project("WebView view"));

    await useAppStore.getState().loadProject("/project/custom.json", "zh_cn");

    expect(mockedLoadProjectSource).toHaveBeenCalledWith(
      "/project",
      expect.any(Function),
      "custom.json",
    );
  });

  it("parses the snapshot returned after reinstalling resources", async () => {
    const backendSnapshot = {
      ...snapshot("/reinstalled-project"),
      project: { ...project("Rust view"), root: "/reinstalled-project" },
    };
    const projectSource = { ...source(), root: "/reinstalled-project" };
    mockedReinstallResources.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(projectSource);
    mockedBuildAndroidProject.mockResolvedValue(project("WebView view"));

    await useAppStore.getState().reinstallResources();

    expect(mockedLoadProjectSource).toHaveBeenCalledWith(
      "/reinstalled-project",
      expect.any(Function),
      "interface.json",
    );
    expect(useAppStore.getState().projectSource).toBe(projectSource);
  });

  it("keeps an embedded desktop project when no project path is present", async () => {
    const backendSnapshot = snapshot();
    mockedPrepareApp.mockResolvedValue(backendSnapshot);

    await useAppStore.getState().bootstrap();

    expect(mockedCreateStartupReader).not.toHaveBeenCalled();
    expect(mockedLoadProjectSource).not.toHaveBeenCalled();
    expect(mockedBuildAndroidProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshot).toBe(backendSnapshot);
    expect(useAppStore.getState().projectSource).toBeUndefined();
  });

  it("rebuilds a cached source without reparsing the interface", async () => {
    const backendSnapshot = snapshot("/project");
    const projectSource = source();
    const english = project("English view");
    const chinese = project("Chinese view");
    mockedPrepareApp.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(projectSource);
    mockedBuildAndroidProject.mockResolvedValueOnce(english);

    await useAppStore.getState().bootstrap();
    mockedLoadProjectSource.mockClear();
    mockedBuildAndroidProject.mockResolvedValueOnce(chinese);

    await useAppStore.getState().setProjectLanguage("zh_cn");

    expect(mockedLoadProjectSource).not.toHaveBeenCalled();
    expect(mockedBuildAndroidProject).toHaveBeenCalledWith(
      projectSource,
      "zh_cn",
      expect.any(Function),
    );
    expect(useAppStore.getState().snapshot?.project).toBe(chinese);
  });

  it("keeps backend-resolved welcome metadata in the WebView view", async () => {
    const backendSnapshot = snapshot("/project");
    const backendProject = backendSnapshot.project;
    if (!backendProject)
      throw new Error("test snapshot must include a project");
    backendProject.metadata = {
      welcome: ["Remote announcement"],
      welcomeFingerprint: "resolved-fingerprint",
      welcomePending: true,
      welcomeErrors: [],
    } as Project["metadata"];
    const parsed = project("WebView view");
    parsed.metadata = {
      welcome: ["https://example.test/announcement.md"],
      welcomeFingerprint: undefined,
      welcomeErrors: [],
    } as Project["metadata"];
    const projectSource = source();
    mockedPrepareApp.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(projectSource);
    mockedBuildAndroidProject.mockResolvedValueOnce(parsed);

    await useAppStore.getState().bootstrap();
    mockedBuildAndroidProject.mockClear();
    mockedBuildAndroidProject.mockResolvedValueOnce({
      ...parsed,
      label: "Chinese view",
    });

    await useAppStore.getState().setProjectLanguage("zh_cn");

    expect(useAppStore.getState().snapshot?.project?.metadata).toMatchObject({
      welcome: ["Remote announcement"],
      welcomeFingerprint: "resolved-fingerprint",
      welcomePending: true,
      welcomeErrors: [],
    });
  });

  it("applies a welcome event that lands before the bootstrap snapshot", async () => {
    const backendSnapshot = snapshot("/project");
    backendSnapshot.welcomeRevision = 1;
    const backendProject = backendSnapshot.project;
    if (!backendProject)
      throw new Error("test snapshot must include a project");
    backendProject.metadata = {
      welcome: [],
      welcomePending: true,
      welcomeErrors: [],
    } as Project["metadata"];
    const parsed = project("WebView view");
    parsed.metadata = {
      welcome: [],
      welcomePending: true,
      welcomeErrors: [],
    } as Project["metadata"];
    mockedPrepareApp.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(source());
    const parsing = deferred<Project>();
    mockedBuildAndroidProject.mockReturnValueOnce(parsing.promise);

    const bootstrapping = useAppStore.getState().bootstrap();
    emitWelcomeState(welcomeState(1));
    parsing.resolve(parsed);
    await bootstrapping;

    const metadata = useAppStore.getState().snapshot?.project?.metadata;
    expect(metadata).toMatchObject({
      welcome: ["Welcome"],
      welcomePending: false,
      welcomeErrors: [],
    });
    expect(metadata?.welcomeFingerprint).toBeUndefined();
  });

  it("drops an early welcome event whose revision no longer matches", async () => {
    const backendSnapshot = snapshot("/project");
    backendSnapshot.welcomeRevision = 2;
    const backendProject = backendSnapshot.project;
    if (!backendProject)
      throw new Error("test snapshot must include a project");
    backendProject.metadata = {
      welcome: [],
      welcomePending: true,
      welcomeErrors: [],
    } as Project["metadata"];
    const parsed = project("WebView view");
    parsed.metadata = {
      welcome: [],
      welcomePending: true,
      welcomeErrors: [],
    } as Project["metadata"];
    mockedPrepareApp.mockResolvedValue(backendSnapshot);
    mockedLoadProjectSource.mockResolvedValue(source());
    const parsing = deferred<Project>();
    mockedBuildAndroidProject.mockReturnValueOnce(parsing.promise);

    const bootstrapping = useAppStore.getState().bootstrap();
    emitWelcomeState(welcomeState(1));
    parsing.resolve(parsed);
    await bootstrapping;

    expect(useAppStore.getState().snapshot?.project?.metadata).toMatchObject({
      welcome: [],
      welcomePending: true,
      welcomeErrors: [],
    });
  });

  it("reports a parser failure and clears busy state", async () => {
    mockedPrepareApp.mockResolvedValue(snapshot("/project"));
    mockedLoadProjectSource.mockRejectedValue(new Error("Parse failed"));

    await useAppStore.getState().bootstrap();

    expect(useAppStore.getState().busy).toBe(false);
    expect(useAppStore.getState().bootstrapStatus).toBe("failed");
    expect(useAppStore.getState().error).toBe("Parse failed");
    expect(useNotificationStore.getState().notifications).toMatchObject([
      { tone: "error", message: "Parse failed" },
    ]);
  });
});

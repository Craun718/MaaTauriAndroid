import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppStateSnapshot } from "../src/lib/types";
import { SettingsPage } from "../src/pages/SettingsPage";
import { useAppStore } from "../src/store/appStore";

const getPrivilegedStatus = vi.fn();
const saveConfiguration = vi.fn();

vi.mock("../src/lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  saveConfiguration: (configuration: unknown) =>
    saveConfiguration(configuration),
  loadProject: vi.fn(),
  clearDiagnosticData: vi.fn(),
  restartApp: vi.fn(async () => undefined),
  getUpdateStatus: vi.fn(async () => undefined),
  checkForUpdate: vi.fn(async () => undefined),
  resolveUpdate: vi.fn(async () => undefined),
  cancelUpdate: vi.fn(async () => undefined),
  installUpdate: vi.fn(async () => undefined),
  getUpdatePrefs: vi.fn(async () => undefined),
  setUpdatePrefs: vi.fn(async () => undefined),
}));

/** A configuration saved before the language field existed has no uiLanguage at all. */
const snapshot: AppStateSnapshot = {
  project: {
    root: "fixture",
    interfaceVersion: 2,
    name: "maa_tauri_android_fixture",
    label: "MaaTauriAndroid Fixture",
    language: "en_us",
    languages: ["en_us"],
    controllers: [{ name: "Android", label: "Android", controllerType: "Adb" }],
    resources: [
      {
        name: "base",
        label: "Base",
        paths: ["resource/base"],
        controllers: [],
        options: [],
      },
    ],
    groups: [],
    tasks: [],
    options: {},
    globalOptions: [],
    presets: [],
    metadata: { welcome: [] },
  },
  configuration: {
    schemaVersion: 1,
    initialized: true,
    forceStopTargetApp: false,
    closeTargetAppAfterRun: false,
    telemetryEnabled: false,
    globalOptionValues: {},
    controllerOptionValues: {},
    resourceOptionValues: {},
    runConfigurations: [],
  },
};

function withDeviceLocale(tag: string, run: () => void) {
  Object.defineProperty(window.navigator, "language", {
    value: tag,
    configurable: true,
  });
  try {
    run();
  } finally {
    delete (window.navigator as { language?: string }).language;
  }
}

describe("language switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ snapshot, busy: false, error: undefined });
    getPrivilegedStatus.mockResolvedValue({
      message: "Connected",
      setupRequired: [],
    });
    saveConfiguration.mockImplementation(
      async (configuration: unknown) => configuration,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("follows a non-Chinese device when no choice is stored", () => {
    withDeviceLocale("en-US", () => {
      render(<SettingsPage />);
      expect(
        screen.getByRole("heading", { name: "Settings" }),
      ).toBeInTheDocument();
    });
  });

  it("follows a Chinese device when no choice is stored", () => {
    withDeviceLocale("zh-Hans-CN", () => {
      render(<SettingsPage />);
      expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    });
  });

  it("renders the stored choice instead of the device language", () => {
    withDeviceLocale("en-US", () => {
      useAppStore.setState({
        snapshot: {
          ...snapshot,
          configuration: { ...snapshot.configuration, uiLanguage: "zh" },
        },
      });
      render(<SettingsPage />);
      expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "删除日志" }),
      ).toBeInTheDocument();
    });
  });

  it("persists a new choice and switches the interface over", async () => {
    withDeviceLocale("en-US", () => {
      render(<SettingsPage />);
      fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
        target: { value: "zh" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() =>
      expect(useAppStore.getState().snapshot?.configuration.uiLanguage).toBe(
        "zh",
      ),
    );
    expect(saveConfiguration).toHaveBeenCalledTimes(1);
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({
      uiLanguage: "zh",
    });
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });
});

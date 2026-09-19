import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationHost } from "../components/ui/NotificationHost";
import type {
  AppStateSnapshot,
  Project,
  UserConfiguration,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { SettingsPage } from "./SettingsPage";

const getPrivilegedStatus = vi.fn();
const saveConfiguration = vi.fn();
const exportLogs = vi.fn();

vi.mock("../lib/api", () => ({
  getPrivilegedStatus: () => getPrivilegedStatus(),
  requestPrivilegedAccess: vi.fn(),
  openShizuku: vi.fn(),
  saveConfiguration: (configuration: unknown) =>
    saveConfiguration(configuration),
  loadProject: vi.fn(),
  clearDiagnosticData: vi.fn(),
  exportLogs: () => exportLogs(),
}));

const project: Project = {
  root: "/fixtures",
  interfaceVersion: 2,
  name: "fixture",
  label: "Fixture",
  language: "en_us",
  languages: ["en_us"],
  controllers: [
    { name: "Android", label: "Android", controllerType: "AndroidNative" },
  ],
  resources: [
    {
      name: "resource-a",
      label: "Resource A",
      description: "Base **resource**",
      paths: ["resource/base"],
      controllers: [],
      options: ["resolution"],
    },
    {
      name: "resource-b",
      label: "Resource B",
      paths: ["resource/alt"],
      controllers: [],
      options: [],
    },
  ],
  groups: [],
  tasks: [],
  options: {
    resolution: {
      kind: "select",
      name: "resolution",
      label: "Resolution",
      description: "**分辨率**说明",
      cases: [
        {
          name: "720p",
          label: "720p",
          description: "**720** 说明",
          options: [],
        },
        { name: "1080p", label: "1080p", options: [] },
      ],
      applicability: { controllers: [], resources: [] },
    },
  },
  globalOptions: [],
  presets: [],
  metadata: {
    welcome: [],
    telemetry: {
      dsn: "https://key@sentry.test/1",
      tracing: true,
      tracesSampleRate: 1,
      failureAttachmentsSampleRate: 1,
    },
  },
};

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  telemetryEnabled: false,
  activeResource: undefined,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

const projectWithoutTelemetry: Project = {
  ...project,
  metadata: { ...project.metadata, telemetry: undefined },
};

beforeEach(() => {
  vi.clearAllMocks();
  const snapshot: AppStateSnapshot = { project, configuration };
  useAppStore.setState({ snapshot, busy: false, error: undefined });
  useNotificationStore.setState({ notifications: [] });
  getPrivilegedStatus.mockResolvedValue({
    message: "Connected",
    setupRequired: [],
  });
  saveConfiguration.mockImplementation(async (next: unknown) => next);
});

function renderSettingsPage() {
  return render(
    <>
      <NotificationHost />
      <SettingsPage />
    </>,
  );
}

describe("project scope in settings", () => {
  it("keeps resource options without the directory and resource summary cards", () => {
    renderSettingsPage();

    expect(
      screen.getByRole("heading", { name: "Resource options" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Resource" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Project directory" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Project directory" }),
    ).not.toBeInTheDocument();
  });

  it("saves a resource option change", async () => {
    renderSettingsPage();

    fireEvent.click(screen.getByRole("radio", { name: "1080p" }));

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({
      resourceOptionValues: {
        "resource-a": { resolution: { type: "single", case: "1080p" } },
      },
    });
  });

  it("renders resource, option and case descriptions as rich text", () => {
    renderSettingsPage();

    expect(screen.getByText("分辨率").tagName).toBe("STRONG");
    expect(screen.getByText("720").tagName).toBe("STRONG");
    expect(screen.getByRole("radio", { name: /720p/ })).toBeInTheDocument();
  });

  it("exports logs from the diagnostics card", async () => {
    exportLogs.mockResolvedValue({
      path: "/cache/maa_tauri_android-logs-1.zip",
      fileName: "maa_tauri_android-logs-1.zip",
    });
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Logs exported to Downloads: maa_tauri_android-logs-1.zip",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("shows successful run cleanup as a notification", async () => {
    const { clearDiagnosticData } = await import("../lib/api");
    vi.mocked(clearDiagnosticData).mockResolvedValue({
      deletedRunCount: 3,
      runsDir: "/data/user/0/app/runs",
    });
    window.confirm = vi.fn(() => true);
    renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete runs" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deleted 3 run directories",
    );
  });

  it("hides telemetry consent when the interface does not declare it", () => {
    useAppStore.setState({
      snapshot: { project: projectWithoutTelemetry, configuration },
    });
    renderSettingsPage();

    expect(
      screen.queryByRole("heading", { name: "Anonymous telemetry" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /allow anonymous telemetry/i }),
    ).not.toBeInTheDocument();
  });

  it("persists the telemetry consent choice", async () => {
    renderSettingsPage();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /allow anonymous telemetry/i }),
    );

    await waitFor(() => expect(saveConfiguration).toHaveBeenCalledTimes(1));
    expect(saveConfiguration.mock.calls[0][0]).toMatchObject({
      telemetryEnabled: true,
    });
  });
});

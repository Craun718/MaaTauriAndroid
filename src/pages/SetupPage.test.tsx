import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SetupPage } from "./SetupPage";
import { useAppStore } from "../store/appStore";
import type { AppStateSnapshot, Project, UserConfiguration } from "../lib/types";

const project: Project = {
  root: "/fixtures",
  interfaceVersion: 2,
  name: "fixture",
  label: "Fixture",
  language: "en_us",
  languages: ["en_us"],
  controllers: [
    { name: "adb", label: "ADB", controllerType: "Adb" },
  ],
  resources: [
    {
      name: "resource-a",
      label: "Resource A",
      paths: ["resource/base"],
      controllers: [],
      options: [],
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
  options: {},
  globalOptions: [],
  presets: [],
  metadata: { welcome: [] },
};

const configuration: UserConfiguration = {
  schemaVersion: 1,
  initialized: true,
  forceStopTargetApp: false,
  activeController: "adb",
  activeResource: undefined,
  globalOptionValues: {},
  controllerOptionValues: {},
  resourceOptionValues: {},
  runConfigurations: [],
};

beforeEach(() => {
  const snapshot: AppStateSnapshot = { project, configuration };
  const saveConfiguration = vi.fn(() => Promise.resolve());
  useAppStore.setState({ snapshot, saveConfiguration });
});

test("does not save resource selection from clicks", () => {
  render(<SetupPage />);

  fireEvent.click(screen.getByText("Resource A"));

  expect(screen.queryByText("Resource B")).not.toBeInTheDocument();
  expect(useAppStore.getState().saveConfiguration).not.toHaveBeenCalled();
});

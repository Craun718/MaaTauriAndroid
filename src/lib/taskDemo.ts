import type { MessageKey } from "./i18n";
import { applyTaskEdit, type TaskEdit } from "./taskEditing";
import type { Project, UserConfiguration } from "./types";

type DemoText = (key: MessageKey) => string;
export function createTaskDemo(t: DemoText): {
  project: Project;
  configuration: UserConfiguration;
} {
  const applicability = { controllers: [], resources: [] };
  const project: Project = {
    root: "",
    interfaceVersion: 2,
    name: "task-demo",
    label: t("demoTitle"),
    language: "en_us",
    languages: ["en_us", "zh_cn"],
    controllers: [
      { name: "Android", label: "Android", controllerType: "AndroidNative" },
    ],
    resources: [
      {
        name: "demo",
        label: t("demoResource"),
        paths: [],
        controllers: [],
        options: [],
      },
    ],
    groups: [],
    settingSections: [],
    pretasks: [],
    globalOptions: [],
    presets: [],
    metadata: { welcome: [] },
    tasks: [
      {
        name: "first",
        label: t("demoTaskFirst"),
        description: t("demoTaskDescription"),
        entry: "",
        groups: [],
        controllers: [],
        resources: [],
        options: ["enabled", "mode"],
        defaultCheck: false,
      },
      {
        name: "second",
        label: t("demoTaskSecond"),
        entry: "",
        groups: [],
        controllers: [],
        resources: [],
        options: [],
        defaultCheck: true,
      },
    ],
    options: {
      enabled: {
        kind: "switch",
        name: "enabled",
        label: t("demoOptionSwitch"),
        defaultCase: "No",
        cases: [
          { name: "No", label: t("demoOff"), options: [] },
          { name: "Yes", label: t("demoOn"), options: [] },
        ],
        applicability,
      },
      mode: {
        kind: "select",
        name: "mode",
        label: t("demoOptionMode"),
        defaultCase: "normal",
        cases: [
          { name: "normal", label: t("demoModeNormal"), options: [] },
          { name: "fast", label: t("demoModeFast"), options: [] },
        ],
        applicability,
      },
    },
  };
  return {
    project,
    configuration: {
      schemaVersion: 1,
      initialized: true,
      forceStopTargetApp: false,
      closeTargetAppAfterRun: false,
      telemetryEnabled: false,
      pretaskValues: {},
      globalOptionValues: {},
      controllerOptionValues: {},
      resourceOptionValues: {},
      activeResource: "demo",
      activeRunConfigurationId: "demo-a",
      runConfigurations: [
        {
          id: "demo-a",
          name: t("demoConfigurationA"),
          tasks: [
            {
              instanceId: "demo-first",
              taskName: "first",
              enabled: false,
              optionValues: {},
            },
            {
              instanceId: "demo-second",
              taskName: "second",
              enabled: true,
              optionValues: {},
            },
          ],
        },
        { id: "demo-b", name: t("demoConfigurationB"), tasks: [] },
      ],
    },
  };
}

export const DEMO_STEP_KEYS = [
  "demoEnableStep",
  "demoOptionsStep",
  "demoReorderStep",
  "demoConfigurationStep",
] as const;
export function taskDemoStepComplete(
  step: number,
  configuration: UserConfiguration,
): boolean {
  const tasks = configuration.runConfigurations.find(
    (run) => run.id === "demo-a",
  )?.tasks;
  const first = tasks?.find((task) => task.instanceId === "demo-first");
  switch (step) {
    case 0:
      return first?.enabled === true;
    case 1:
      return (
        first?.optionValues.enabled?.type === "single" &&
        first.optionValues.enabled.case === "Yes" &&
        first.optionValues.mode?.type === "single" &&
        first.optionValues.mode.case === "fast"
      );
    case 2:
      return (
        tasks?.[0]?.instanceId === "demo-second" &&
        tasks?.[1]?.instanceId === "demo-first"
      );
    case 3:
      return configuration.activeRunConfigurationId === "demo-b";
    default:
      return false;
  }
}

/** No persistence or execution dependency can be supplied to demo edits. */
export function editTaskDemo(
  configuration: UserConfiguration,
  edit: TaskEdit,
): UserConfiguration {
  return applyTaskEdit(configuration, edit);
}

import type {
  ConfiguredTask,
  ControllerDefinition,
  OptionDefinition,
  OptionValue,
  Project,
  ResourceDefinition,
  TaskDefinition,
  UserConfiguration,
} from "./types";

export function isApplicable(
  option: OptionDefinition,
  controller?: ControllerDefinition,
  resource?: ResourceDefinition,
) {
  if (!controller || !resource) return false;
  const { controllers, resources } = option.applicability;
  const controllerMatches =
    controllers.length === 0 || controllers.includes(controller.name);
  const resourceMatches = resources.length === 0 || resources.includes(resource.name);
  return controllerMatches && resourceMatches;
}

export function defaultOptionValue(
  option: OptionDefinition,
  existing?: OptionValue,
): OptionValue {
  if (existing) return existing;
  if (option.kind === "checkbox") {
    return { type: "multiple", cases: option.defaultCases };
  }
  if (option.kind === "input" || option.kind === "hotkey") {
    const fields = option.kind === "input" ? option.inputs : option.hotkeys;
    const values = Object.fromEntries(
      fields.map((field) => [field.name, field.default ?? ""]),
    );
    return { type: "inputs", values };
  }
  const fallback = option.cases[0]?.name ?? "";
  return { type: "single", case: option.defaultCase ?? fallback };
}

export function configuredTask(
  configuration: UserConfiguration,
  task: TaskDefinition,
): ConfiguredTask {
  const activeId = configuration.activeRunConfigurationId;
  const run = configuration.runConfigurations.find((item) => item.id === activeId);
  return (
    run?.tasks.find((item) => item.taskName === task.name) ?? {
      instanceId: `${task.name}:new`,
      taskName: task.name,
      enabled: task.defaultCheck,
      optionValues: {},
    }
  );
}

export function activeRun(configuration: UserConfiguration) {
  return configuration.runConfigurations.find(
    (item) => item.id === configuration.activeRunConfigurationId,
  );
}

export function projectOption(project: Project | undefined, name: string) {
  return project?.options[name];
}

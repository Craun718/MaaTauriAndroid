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

/**
 * The case spellings the PI protocol defines for a switch: "Yes"/"yes"/"Y"/"y"
 * and "No"/"no"/"N"/"n". The longer forms are what the other clients accept on
 * top of that, and cost nothing here.
 */
const SWITCH_ON_NAMES = new Set(["yes", "y", "on", "true", "enable"]);
const SWITCH_OFF_NAMES = new Set(["no", "n", "off", "false", "disable"]);

export interface SwitchCases {
  on: string;
  off: string;
}

/**
 * The on/off case *names* of a switch, or undefined when this is not a
 * two-state switch.
 *
 * The protocol defines `switch` as exactly two cases, one recognised as Yes and
 * one as No, which is what lets it render as a single boolean control rather
 * than a two-item menu. A project declaring a third case, or names that cannot
 * be placed on either side, gives no way to tell which way round it goes, so
 * callers fall back to listing the cases instead of guessing.
 *
 * Which case is "on" comes from its name and never from its position: M9A
 * declares No first in 13 of its 35 switches.
 */
export function switchCases(option: OptionDefinition): SwitchCases | undefined {
  if (option.kind !== "switch" || option.cases.length !== 2) return undefined;
  const on = option.cases.find((item) => SWITCH_ON_NAMES.has(item.name.toLowerCase()));
  const off = option.cases.find((item) => SWITCH_OFF_NAMES.has(item.name.toLowerCase()));
  if (!on || !off) return undefined;
  return { on: on.name, off: off.name };
}

function caseOptions(option: OptionDefinition, caseName: string): string[] {
  if (option.kind === "input" || option.kind === "hotkey") return [];
  return option.cases.find((item) => item.name === caseName)?.options ?? [];
}

/**
 * The cases the option currently has selected. Derived from the *effective*
 * value, so an unset option reports what the resolver would actually use: a
 * select without `default_case` falls back to its first case there too, and a
 * checkbox without `default_case` selects nothing.
 */
export function selectedCaseNames(
  option: OptionDefinition,
  value?: OptionValue,
): string[] {
  const effective = defaultOptionValue(option, value);
  if (effective.type === "multiple") return effective.cases;
  if (effective.type === "single") return effective.case ? [effective.case] : [];
  return [];
}

export interface VisibleOption {
  name: string;
  /** 0 for an option the task/list declares, 1+ for options owned by a case. */
  depth: number;
}

/**
 * Flattens a list of option names into what should be rendered, in order.
 *
 * An option's cases can declare further options (`case.option`); those are only
 * in effect while that case is selected, and they are not listed anywhere else
 * — neither the task nor the resource declares them. So the list has to be
 * rebuilt from the currently selected cases rather than filtered, which is what
 * this does, depth-first: each option is followed by the options of the cases
 * it has selected.
 *
 * Names passed in that belong to a selected case are dropped as roots and
 * rendered under their parent instead, so they cannot show up twice. A name
 * reachable through several parents is rendered once, at the first parent that
 * reaches it. Names without a definition are ignored, and a cycle — which the
 * resolver rejects at run time — terminates here instead of recursing forever.
 */
export function visibleOptions(
  definitions: Record<string, OptionDefinition>,
  names: string[],
  values: Record<string, OptionValue> = {},
): VisibleOption[] {
  const roots = names.filter((name) => definitions[name]);
  const owned = new Set<string>();
  for (const name of roots) {
    const option = definitions[name];
    for (const caseName of selectedCaseNames(option, values[name])) {
      for (const child of caseOptions(option, caseName)) owned.add(child);
    }
  }

  const result: VisibleOption[] = [];
  const seen = new Set<string>();
  const emit = (name: string, depth: number) => {
    const option = definitions[name];
    if (!option || seen.has(name)) return;
    seen.add(name);
    result.push({ name, depth });
    for (const caseName of selectedCaseNames(option, values[name])) {
      for (const child of caseOptions(option, caseName)) emit(child, depth + 1);
    }
  };
  for (const name of roots) {
    if (!owned.has(name)) emit(name, 0);
  }
  // A case that owns its own ancestor makes every root "owned", which would
  // render nothing at all. The resolver refuses to run such a project, but the
  // list still has to show something; `emit` is a no-op for anything the walk
  // above already placed.
  for (const name of roots) emit(name, 0);
  return result;
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

export function activeResource(
  project: Project,
  configuration: UserConfiguration,
): ResourceDefinition | undefined {
  return (
    project.resources.find((resource) => resource.name === configuration.activeResource) ??
    project.resources[0]
  );
}

/**
 * The controller the app runs. Android only ever drives its native control unit,
 * so the platform — not the user — decides this, and the loader reports exactly
 * one entry. Tasks and options still reference it by the name the project
 * declared, which is why the name lives on the project rather than in the
 * configuration.
 */
export function activeController(project: Project): ControllerDefinition | undefined {
  return project.controllers[0];
}

export function projectOption(project: Project | undefined, name: string) {
  return project?.options[name];
}

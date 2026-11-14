import type { VisibleOption } from "./options";
import { activeResource, isApplicable, visibleOptions } from "./options";
import type { PretaskDefinition, Project, UserConfiguration } from "./types";

export function availablePretasks(
  project: Project,
  configuration: UserConfiguration,
): PretaskDefinition[] {
  const controller = project.controllers[0];
  const resource = activeResource(project, configuration);
  if (!controller || !resource) return [];
  return project.pretasks.filter(
    (task) =>
      (task.controllers.length === 0 ||
        task.controllers.includes(controller.name)) &&
      (task.resources.length === 0 || task.resources.includes(resource.name)),
  );
}

export function pretaskVisibleOptions(
  project: Project,
  configuration: UserConfiguration,
  task: PretaskDefinition,
): VisibleOption[] {
  const definitions = Object.fromEntries(
    Object.entries(project.options).filter(([, option]) =>
      isApplicable(
        option,
        project.controllers[0],
        activeResource(project, configuration),
      ),
    ),
  );
  return visibleOptions(
    definitions,
    task.options,
    configuration.pretaskValues[task.name]?.optionValues,
  );
}

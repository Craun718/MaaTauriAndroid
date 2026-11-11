import type { ConfiguredTask, OptionValue, UserConfiguration } from "./types";

export type TaskEdit =
  | { kind: "selectConfiguration"; id: string }
  | { kind: "selectResource"; name: string }
  | { kind: "createConfiguration"; id: string; name: string }
  | { kind: "add"; runId: string; task: ConfiguredTask }
  | { kind: "remove"; runId: string; instanceId: string }
  | {
      kind: "patch";
      runId: string;
      instanceId: string;
      patch: Partial<Pick<ConfiguredTask, "enabled" | "customLabel">>;
    }
  | {
      kind: "option";
      runId: string;
      instanceId: string;
      name: string;
      value: OptionValue;
    }
  | { kind: "reorder"; runId: string; from: string; to: string };

/** Immutable edits are shared by the persisted page and the in-memory tutorial. */
export function applyTaskEdit(
  configuration: UserConfiguration,
  edit: TaskEdit,
): UserConfiguration {
  const next = structuredClone(configuration);
  if (edit.kind === "selectConfiguration") {
    if (!next.runConfigurations.some((run) => run.id === edit.id))
      return configuration;
    next.activeRunConfigurationId = edit.id;
  } else if (edit.kind === "selectResource") {
    next.activeResource = edit.name;
  } else if (edit.kind === "createConfiguration") {
    if (!edit.id || next.runConfigurations.some((run) => run.id === edit.id))
      return configuration;
    next.runConfigurations.push({ id: edit.id, name: edit.name, tasks: [] });
    next.activeRunConfigurationId = edit.id;
  } else {
    const run = next.runConfigurations.find((item) => item.id === edit.runId);
    if (!run) return configuration;
    if (edit.kind === "add") {
      if (
        !edit.task.instanceId ||
        run.tasks.some((task) => task.instanceId === edit.task.instanceId)
      )
        return configuration;
      run.tasks.push(structuredClone(edit.task));
    } else if (edit.kind === "reorder") {
      const from = run.tasks.findIndex((task) => task.instanceId === edit.from);
      const to = run.tasks.findIndex((task) => task.instanceId === edit.to);
      if (from < 0 || to < 0 || from === to) return configuration;
      const [task] = run.tasks.splice(from, 1);
      run.tasks.splice(to, 0, task);
    } else {
      const task = run.tasks.find(
        (item) => item.instanceId === edit.instanceId,
      );
      if (!task) return configuration;
      if (edit.kind === "remove")
        run.tasks = run.tasks.filter((item) => item !== task);
      else if (edit.kind === "patch") Object.assign(task, edit.patch);
      else task.optionValues[edit.name] = structuredClone(edit.value);
    }
  }
  return next;
}

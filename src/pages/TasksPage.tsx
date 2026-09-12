import { OptionEditor } from "../components/OptionEditor";
import { RunPanel } from "../components/RunPanel";
import { EmptyProject } from "../components/EmptyProject";
import { Checkbox } from "../components/ui/Checkbox";
import { useTranslation } from "../lib/i18n";
import { activeController, activeResource, defaultOptionValue } from "../lib/options";
import { useAppStore } from "../store/appStore";
import type { ConfiguredTask, OptionDefinition, OptionValue } from "../lib/types";

export function TasksPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const applyPreset = useAppStore((state) => state.applyPreset);
  const { t } = useTranslation();
  if (!snapshot?.project) return <EmptyProject />;
  const { project, configuration } = snapshot;
  const resource = activeResource(project, configuration);
  const controller = activeController(project);
  const activeRun = configuration.runConfigurations.find(
    (run) => run.id === configuration.activeRunConfigurationId,
  );

  function updateTasks(tasks: ConfiguredTask[]) {
    const next = structuredClone(configuration);
    const run = next.runConfigurations.find(
      (item) => item.id === next.activeRunConfigurationId,
    );
    if (!run) return;
    run.tasks = tasks;
    void saveConfiguration(next);
  }

  function ensureTask(taskName: string): ConfiguredTask {
    const task = project.tasks.find((item) => item.name === taskName);
    const existing = activeRun?.tasks.find((item) => item.taskName === taskName);
    if (!task) throw new Error(`Unknown task: ${taskName}`);
    return existing ?? {
      instanceId: `${taskName}:${Date.now()}`,
      taskName,
      enabled: task.defaultCheck,
      optionValues: {},
    };
  }

  function setTask(taskName: string, mutate: (task: ConfiguredTask) => ConfiguredTask) {
    const task = mutate(ensureTask(taskName));
    const other = activeRun?.tasks.filter((item) => item.taskName !== taskName) ?? [];
    updateTasks([...other, task].sort((left, right) => left.taskName.localeCompare(right.taskName)));
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("tasksAndRun")}</h1>
      <RunPanel />
      {project.presets.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("presets")}</h2>
          <div className="flex flex-wrap gap-2">
            {project.presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => void applyPreset(preset.name)}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-medium"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-medium">{activeRun?.name ?? t("defaultRunName")}</h2>
        {project.tasks.map((task) => {
          const configured = ensureTask(task.name);
          const unavailable =
            (task.controllers.length > 0 &&
              !task.controllers.includes(controller?.name ?? "")) ||
            (task.resources.length > 0 &&
              !task.resources.includes(resource?.name ?? ""));
          return (
            <article
              key={task.name}
              className={`rounded-lg border p-4 ${
                unavailable
                  ? "border-[var(--border)] bg-[var(--surface-muted)] opacity-60"
                  : "border-[var(--border)] bg-[var(--surface-raised)]"
              }`}
            >
              <div className="flex min-h-11 items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{configured.customLabel ?? task.label}</h3>
                  {task.description && (
                    <p className="text-sm text-[var(--text-muted)]">{task.description}</p>
                  )}
                </div>
                <Checkbox
                  className="h-11 gap-2 text-sm"
                  checked={configured.enabled}
                  disabled={unavailable}
                  onCheckedChange={(next) =>
                    setTask(task.name, (item) => ({ ...item, enabled: next }))
                  }
                >
                  {t("toggleOn")}
                </Checkbox>
              </div>
              {unavailable && (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  {t("requiresOtherController")}
                </p>
              )}
              {!unavailable && task.options.length > 0 && (
                <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
                  {visibleOptions(project.options, task.options).map((name) => {
                    const option = project.options[name];
                    if (!option) return null;
                    return (
                      <OptionEditor
                        key={name}
                        option={option}
                        value={defaultOptionValue(option, configured.optionValues[name])}
                        onChange={(value) =>
                          setTask(task.name, (item) => ({
                            ...item,
                            optionValues: { ...item.optionValues, [name]: value },
                          }))
                        }
                      />
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function selectedCaseNames(option: OptionDefinition, value?: OptionValue) {
  if (option.kind === "checkbox") {
    return value?.type === "multiple" ? value.cases : option.defaultCases;
  }
  if (option.kind === "select" || option.kind === "switch") {
    return [value?.type === "single" ? value.case : option.defaultCase ?? ""];
  }
  return [];
}

function visibleOptions(
  definitions: Record<string, OptionDefinition>,
  names: string[],
) {
  const selectedChildren = new Set<string>();
  for (const name of names) {
    const option = definitions[name];
    if (!option) continue;
    for (const caseName of selectedCaseNames(option, undefined)) {
      const selected = option.kind === "checkbox" || option.kind === "select" || option.kind === "switch"
        ? option.cases.find((item) => item.name === caseName)
        : undefined;
      selected?.options.forEach((child) => selectedChildren.add(child));
    }
  }
  return names.filter((name) => !selectedChildren.has(name));
}

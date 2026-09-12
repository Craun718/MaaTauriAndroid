import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown } from "lucide-react";
import { OptionEditor } from "../components/OptionEditor";
import { RunPanel } from "../components/RunPanel";
import { EmptyProject } from "../components/EmptyProject";
import { RichDescription } from "../components/RichDescription";
import { VirtualDisplayCard } from "../components/VirtualDisplayCard";
import { Checkbox } from "../components/ui/Checkbox";
import { useTranslation } from "../lib/i18n";
import {
  activeController,
  activeResource,
  defaultOptionValue,
  visibleOptions,
} from "../lib/options";
import { useAppStore } from "../store/appStore";
import type { ConfiguredTask, TaskDefinition } from "../lib/types";

interface FocusNotice {
  channel: string;
  messageType: string;
  name?: string;
  message: string;
}

export function TasksPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const applyPreset = useAppStore((state) => state.applyPreset);
  const { t } = useTranslation();
  const [focusToast, setFocusToast] = useState<FocusNotice>();
  const [focusNotice, setFocusNotice] = useState<FocusNotice>();

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const subscribe = (event: string, apply: (payload: FocusNotice) => void) => {
      listen<FocusNotice>(event, (notification) => apply(notification.payload))
        .then((stop) => {
          if (disposed) stop();
          else unsubscribers.push(stop);
        })
        .catch(() => undefined);
    };
    subscribe("focus-toast", (payload) => {
      setFocusToast(payload);
      window.setTimeout(() => setFocusToast(undefined), 4000);
    });
    subscribe("focus-notify", (payload) => setFocusNotice(payload));
    return () => {
      disposed = true;
      unsubscribers.forEach((stop) => stop());
    };
  }, []);

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

  const declaredGroups = project.groups
    .map((group) => ({
      group,
      tasks: project.tasks.filter((task) => task.groups.includes(group.name)),
    }))
    .filter((entry) => entry.tasks.length > 0);
  const ungroupedTasks = project.tasks.filter(
    (task) => !project.groups.some((group) => task.groups.includes(group.name)),
  );
  const hasGroups = declaredGroups.length > 0;

  function renderTask(task: TaskDefinition) {
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
            <RichDescription text={task.description} />
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
            {visibleOptions(project.options, task.options, configured.optionValues).map(
              ({ name, depth }) => {
                const option = project.options[name];
                if (!option) return null;
                return (
                  <div
                    key={name}
                    className={
                      depth > 0 ? "border-l-2 border-[var(--border)] pl-3" : undefined
                    }
                  >
                    <OptionEditor
                      option={option}
                      value={defaultOptionValue(option, configured.optionValues[name])}
                      onChange={(value) =>
                        setTask(task.name, (item) => ({
                          ...item,
                          optionValues: { ...item.optionValues, [name]: value },
                        }))
                      }
                    />
                  </div>
                );
              },
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("tasksAndRun")}</h1>
      <VirtualDisplayCard />
      <RunPanel />
      {project.presets.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("presets")}</h2>
          <div className="flex flex-wrap gap-3">
            {project.presets.map((preset) => (
              <div key={preset.name} className="flex w-56 flex-col items-start gap-1">
                <button
                  type="button"
                  onClick={() => void applyPreset(preset.name)}
                  className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-medium"
                >
                  {preset.label}
                </button>
                <RichDescription text={preset.description} />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-medium">{activeRun?.name ?? t("defaultRunName")}</h2>
        {hasGroups ? (
          <div className="space-y-2">
            {declaredGroups.map(({ group, tasks }) => (
              <TaskGroupSection
                key={group.name}
                label={group.label}
                description={group.description}
                defaultExpand={group.defaultExpand}
              >
                {tasks.map(renderTask)}
              </TaskGroupSection>
            ))}
            {ungroupedTasks.length > 0 && (
              <TaskGroupSection label={t("ungroupedTasks")} defaultExpand>
                {ungroupedTasks.map(renderTask)}
              </TaskGroupSection>
            )}
          </div>
        ) : (
          project.tasks.map(renderTask)
        )}
      </section>
      {focusToast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-50 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-lg"
        >
          <p className="text-sm">
            {focusToast.name ? `${focusToast.name}: ${focusToast.message}` : focusToast.message}
          </p>
        </div>
      )}
      {focusNotice && (
        <div
          role="alertdialog"
          aria-modal="false"
          className="fixed inset-x-4 bottom-24 z-50 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-lg"
        >
          <p className="text-sm">
            {focusNotice.name
              ? `${focusNotice.name}: ${focusNotice.message}`
              : focusNotice.message}
          </p>
          <button
            type="button"
            onClick={() => setFocusNotice(undefined)}
            className="mt-3 h-10 w-full rounded-md bg-[var(--accent)] font-semibold text-white"
          >
            {t("focusDismiss")}
          </button>
        </div>
      )}
    </div>
  );
}

function TaskGroupSection({
  label,
  description,
  defaultExpand,
  children,
}: {
  label: string;
  description?: string;
  defaultExpand: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpand);
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-left font-medium"
      >
        {label}
        <ChevronDown
          size={18}
          className={`shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded && (
        <div className="space-y-3">
          <RichDescription text={description} />
          {children}
        </div>
      )}
    </div>
  );
}

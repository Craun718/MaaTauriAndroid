import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown } from "lucide-react";
import { OptionEditor } from "../components/OptionEditor";
import { RunPanel } from "../components/RunPanel";
import { EmptyProject } from "../components/EmptyProject";
import { RichDescription } from "../components/RichDescription";
import { VirtualDisplayCard } from "../components/VirtualDisplayCard";
import { Checkbox } from "../components/ui/Checkbox";
import { Select } from "../components/ui/Select";
import { Tabs } from "../components/ui/Tabs";
import { useTranslation } from "../lib/i18n";
import {
  activeController,
  activeResource,
  defaultOptionValue,
  visibleOptions,
} from "../lib/options";
import { useAppStore } from "../store/appStore";
import type {
  ConfiguredTask,
  ConfigurationTemplate,
  OptionValue,
  Project,
  TaskDefinition,
} from "../lib/types";

interface FocusNotice {
  channel: string;
  messageType: string;
  name?: string;
  message: string;
}

/** 未分组任务的固定标签值，避免与 interface 声明的分组名冲突。 */
const UNGROUPED_TAB = "__ungrouped__";

export function TasksPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const saveConfiguration = useAppStore((state) => state.saveConfiguration);
  const applyPreset = useAppStore((state) => state.applyPreset);
  const { t } = useTranslation();
  const [focusToast, setFocusToast] = useState<FocusNotice>();
  const [focusNotice, setFocusNotice] = useState<FocusNotice>();
  const [selectedPreset, setSelectedPreset] = useState<string>();

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
    // 从 store 取最新快照而不是渲染闭包里的旧 configuration：
    // 连续勾选多个任务时，闭包值落后于 store，会把先勾的那笔覆盖回旧状态。
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = structuredClone(latest.configuration);
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
    return (
      <TaskItem
        key={task.name}
        task={task}
        project={project}
        controllerName={controller?.name ?? ""}
        resourceName={resource?.name ?? ""}
        configured={configured}
        onEnabledChange={(next) =>
          setTask(task.name, (item) => ({ ...item, enabled: next }))
        }
        onOptionValueChange={(name, value) =>
          setTask(task.name, (item) => ({
            ...item,
            optionValues: { ...item.optionValues, [name]: value },
          }))
        }
      />
    );
  }

  /** 任务分类标签页：声明的分组各占一页，未分组的任务归入最后一页。 */
  const tabItems = [
    ...declaredGroups.map(({ group, tasks }) => ({
      value: group.name,
      label: group.label,
      content: (
        <div className="space-y-3">
          <RichDescription text={group.description} />
          {tasks.map(renderTask)}
        </div>
      ),
    })),
    ...(ungroupedTasks.length > 0
      ? [{
          value: UNGROUPED_TAB,
          label: t("ungroupedTasks"),
          content: <div className="space-y-3">{ungroupedTasks.map(renderTask)}</div>,
        }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">{t("tasksAndRun")}</h1>
      <VirtualDisplayCard />
      <RunPanel />
      {project.presets.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("presets")}</h2>
          <PresetPicker
            presets={project.presets}
            value={selectedPreset}
            onValueChange={setSelectedPreset}
            onApply={(name) => void applyPreset(name)}
            applyLabel={t("applyPreset")}
          />
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-medium">{activeRun?.name ?? t("defaultRunName")}</h2>
        {hasGroups ? (
          <Tabs items={tabItems} ariaLabel={t("taskCategories")} />
        ) : (
          <div className="space-y-3">{project.tasks.map(renderTask)}</div>
        )}
      </section>
      {focusToast && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-50 rounded-lg border border-line bg-raised p-4 shadow-lg"
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
          className="fixed inset-x-4 bottom-24 z-50 rounded-lg border border-line bg-raised p-4 shadow-lg"
        >
          <p className="text-sm">
            {focusNotice.name
              ? `${focusNotice.name}: ${focusNotice.message}`
              : focusNotice.message}
          </p>
          <button
            type="button"
            onClick={() => setFocusNotice(undefined)}
            className="mt-3 h-10 w-full rounded-md bg-accent font-semibold text-white"
          >
            {t("focusDismiss")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 预设选择器：下拉框选预设，右侧「启用」按钮套用。选中项的描述随选择切换。
 * `value` 不匹配任何预设（如项目刚加载）时回落到第一个预设。
 */
function PresetPicker({
  presets,
  value,
  onValueChange,
  onApply,
  applyLabel,
}: {
  presets: ConfigurationTemplate[];
  value?: string;
  onValueChange: (name: string) => void;
  onApply: (name: string) => void;
  applyLabel: string;
}) {
  const active = presets.find((preset) => preset.name === value) ?? presets[0];
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          className="min-w-0 flex-1"
          labelledBy="preset-select-label"
          items={presets.map((preset) => ({ value: preset.name, label: preset.label }))}
          value={active.name}
          onValueChange={onValueChange}
        />
        <button
          type="button"
          onClick={() => onApply(active.name)}
          className="h-11 shrink-0 rounded-md bg-accent px-4 text-sm font-semibold text-white"
        >
          {applyLabel}
        </button>
      </div>
      <RichDescription text={active.description} />
    </div>
  );
}

interface TaskItemProps {
  task: TaskDefinition;
  project: Project;
  controllerName: string;
  resourceName: string;
  configured: ConfiguredTask;
  onEnabledChange: (next: boolean) => void;
  onOptionValueChange: (name: string, value: OptionValue) => void;
}

/**
 * 单个任务卡片：标题与启用开关常驻，详情（说明与选项）收进下拉，
 * 点击标题展开。没有说明也没有选项的任务不渲染下拉箭头。
 */
function TaskItem({
  task,
  project,
  controllerName,
  resourceName,
  configured,
  onEnabledChange,
  onOptionValueChange,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const unavailable =
    (task.controllers.length > 0 && !task.controllers.includes(controllerName)) ||
    (task.resources.length > 0 && !task.resources.includes(resourceName));
  const options = unavailable
    ? []
    : visibleOptions(project.options, task.options, configured.optionValues);
  const hasDetails = Boolean(task.description) || options.length > 0;
  const label = configured.customLabel ?? task.label;

  return (
    <article
      className={`rounded-lg border p-4 ${
        unavailable
          ? "border-line bg-surface-muted opacity-60"
          : "border-line bg-raised"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        {hasDetails ? (
          <h3 className="flex min-h-11 flex-1 items-center font-medium">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="flex min-h-11 flex-1 items-center gap-2 text-left"
            >
              {label}
              <ChevronDown
                size={18}
                className={`shrink-0 text-ink-muted transition-transform ${
                  expanded ? "" : "-rotate-90"
                }`}
              />
            </button>
          </h3>
        ) : (
          <h3 className="font-medium">{label}</h3>
        )}
        <Checkbox
          className="h-11 gap-2 text-sm"
          checked={configured.enabled}
          disabled={unavailable}
          onCheckedChange={onEnabledChange}
        >
          {t("toggleOn")}
        </Checkbox>
      </div>
      {unavailable && (
        <p className="mt-2 text-sm text-ink-muted">
          {t("requiresOtherController")}
        </p>
      )}
      {expanded && hasDetails && (
        <div className="mt-3 space-y-4 border-t border-line pt-4">
          <RichDescription text={task.description} />
          {options.map(({ name, depth }) => {
            const option = project.options[name];
            if (!option) return null;
            return (
              <div
                key={name}
                className={
                  depth > 0 ? "border-l-2 border-line pl-3" : undefined
                }
              >
                <OptionEditor
                  option={option}
                  value={defaultOptionValue(option, configured.optionValues[name])}
                  onChange={(value) => onOptionValueChange(name, value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

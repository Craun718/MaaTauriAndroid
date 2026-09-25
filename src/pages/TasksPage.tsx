import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { listen } from "@tauri-apps/api/event";
import { Eye, GripVertical, Plus, SquarePen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyProject } from "../components/EmptyProject";
import { OptionEditor } from "../components/OptionEditor";
import { RichDescription } from "../components/RichDescription";
import {
  type RunActivityTab,
  RunActivityTabs,
} from "../components/RunActivityTabs";
import { RunPanel } from "../components/RunPanel";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { Tabs } from "../components/ui/Tabs";
import { TextField } from "../components/ui/TextField";
import { VirtualDisplayCard } from "../components/VirtualDisplayCard";
import { isNotificationGranted } from "../lib/api";
import { focusNoticePresentation } from "../lib/focusNotifications";
import { useTranslation } from "../lib/i18n";
import {
  activeController,
  activeResource,
  defaultOptionValue,
  optionValueSummary,
  visibleOptions,
} from "../lib/options";
import type {
  ConfigurationTemplate,
  ConfiguredTask,
  OptionValue,
  Project,
  ResourceDefinition,
  RunConfiguration,
  TaskDefinition,
} from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useNotificationStore } from "../store/notificationStore";
import { useRunLogStore } from "../store/runLogStore";

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
  const [focusNotice, setFocusNotice] = useState<FocusNotice>();
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const [activityTab, setActivityTab] = useState<RunActivityTab>("tasks");
  const [runActive, setRunActive] = useState(false);
  const notify = useNotificationStore((state) => state.notify);
  const resetRunLog = useRunLogStore((state) => state.resetRunLog);

  useEffect(() => {
    let disposed = false;
    const unsubscribers: Array<() => void> = [];
    const subscribe = (
      event: string,
      apply: (payload: FocusNotice) => void,
    ) => {
      listen<FocusNotice>(event, (notification) => apply(notification.payload))
        .then((stop) => {
          if (disposed) stop();
          else unsubscribers.push(stop);
        })
        .catch(() => undefined);
    };
    subscribe("focus-toast", (payload) => {
      notify(
        payload.name ? `${payload.name}: ${payload.message}` : payload.message,
      );
    });
    subscribe("focus-notify", (payload) => {
      void (async () => {
        const notificationsAllowed =
          payload.channel === "notification"
            ? await isNotificationGranted()
            : false;
        if (
          focusNoticePresentation(payload.channel, notificationsAllowed) ===
          "card"
        ) {
          setFocusNotice(payload);
        }
      })();
    });
    return () => {
      disposed = true;
      unsubscribers.forEach((stop) => {
        stop();
      });
    };
  }, [notify]);

  // Must stay above the early return below: React requires every hook to run on
  // every render, otherwise the hook count changes when `project` is missing.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  if (!snapshot?.project) return <EmptyProject />;
  const { project, configuration } = snapshot;
  const resource = activeResource(project, configuration);
  const controller = activeController(project);
  const activeRun: RunConfiguration | undefined =
    configuration.runConfigurations.find(
      (run) => run.id === configuration.activeRunConfigurationId,
    );

  function mutateActiveRun(mutate: (run: RunConfiguration) => void) {
    if (runActive) return;
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = structuredClone(latest.configuration);
    const run = next.runConfigurations.find(
      (item) => item.id === next.activeRunConfigurationId,
    );
    if (!run) return;
    mutate(run);
    void saveConfiguration(next);
  }

  function updateTask(
    instanceId: string,
    mutate: (task: ConfiguredTask) => ConfiguredTask,
  ) {
    mutateActiveRun((run) => {
      run.tasks = run.tasks.map((task) =>
        task.instanceId === instanceId ? mutate(task) : task,
      );
    });
  }

  function addTask(taskDef: TaskDefinition) {
    mutateActiveRun((run) => {
      run.tasks.push({
        instanceId: `${taskDef.name}:${Date.now()}`,
        taskName: taskDef.name,
        enabled: taskDef.defaultCheck,
        optionValues: {},
        customLabel: undefined,
      });
    });
  }

  function removeTask(instanceId: string) {
    mutateActiveRun((run) => {
      run.tasks = run.tasks.filter((task) => task.instanceId !== instanceId);
    });
  }

  function reorderTasks(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    mutateActiveRun((run) => {
      const oldIndex = run.tasks.findIndex(
        (item) => item.instanceId === active.id,
      );
      const newIndex = run.tasks.findIndex(
        (item) => item.instanceId === over.id,
      );
      if (oldIndex < 0 || newIndex < 0) return;
      run.tasks = arrayMove(run.tasks, oldIndex, newIndex);
    });
  }

  function switchConfiguration(id: string) {
    if (runActive) return;
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = structuredClone(latest.configuration);
    next.activeRunConfigurationId = id;
    void saveConfiguration(next);
  }

  function switchResource(name: string) {
    if (runActive) return;
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = structuredClone(latest.configuration);
    next.activeResource = name;
    void saveConfiguration(next);
  }

  function createConfiguration() {
    if (runActive) return;
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = structuredClone(latest.configuration);
    const id = crypto.randomUUID();
    const count = next.runConfigurations.length;
    next.runConfigurations.push({
      id,
      name: t("configurationLabel", { n: count + 1 }),
      tasks: [],
    });
    next.activeRunConfigurationId = id;
    void saveConfiguration(next);
  }

  function renderConfiguredTask(configured: ConfiguredTask) {
    const task = project.tasks.find(
      (item) => item.name === configured.taskName,
    );
    if (!task) return null;
    return (
      <SortableTaskItem
        key={configured.instanceId}
        instanceId={configured.instanceId}
        task={task}
        project={project}
        controllerName={controller?.name ?? ""}
        resourceName={resource?.name ?? ""}
        configured={configured}
        onEnabledChange={(next) =>
          updateTask(configured.instanceId, (item) => ({
            ...item,
            enabled: next,
          }))
        }
        onOptionValueChange={(name, value) =>
          updateTask(configured.instanceId, (item) => ({
            ...item,
            optionValues: { ...item.optionValues, [name]: value },
          }))
        }
        locked={runActive}
        onLabelChange={(customLabel) =>
          updateTask(configured.instanceId, (item) => ({
            ...item,
            customLabel,
          }))
        }
        onRemove={() => removeTask(configured.instanceId)}
      />
    );
  }

  const availableTasks = project.tasks.filter(
    (task) => !activeRun?.tasks.some((item) => item.taskName === task.name),
  );
  const configTabItems = configuration.runConfigurations.map((run) => ({
    value: run.id,
    label: run.name,
    content: null,
  }));

  return (
    <div
      className={`flex flex-col gap-3${
        activityTab === "logs" ? " min-h-0 flex-1 overflow-hidden" : ""
      }`}
    >
      <h1 className="text-xl font-semibold">{t("tasksAndRun")}</h1>
      <VirtualDisplayCard />
      <RunPanel
        onRunStarted={() => {
          resetRunLog();
          setActivityTab("logs");
        }}
        onRunActiveChange={setRunActive}
      />
      <RunActivityTabs
        activeTab={activityTab}
        onActiveTabChange={setActivityTab}
        taskList={
          <div className="space-y-3">
            {runActive && (
              <p className="text-sm text-ink-muted">{t("taskConfigLocked")}</p>
            )}
            <ResourcePicker
              resources={project.resources}
              value={resource?.name}
              onValueChange={switchResource}
              disabled={runActive}
            />
            {project.presets.length > 0 && (
              <section className="space-y-2">
                <h2 className="font-medium">{t("presets")}</h2>
                <PresetPicker
                  presets={project.presets}
                  value={selectedPreset}
                  onValueChange={setSelectedPreset}
                  onApply={(name) => void applyPreset(name)}
                  applyLabel={t("applyPreset")}
                  disabled={runActive}
                />
              </section>
            )}
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Tabs
                    items={configTabItems}
                    value={activeRun?.id}
                    onValueChange={switchConfiguration}
                    disabled={runActive}
                    ariaLabel={t("tasksAndRun")}
                  />
                </div>
                <button
                  type="button"
                  onClick={createConfiguration}
                  aria-label={t("newConfiguration")}
                  disabled={runActive}
                  className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <Plus size="1rem" />
                </button>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={reorderTasks}
              >
                <SortableContext
                  items={activeRun?.tasks.map((task) => task.instanceId) ?? []}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1 rounded-lg border border-line bg-surface-muted p-2">
                    {activeRun?.tasks.map(renderConfiguredTask)}
                  </div>
                </SortableContext>
              </DndContext>
              <AddTaskPicker
                available={availableTasks}
                onAdd={addTask}
                addLabel={t("addTask")}
                emptyLabel={t("noTasksToAdd")}
                disabled={runActive}
              />
            </section>
          </div>
        }
      />
      {focusNotice && (
        <div
          role="alertdialog"
          aria-modal="false"
          className="fixed inset-x-4 bottom-[calc(6rem_+_var(--tt-safe-bottom))] z-50 rounded-lg border border-line bg-raised p-3 shadow-lg"
        >
          <p className="text-sm">
            {focusNotice.name
              ? `${focusNotice.name}: ${focusNotice.message}`
              : focusNotice.message}
          </p>
          <button
            type="button"
            onClick={() => setFocusNotice(undefined)}
            className="mt-2 h-8 w-full rounded-md bg-accent font-semibold text-white"
          >
            {t("focusDismiss")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 资源（游戏服务器）选择器。切换后任务可用性、资源选项和运行时加载的
 * resource bundle 都以该资源为准。
 */
function ResourcePicker({
  resources,
  value,
  onValueChange,
  disabled = false,
}: {
  resources: ResourceDefinition[];
  value?: string;
  onValueChange: (name: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const active =
    resources.find((resource) => resource.name === value) ?? resources[0];
  if (!active) return null;
  return (
    <section className="space-y-2">
      <h2 id="resource-select-label" className="font-medium">
        {t("resource")}
      </h2>
      <Select
        labelledBy="resource-select-label"
        items={resources.map((resource) => ({
          value: resource.name,
          label: resource.label,
        }))}
        value={active.name}
        onValueChange={onValueChange}
        disabled={disabled}
      />
      <RichDescription text={active.description} />
    </section>
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
  disabled = false,
}: {
  presets: ConfigurationTemplate[];
  value?: string;
  onValueChange: (name: string) => void;
  onApply: (name: string) => void;
  applyLabel: string;
  disabled?: boolean;
}) {
  const active = presets.find((preset) => preset.name === value) ?? presets[0];
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Select
          className="min-w-0 flex-1"
          inputClassName="text-sm"
          compact
          labelledBy="preset-select-label"
          items={presets.map((preset) => ({
            value: preset.name,
            label: preset.label,
          }))}
          value={active.name}
          onValueChange={onValueChange}
        />
        <button
          type="button"
          onClick={() => onApply(active.name)}
          disabled={disabled}
          className="h-9 shrink-0 rounded-md bg-accent px-2.5 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-50"
        >
          {applyLabel}
        </button>
      </div>
      <RichDescription text={active.description} />
    </div>
  );
}

/** 内联「添加任务」面板：点开后列出尚未添加的任务定义，点击即追加到运行列表末尾。 */
function AddTaskPicker({
  available,
  onAdd,
  addLabel,
  emptyLabel,
  disabled = false,
}: {
  available: TaskDefinition[];
  onAdd: (task: TaskDefinition) => void;
  addLabel: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          if (!disabled) setOpen((value) => !value);
        }}
        aria-expanded={open}
        disabled={disabled}
        className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <Plus size="0.875rem" />
        {addLabel}
      </button>
      {!disabled && open && (
        <div className="space-y-1 rounded-lg border border-line bg-surface-muted p-2">
          {available.length === 0 ? (
            <p className="px-2 py-1 text-sm text-ink-muted">{emptyLabel}</p>
          ) : (
            available.map((task) => (
              <button
                key={task.name}
                type="button"
                onClick={() => onAdd(task)}
                className="flex h-9 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-sm transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {task.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 包装 TaskItem 加上 @dnd-kit/sortable 的拖拽排序行为。 */
function SortableTaskItem(
  props: Omit<TaskItemProps, "dragHandleProps"> & { instanceId: string },
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.instanceId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "relative z-10" : undefined}
    >
      <TaskItem {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

interface TaskItemProps {
  task: TaskDefinition;
  project: Project;
  controllerName: string;
  resourceName: string;
  configured: ConfiguredTask;
  /** 运行中：任务配置只读，只能查看详情。 */
  locked?: boolean;
  onEnabledChange: (next: boolean) => void;
  onOptionValueChange: (name: string, value: OptionValue) => void;
  onLabelChange: (label: string | undefined) => void;
  onRemove: () => void;
  dragHandleProps?: Record<string, unknown>;
}

/** 单个任务卡片：标题与启用开关常驻，重命名、说明与选项收进模态框。 */
function TaskItem({
  task,
  project,
  controllerName,
  resourceName,
  configured,
  locked = false,
  onEnabledChange,
  onOptionValueChange,
  onLabelChange,
  onRemove,
  dragHandleProps,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const unavailable =
    (task.controllers.length > 0 &&
      !task.controllers.includes(controllerName)) ||
    (task.resources.length > 0 && !task.resources.includes(resourceName));
  const options = unavailable
    ? []
    : visibleOptions(project.options, task.options, configured.optionValues);
  const label = configured.customLabel ?? task.label;
  const [labelDraft, setLabelDraft] = useState(label);

  useEffect(() => {
    if (detailsOpen) setLabelDraft(label);
  }, [detailsOpen, label]);

  function commitLabel() {
    const normalized = labelDraft.trim();
    const customLabel =
      normalized && normalized !== task.label ? normalized : undefined;
    setLabelDraft(customLabel ?? task.label);
    if (customLabel !== configured.customLabel) onLabelChange(customLabel);
  }

  function closeDetails() {
    commitLabel();
    setDetailsOpen(false);
  }

  return (
    <>
      <article
        className={`rounded-lg border p-2 text-xs ${
          unavailable
            ? "border-line bg-surface-muted opacity-60"
            : "border-line bg-raised"
        }`}
      >
        <div className="flex items-center gap-1">
          {!locked && (
            <button
              type="button"
              aria-label={t("dragReorder")}
              className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-ink-muted active:cursor-grabbing"
              {...dragHandleProps}
            >
              <GripVertical size="0.875rem" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <h3 className="flex min-h-7 min-w-0 flex-1 items-center font-medium">
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
              </span>
            </h3>
            <button
              type="button"
              aria-label={t("openTaskDetails", { task: label })}
              aria-haspopup="dialog"
              onClick={() => setDetailsOpen(true)}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {locked ? <Eye size="0.875rem" /> : <SquarePen size="0.875rem" />}
            </button>
            <Checkbox
              className="h-7 shrink-0 gap-1.5 text-xs"
              checked={configured.enabled}
              disabled={unavailable || locked}
              onCheckedChange={onEnabledChange}
            >
              {t("toggleOn")}
            </Checkbox>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("removeTask")}
            disabled={locked}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
          >
            <Trash2 size="0.875rem" />
          </button>
        </div>
        {unavailable && (
          <p className="mt-2 text-xs text-ink-muted">
            {t("requiresOtherController")}
          </p>
        )}
      </article>
      <Modal open={detailsOpen} onClose={closeDetails} title={label}>
        {locked ? (
          <>
            <p className="text-sm text-ink-muted">
              {t("taskName")}: <span className="text-ink">{label}</span>
            </p>
            {options.map(({ name, depth }) => {
              const option = project.options[name];
              if (!option) return null;
              return (
                <div
                  key={name}
                  className={
                    depth > 0 ? "border-l-2 border-line pl-2" : undefined
                  }
                >
                  {optionValueSummary(
                    option,
                    configured.optionValues[name],
                  ).map((row) => (
                    <div key={row.label} className="space-y-0.5">
                      <p className="text-sm font-medium">{row.label}</p>
                      {row.detail && (
                        <p className="text-sm text-ink-muted">{row.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            <RichDescription text={task.description} />
          </>
        ) : (
          <>
            <TextField
              compact
              label={t("taskName")}
              value={labelDraft}
              onValueChange={setLabelDraft}
              onBlur={commitLabel}
            />
            {options.map(({ name, depth }) => {
              const option = project.options[name];
              if (!option) return null;
              return (
                <div
                  key={name}
                  className={
                    depth > 0 ? "border-l-2 border-line pl-2" : undefined
                  }
                >
                  <OptionEditor
                    option={option}
                    compact
                    value={defaultOptionValue(
                      option,
                      configured.optionValues[name],
                    )}
                    onChange={(value) => onOptionValueChange(name, value)}
                  />
                </div>
              );
            })}
            <RichDescription text={task.description} />
          </>
        )}
      </Modal>
    </>
  );
}

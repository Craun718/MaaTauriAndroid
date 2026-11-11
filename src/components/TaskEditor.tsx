import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, GripVertical, Play, Plus, SquarePen, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";
import {
  activeController,
  activeResource,
  defaultOptionValue,
  optionValueSummary,
  visibleOptions,
} from "../lib/options";
import type { TaskEdit } from "../lib/taskEditing";
import type {
  ConfigurationTemplate,
  ConfiguredTask,
  OptionValue,
  Project,
  ResourceDefinition,
  TaskDefinition,
  UserConfiguration,
} from "../lib/types";
import { useLongPress } from "../lib/useLongPress";
import { OptionEditor } from "./OptionEditor";
import { RichDescription } from "./RichDescription";
import { Checkbox } from "./ui/Checkbox";
import { Modal } from "./ui/Modal";
import { Select } from "./ui/Select";
import { Tabs } from "./ui/Tabs";
import { TextField } from "./ui/TextField";

export interface TaskActionTarget {
  runConfigurationId: string;
  instanceId: string;
  label: string;
}

export function TaskEditor({
  project,
  configuration,
  locked = false,
  onEdit,
  onApplyPreset,
  onOpenActions,
}: {
  project: Project;
  configuration: UserConfiguration;
  locked?: boolean;
  onEdit: (edit: TaskEdit) => void;
  onApplyPreset?: (name: string) => void;
  onOpenActions?: (target: TaskActionTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [selectedPreset, setSelectedPreset] = useState<string>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const resource = activeResource(project, configuration);
  const controller = activeController(project);
  const activeRun = configuration.runConfigurations.find(
    (run) => run.id === configuration.activeRunConfigurationId,
  );
  const runId = activeRun?.id ?? "";
  function emit(edit: TaskEdit): void {
    if (!locked) onEdit(edit);
  }
  function reorderTasks(event: DragEndEvent): void {
    if (event.over)
      emit({
        kind: "reorder",
        runId,
        from: String(event.active.id),
        to: String(event.over.id),
      });
  }
  return (
    <div className="space-y-3">
      {locked && (
        <p className="text-sm text-ink-muted">{t("taskConfigLocked")}</p>
      )}
      <ResourcePicker
        resources={project.resources}
        value={resource?.name}
        disabled={locked}
        onValueChange={(name) => emit({ kind: "selectResource", name })}
      />
      {project.presets.length > 0 && onApplyPreset && (
        <section className="space-y-2">
          <h2 className="font-medium">{t("presets")}</h2>
          <PresetPicker
            presets={project.presets}
            value={selectedPreset}
            onValueChange={setSelectedPreset}
            onApply={onApplyPreset}
            applyLabel={t("applyPreset")}
            disabled={locked}
          />
        </section>
      )}
      <section className="space-y-2">
        <div
          className="flex items-center gap-2"
          data-guide-target="tasks-configurations"
        >
          <div className="min-w-0 flex-1">
            <Tabs
              items={configuration.runConfigurations.map((run) => ({
                value: run.id,
                label: run.name,
                content: null,
              }))}
              value={activeRun?.id}
              onValueChange={(id) => emit({ kind: "selectConfiguration", id })}
              disabled={locked}
              ariaLabel={t("tasksAndRun")}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              emit({
                kind: "createConfiguration",
                id: crypto.randomUUID(),
                name: t("configurationLabel", {
                  n: configuration.runConfigurations.length + 1,
                }),
              })
            }
            aria-label={t("newConfiguration")}
            disabled={locked}
            className="btn btn-square btn-sm"
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
            <div className="space-y-1 rounded-lg border border-line bg-card-muted p-2">
              {activeRun?.tasks.map((configured) => {
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
                    locked={locked}
                    onEnabledChange={(enabled) =>
                      emit({
                        kind: "patch",
                        runId,
                        instanceId: configured.instanceId,
                        patch: { enabled },
                      })
                    }
                    onOptionValueChange={(name, value) =>
                      emit({
                        kind: "option",
                        runId,
                        instanceId: configured.instanceId,
                        name,
                        value,
                      })
                    }
                    onLabelChange={(customLabel) =>
                      emit({
                        kind: "patch",
                        runId,
                        instanceId: configured.instanceId,
                        patch: { customLabel },
                      })
                    }
                    onRemove={() =>
                      emit({
                        kind: "remove",
                        runId,
                        instanceId: configured.instanceId,
                      })
                    }
                    onOpenActions={
                      onOpenActions
                        ? () =>
                            onOpenActions({
                              runConfigurationId: runId,
                              instanceId: configured.instanceId,
                              label: configured.customLabel ?? task.label,
                            })
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        <AddTaskPicker
          available={project.tasks}
          onAdd={(task) =>
            emit({
              kind: "add",
              runId,
              task: {
                instanceId: crypto.randomUUID(),
                taskName: task.name,
                enabled: task.defaultCheck,
                optionValues: {},
              },
            })
          }
          addLabel={t("addTask")}
          disabled={locked}
        />
      </section>
    </div>
  );
}

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
    <section className="space-y-2" data-guide-target="tasks-resource">
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

/** 内联「添加任务」面板：选中任务后追加到运行列表末尾并收起面板。 */
function AddTaskPicker({
  available,
  onAdd,
  addLabel,
  disabled = false,
}: {
  available: TaskDefinition[];
  onAdd: (task: TaskDefinition) => void;
  addLabel: string;
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
        <div className="space-y-1 rounded-lg border border-line bg-card-muted p-2">
          {available.map((task) => (
            <button
              key={task.name}
              type="button"
              onClick={() => {
                onAdd(task);
                setOpen(false);
              }}
              className="flex h-9 w-full cursor-pointer items-center rounded-md px-2.5 text-left text-sm transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {task.label}
            </button>
          ))}
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
  onOpenActions?: () => void;
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
  onOpenActions,
  dragHandleProps,
}: TaskItemProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const unavailable =
    (task.controllers.length > 0 &&
      !task.controllers.includes(controllerName)) ||
    (task.resources.length > 0 && !task.resources.includes(resourceName));
  const options = unavailable
    ? []
    : visibleOptions(project.options, task.options, configured.optionValues);
  const label = configured.customLabel ?? task.label;
  const actionsDisabled =
    locked || unavailable || !configured.enabled || !onOpenActions;
  const longPress = useLongPress({
    onLongPress: () => onOpenActions?.(),
    disabled: actionsDisabled,
  });
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

  function confirmRemove() {
    setRemoveConfirmOpen(false);
    onRemove();
  }

  function openActions() {
    closeDetails();
    onOpenActions?.();
  }

  return (
    <>
      <article
        {...longPress}
        className={`select-none touch-pan-y rounded-lg border p-2 text-xs ${
          unavailable
            ? "border-line bg-card-muted opacity-60"
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
          </div>
          <button
            type="button"
            onClick={() => setRemoveConfirmOpen(true)}
            aria-label={t("removeTask")}
            aria-haspopup="dialog"
            disabled={locked}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
          >
            <Trash2 size="0.875rem" />
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
        {unavailable && (
          <p className="mt-2 text-xs text-ink-muted">
            {t("requiresOtherController")}
          </p>
        )}
      </article>
      <Modal open={detailsOpen} onClose={closeDetails} title={label}>
        <div className="space-y-1 px-2 pb-2">
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
              {!actionsDisabled && (
                <button
                  type="button"
                  onClick={openActions}
                  className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-accent text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <Play size="1rem" />
                  {t("taskOperations")}
                </button>
              )}
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
        </div>
      </Modal>
      <Modal
        open={removeConfirmOpen}
        onClose={() => setRemoveConfirmOpen(false)}
        title={t("removeTaskConfirmTitle")}
      >
        <p className="text-sm">
          {t("removeTaskConfirmWarning", { task: label })}
        </p>
        <p className="text-xs text-ink-muted">{t("removeTaskConfirmHint")}</p>
        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={confirmRemove}
            className="h-10 min-w-20 rounded-md border border-red-500/50 px-3 font-medium text-red-600 dark:text-red-300"
          >
            {t("confirm")}
          </button>
          <button
            type="button"
            onClick={() => setRemoveConfirmOpen(false)}
            className="h-10 min-w-20 rounded-md border border-line px-3"
          >
            {t("cancel")}
          </button>
        </div>
      </Modal>
    </>
  );
}

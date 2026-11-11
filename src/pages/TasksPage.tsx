import { listen } from "@tauri-apps/api/event";
import { FastForward, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyProject } from "../components/EmptyProject";
import {
  type RunActivityTab,
  RunActivityTabs,
} from "../components/RunActivityTabs";
import type { RunPanelHandle } from "../components/RunPanel";
import { RunPanel } from "../components/RunPanel";
import { type TaskActionTarget, TaskEditor } from "../components/TaskEditor";
import { Modal } from "../components/ui/Modal";
import { VirtualDisplayCard } from "../components/VirtualDisplayCard";
import { isNotificationGranted } from "../lib/api";
import { focusNoticePresentation } from "../lib/focusNotifications";
import { useTranslation } from "../lib/i18n";
import { applyTaskEdit, type TaskEdit } from "../lib/taskEditing";
import type { TaskRunSelectionMode } from "../lib/types";
import { useAppStore } from "../store/appStore";
import { useGuideStore } from "../store/guideStore";
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
  const [activityTab, setActivityTab] = useState<RunActivityTab>("tasks");
  const guideActive = useGuideStore((state) => state.active);
  const guideTarget = useGuideStore((state) => state.target);
  const [runActive, setRunActive] = useState(false);
  const [taskAction, setTaskAction] = useState<TaskActionTarget>();
  const runPanelRef = useRef<RunPanelHandle>(null);
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

  useEffect(() => {
    if (runActive) setTaskAction(undefined);
  }, [runActive]);

  useEffect(() => {
    if (guideActive && guideTarget?.startsWith("tasks-")) {
      setActivityTab(guideTarget === "tasks-activities" ? "logs" : "tasks");
    }
  }, [guideActive, guideTarget]);

  if (!snapshot?.project) return <EmptyProject />;
  const { project, configuration } = snapshot;

  function editTasks(edit: TaskEdit): void {
    if (runActive) return;
    if (edit.kind === "selectConfiguration") setTaskAction(undefined);
    const latest = useAppStore.getState().snapshot;
    if (!latest?.project) return;
    const next = applyTaskEdit(latest.configuration, edit);
    if (next !== latest.configuration) void saveConfiguration(next);
  }

  return (
    <div
      className={`flex flex-col gap-card-gap ${
        // 日志激活时根容器撑满 <main> 的 content box；与底部 nav 的间隙由
        // AppShell 的 pb 统一提供，这里不再另加 padding。
        activityTab === "logs" ? "min-h-0 flex-1 overflow-hidden" : ""
      }`}
    >
      <h1 className="text-xl font-semibold">{t("tasksAndRun")}</h1>
      {!configuration.foregroundMode && (
        <VirtualDisplayCard running={runActive} />
      )}
      <RunPanel
        ref={runPanelRef}
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
          <TaskEditor
            project={project}
            configuration={configuration}
            locked={runActive}
            onEdit={editTasks}
            onApplyPreset={(name) => void applyPreset(name)}
            onOpenActions={setTaskAction}
          />
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
      <TaskActionsModal
        target={taskAction}
        onClose={() => setTaskAction(undefined)}
        onStart={(mode) => {
          const target = taskAction;
          setTaskAction(undefined);
          if (!target) return;
          void runPanelRef.current?.start({
            runConfigurationId: target.runConfigurationId,
            instanceId: target.instanceId,
            mode,
          });
        }}
      />
    </div>
  );
}

function TaskActionsModal({
  target,
  onClose,
  onStart,
}: {
  target: TaskActionTarget | undefined;
  onClose: () => void;
  onStart: (mode: TaskRunSelectionMode) => void;
}) {
  const { t } = useTranslation();
  if (!target) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("taskActionsTitle", { task: target.label })}
      panelClassName="bg-surface/82 backdrop-blur"
    >
      <button
        type="button"
        onClick={() => onStart("current")}
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <Play size="1rem" />
        {t("runCurrentTask")}
      </button>
      <button
        type="button"
        onClick={() => onStart("currentAndFollowing")}
        className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm font-semibold transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <FastForward size="1rem" />
        {t("runCurrentAndFollowingTasks")}
      </button>
    </Modal>
  );
}

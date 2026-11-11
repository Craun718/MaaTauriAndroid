import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../lib/i18n";
import {
  createTaskDemo,
  DEMO_STEP_KEYS,
  editTaskDemo,
  taskDemoStepComplete,
} from "../lib/taskDemo";
import { TaskEditor } from "./TaskEditor";

export function TaskDemo({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const demo = useMemo(() => createTaskDemo(t), [t]);
  const [configuration, setConfiguration] = useState(() => demo.configuration);
  const [step, setStep] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={t("demoTitle")}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex flex-col bg-surface pt-[var(--tt-safe-top)] pb-[var(--tt-safe-bottom)] outline-none"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-3 p-4">
        <header className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t("demoTitle")}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDone}
          >
            {t("guideSkip")}
          </button>
        </header>
        <p className="text-sm text-ink-muted">{t("demoIsolated")}</p>
        <p
          className="rounded-lg border border-primary bg-base-100 p-3 text-sm"
          role="status"
        >
          {t(DEMO_STEP_KEYS[step])}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskEditor
            project={demo.project}
            configuration={configuration}
            onEdit={(edit) =>
              setConfiguration((current) => editTaskDemo(current, edit))
            }
          />
        </div>
        <footer className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">
            {step + 1} / {DEMO_STEP_KEYS.length}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!taskDemoStepComplete(step, configuration)}
            onClick={() => {
              if (step === DEMO_STEP_KEYS.length - 1) onDone();
              else setStep((current) => current + 1);
            }}
          >
            {t(step === DEMO_STEP_KEYS.length - 1 ? "guideDone" : "guideNext")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

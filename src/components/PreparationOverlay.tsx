import {
  AlertTriangle,
  ArchiveRestore,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { type MessageKey, useTranslation } from "../lib/i18n";
import { useAppStore } from "../store/appStore";
import { usePreparationStore } from "../store/preparationStore";

const STAGE_KEYS: Record<string, MessageKey> = {
  checkingInstallation: "preparationStageCheckingInstallation",
  retrying: "preparing",
  installingProject: "preparationStageInstallingProject",
  initializingSecrets: "preparationStageInitializingSecrets",
  loadingProject: "preparationStageLoadingProject",
  loadingRuntimeLibraries: "preparationStageLoadingRuntimeLibraries",
  connectingControl: "preparationStageConnectingControl",
  engineReady: "preparationStageEngineReady",
  uiReady: "preparing",
};

export function PreparationOverlay() {
  const reported = usePreparationStore((state) => state.state);
  const retrying = usePreparationStore((state) => state.retrying);
  const retry = usePreparationStore((state) => state.retry);
  const reinstallResources = useAppStore((state) => state.reinstallResources);
  const busy = useAppStore((state) => state.busy);
  const [dismissedRevision, setDismissedRevision] = useState<number>();
  const { t } = useTranslation();
  const preparation = reported;
  if (!preparation) return null;
  const failed = preparation.status === "failed";
  const running = preparation.status === "running" && !preparation.engineReady;
  const showFailure = failed && dismissedRevision !== preparation.revision;
  if (!running && !showFailure) return null;

  const progress = preparation.progress;
  const extractingProgress =
    progress?.phase === "extracting" && progress.totalEntries > 0
      ? progress
      : undefined;
  const percentage = extractingProgress
    ? Math.min(
        100,
        (extractingProgress.extractedEntries /
          extractingProgress.totalEntries) *
          100,
      )
    : undefined;
  const currentStage = stageMessage(preparation.stage);
  async function reinstallAndRetry() {
    await reinstallResources();
    await retry();
  }

  return createPortal(
    <section
      aria-live="polite"
      className={`fixed inset-x-4 bottom-[calc(5.5rem_+_var(--tt-safe-bottom))] z-[60] mx-auto flex max-w-md flex-col gap-2 rounded-lg border bg-raised px-3 py-2 text-sm shadow-lg ${
        failed ? "border-error text-ink" : "border-line text-ink"
      }`}
    >
      {failed ? (
        <>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 shrink-0 text-error" size="1rem" />
            <p className="min-w-0 flex-1 break-all">
              {preparation.error ?? t("preparationFailed")}
            </p>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => setDismissedRevision(preparation.revision)}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size="0.875rem" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={retrying || busy}
              onClick={() => void retry()}
              className="btn btn-primary h-9 flex-1"
            >
              <RotateCw
                size="1rem"
                className={retrying ? "animate-spin" : ""}
              />
              {retrying ? t("preparing") : t("preparationRetry")}
            </button>
            <button
              type="button"
              disabled={retrying || busy}
              onClick={() => void reinstallAndRetry()}
              className="btn h-9 flex-1 border border-line bg-raised"
            >
              <ArchiveRestore size="1rem" />
              {t("reinstallResources")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Loader2
              className="shrink-0 animate-spin text-accent"
              size="1rem"
            />
            <span className="min-w-0 flex-1 truncate">{t(currentStage)}</span>
            {extractingProgress && (
              <span className="ml-auto shrink-0 text-ink-muted">
                {Math.round(percentage ?? 0)}%
              </span>
            )}
          </div>
          {progress?.phase === "copying" ? (
            <progress className="progress w-full" />
          ) : extractingProgress ? (
            <>
              <progress
                className="progress w-full"
                value={percentage}
                max={100}
              />
              {extractingProgress.currentFile && (
                <p className="truncate text-xs text-ink-muted">
                  {extractingProgress.currentFile}
                </p>
              )}
            </>
          ) : null}
        </>
      )}
    </section>,
    document.body,
  );
}

function stageMessage(stage: string): MessageKey {
  return stage in STAGE_KEYS
    ? STAGE_KEYS[stage as keyof typeof STAGE_KEYS]
    : STAGE_KEYS.checkingInstallation;
}

import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";
import type {
  UpdateChannelSetting,
  UpdatePrefs,
  UpdateSourceSetting,
  UpdateStatus,
} from "../lib/types";
import {
  formatUpdateBytes,
  updateFailureKey,
  updateProgressPercent,
} from "../lib/updateMessages";
import { isActiveUpdatePhase, useUpdateStore } from "../store/updateStore";
import { Select } from "./ui/Select";
import { TextField } from "./ui/TextField";

function isUpdateSource(value: string): value is UpdateSourceSetting {
  return value === "auto" || value === "mirrorchyan" || value === "github";
}

function isUpdateChannel(value: string): value is UpdateChannelSetting {
  return value === "stable" || value === "beta";
}

const POLL_INTERVAL_MS = 500;

export function UpdateCard() {
  const { t } = useTranslation();
  const status = useUpdateStore((state) => state.status);
  const prefs = useUpdateStore((state) => state.prefs);
  const prefsBusy = useUpdateStore((state) => state.prefsBusy);
  const load = useUpdateStore((state) => state.load);
  const poll = useUpdateStore((state) => state.poll);
  const check = useUpdateStore((state) => state.check);
  const resolve = useUpdateStore((state) => state.resolve);
  const cancel = useUpdateStore((state) => state.cancel);
  const install = useUpdateStore((state) => state.install);
  const setPrefs = useUpdateStore((state) => state.setPrefs);
  const [draft, setDraft] = useState<UpdatePrefs>();

  useEffect(() => {
    void load();
  }, [load]);

  // Only the phases with a backend task in flight need polling; every other
  // phase changes through user actions whose responses carry the new state.
  const activePhase = status && isActiveUpdatePhase(status.phase);
  useEffect(() => {
    if (!activePhase) return;
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activePhase, poll]);

  const savedPrefs = draft ?? prefs;
  const prefsDirty =
    savedPrefs !== undefined &&
    prefs !== undefined &&
    (savedPrefs.source !== prefs.source ||
      savedPrefs.channel !== prefs.channel ||
      savedPrefs.cdk !== prefs.cdk);

  return (
    <section className="space-y-2 rounded-lg border border-line bg-raised p-3">
      <h2 className="font-medium">{t("update")}</h2>
      {savedPrefs && prefs && (
        <>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <span
                id="update-source-label"
                className="block text-sm text-ink-muted"
              >
                {t("updateSource")}
              </span>
              <Select
                labelledBy="update-source-label"
                items={[
                  { value: "auto", label: t("updateSourceAuto") },
                  { value: "mirrorchyan", label: t("updateSourceMirrorchyan") },
                  { value: "github", label: t("updateSourceGithub") },
                ]}
                value={savedPrefs.source}
                onValueChange={(value) => {
                  if (isUpdateSource(value)) {
                    setDraft({ ...savedPrefs, source: value });
                  }
                }}
              />
            </div>
            <div className="flex-1 space-y-1">
              <span
                id="update-channel-label"
                className="block text-sm text-ink-muted"
              >
                {t("updateChannel")}
              </span>
              <Select
                labelledBy="update-channel-label"
                items={[
                  { value: "stable", label: t("updateChannelStable") },
                  { value: "beta", label: t("updateChannelBeta") },
                ]}
                value={savedPrefs.channel}
                onValueChange={(value) => {
                  if (isUpdateChannel(value)) {
                    setDraft({ ...savedPrefs, channel: value });
                  }
                }}
              />
            </div>
          </div>
          {savedPrefs.source !== "github" && (
            <TextField
              label={t("updateCdk")}
              description={t("updateCdkDescription")}
              placeholder={t("updateCdkPlaceholder")}
              value={savedPrefs.cdk}
              onValueChange={(value) => setDraft({ ...savedPrefs, cdk: value })}
            />
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!prefsDirty || prefsBusy}
              onClick={() => {
                if (savedPrefs) void setPrefs(savedPrefs);
              }}
              className="h-9 rounded-md bg-accent px-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("updateApplyPrefs")}
            </button>
          </div>
        </>
      )}
      <UpdateStatusView status={status} />
      <div className="flex flex-wrap gap-2">
        <UpdateActions
          status={status}
          onCheck={() => void check()}
          onDownload={() => void resolve()}
          onCancel={() => void cancel()}
          onInstall={() => void install()}
        />
      </div>
    </section>
  );
}

/** The failure of the last step, localized through its code. */
function UpdateFailureLine({ status }: { status: UpdateStatus }) {
  const { t } = useTranslation();
  if (!status.failure) return null;
  return (
    <p className="text-sm text-error">{t(updateFailureKey(status.failure))}</p>
  );
}

function UpdateStatusView({ status }: { status?: UpdateStatus }) {
  const { t } = useTranslation();
  if (!status) return null;

  const lines: ReactNode[] = [];
  const showLatest = status.latestVersion !== null && status.phase !== "idle";
  if (showLatest) {
    lines.push(
      <p key="versions" className="text-sm">
        <span className="text-ink-muted">{t("updateCurrentVersion")}: </span>v
        {status.currentVersion}
        {status.latestVersion &&
          status.latestVersion !== status.currentVersion && (
            <>
              {" · "}
              <span className="text-ink-muted">{t("updateNewVersion")}: </span>
              <span className="font-semibold">v{status.latestVersion}</span>
            </>
          )}
      </p>,
    );
  }
  if (status.phase === "downloading") {
    const percent = updateProgressPercent(
      status.downloadedBytes,
      status.totalBytes,
    );
    lines.push(
      <div key="progress" className="space-y-1">
        <progress
          className="progress w-full"
          value={percent ?? undefined}
          max={percent === null ? undefined : 100}
        />
        <p className="text-sm text-ink-muted">
          {t("updateDownloading", {
            size: formatUpdateBytes(status.downloadedBytes),
          })}
        </p>
      </div>,
    );
  }
  if (status.releaseNote && status.phase === "available") {
    lines.push(
      <details key="note" className="text-sm">
        <summary className="cursor-pointer text-ink-muted">
          {t("updateReleaseNote")}
        </summary>
        <p className="mt-1 whitespace-pre-wrap text-ink-muted">
          {status.releaseNote}
        </p>
      </details>,
    );
  }
  return (
    <div className="space-y-1">
      <UpdateFailureLine status={status} />
      {lines}
    </div>
  );
}

interface UpdateActionsProps {
  status?: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onInstall: () => void;
}

function UpdateActions({
  status,
  onCheck,
  onDownload,
  onCancel,
  onInstall,
}: UpdateActionsProps) {
  const { t } = useTranslation();
  if (!status) return null;

  const primary =
    "flex h-9 items-center gap-2 rounded-md bg-accent px-2.5 text-sm font-semibold text-white disabled:opacity-50";
  const secondary =
    "flex h-9 items-center gap-2 rounded-md border border-line px-2.5 font-semibold disabled:opacity-50";
  const hint = "inline-flex h-9 items-center text-sm text-ink-muted";

  switch (status.phase) {
    case "checking":
      return (
        <>
          <span className={hint}>{t("updateChecking")}</span>
          <button type="button" className={secondary} onClick={onCancel}>
            {t("updateCancel")}
          </button>
        </>
      );
    case "resolving":
      return (
        <>
          <span className={hint}>{t("updateResolving")}</span>
          <button type="button" className={secondary} onClick={onCancel}>
            {t("updateCancel")}
          </button>
        </>
      );
    case "downloading":
      return (
        <button type="button" className={secondary} onClick={onCancel}>
          {t("updateCancel")}
        </button>
      );
    case "upToDate":
      return (
        <>
          <span className={hint}>{t("updateUpToDate")}</span>
          <button type="button" className={secondary} onClick={onCheck}>
            {t("updateCheck")}
          </button>
        </>
      );
    case "available":
      return (
        <>
          <button type="button" className={primary} onClick={onDownload}>
            {t("updateDownload")}
          </button>
          <button type="button" className={secondary} onClick={onCheck}>
            {t("updateCheck")}
          </button>
        </>
      );
    case "installPrompted":
    case "installFailed":
      return (
        <>
          <span className={hint}>
            {status.phase === "installPrompted"
              ? t("updateInstallPrompted")
              : t("updateInstallFailed")}
          </span>
          <button type="button" className={primary} onClick={onInstall}>
            {status.phase === "installPrompted"
              ? t("updateInstallAgain")
              : t("updateRetryInstall")}
          </button>
        </>
      );
    default:
      return (
        <button type="button" className={primary} onClick={onCheck}>
          {t("updateCheck")}
        </button>
      );
  }
}

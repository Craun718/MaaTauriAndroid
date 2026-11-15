import { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import {
  type DirectoryAccessDiagnostic,
  extractDirectoryAccess,
  parseDirectoryAccess,
} from "../directoryAccess";
import {
  type AppLanguage,
  isChineseLocale,
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
} from "../language";
import type {
  ConfigurationRecovery,
  PrivilegedStatus,
  RunEvent,
} from "../types";
import type { MessageKey } from "./messages/en";
import { en, SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC } from "./messages/en";
import { zh } from "./messages/zh";

export type { AppLanguage } from "../language";
export type { MessageKey } from "./messages/en";
export {
  isChineseLocale,
  projectLanguage,
  resolveLanguage,
  systemLanguageTags,
};

export function configurationRecoveryMessageKey(
  recovery: ConfigurationRecovery,
): MessageKey {
  if (recovery.kind === "backupRestored") {
    return "configurationRecoveryBackupRestored";
  }
  return recovery.reason === "parse"
    ? "configurationRecoveryResetForParse"
    : "configurationRecoveryResetForSecret";
}

const catalog: Record<AppLanguage, Record<MessageKey, string>> = { en, zh };

export function translate(
  language: AppLanguage,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = catalog[language][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

export interface Translation {
  language: AppLanguage;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/**
 * Backend diagnostics arrive as fixed English strings. The known run-start
 * and privileged-action failures map onto catalog keys so notifications can
 * follow the interface language; generic "Maa task … failed: …" task-abort
 * messages collapse to a short localized notice. Anything unknown is shown
 * as the original backend text.
 */
const diagnosticKeys: Record<string, MessageKey> = {
  "Shizuku is unavailable; install or start Shizuku, then try again":
    "diagnosticShizukuUnavailable",
  [SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC]:
    "diagnosticShizukuPermissionRequired",
  "The privileged control service disconnected; restart Shizuku and reopen the app, then try again":
    "diagnosticControlServiceDisconnected",
  "The privileged control unit failed to start; check Shizuku and the app logs, then try again":
    "diagnosticControlServiceFailedToStart",
  "The privileged control unit is starting; try again shortly":
    "diagnosticControlServiceStarting",
  "Root access was denied or timed out": "diagnosticRootAccessDenied",
  "The Shizuku control unit could not be connected":
    "diagnosticShizukuConnectFailed",
  "The Shizuku permission request failed, was denied, or timed out":
    "diagnosticShizukuPermissionRequestFailed",
  "Shizuku is not installed or cannot be opened": "diagnosticShizukuOpenFailed",
  "The privileged control service rejected the virtual display":
    "diagnosticVirtualDisplayRejected",
  "The run was stopped": "diagnosticRunStopped",
  "The run was aborted because it could not continue": "diagnosticRunAborted",
  "The run was stopped after reaching the configured maximum duration":
    "diagnosticRunTimeLimit",
  "the privileged control service became unavailable during the run; stopping the run":
    "diagnosticControlServiceLost",
  "the configuration backup exceeds the 4 MiB limit":
    "configurationImportTooLarge",
  "could not read the selected configuration backup":
    "configurationImportReadFailed",
  "The virtual display is not active": "diagnosticVirtualDisplayInactive",
  "Android rejected the virtual display back-key injection":
    "diagnosticVirtualDisplayBackRejected",
  "The privileged control service is unavailable for the virtual display back key":
    "diagnosticVirtualDisplayBackUnavailable",
};

const TASK_ABORT_PATTERN = /^Maa task \S+ failed: /;

/** English wording of the notices the run-start permission retry shows. They
 * are also the activity-log keys, so the same sentence never gets a second
 * name. */
export const runStartPermissionNotices = {
  requesting: translate("en", "diagnosticPermissionRequestInProgress"),
  succeeded: translate("en", "diagnosticPermissionRequestSucceeded"),
  failed: translate("en", "diagnosticPermissionRequestFailed"),
} as const;

/**
 * Whether a failed run start can be repaired by requesting privileged access.
 * Only a missing Shizuku grant qualifies: an uninstalled, disconnected, or
 * failed control unit reports a different diagnostic, where prompting the user
 * for permission would not help.
 */
export function isPermissionRequiredDiagnostic(message: string): boolean {
  return message === SHIZUKU_PERMISSION_REQUIRED_DIAGNOSTIC;
}

/**
 * Whether a failed run start was refused because the privileged control unit
 * was still coming up. That state resolves on its own, so the start can simply
 * wait for it and try again.
 */
export function isControlUnitStartingDiagnostic(message: string): boolean {
  return message === translate("en", "diagnosticControlServiceStarting");
}

/** Only a missing grant can be advanced by asking; other states cannot. */
export function canRequestPrivilegedAccess(status: PrivilegedStatus): boolean {
  return status.status === "permissionRequired";
}

function directoryAccessMessage(
  diagnostic: DirectoryAccessDiagnostic,
  language: AppLanguage,
): string {
  const params = { path: diagnostic.path };
  switch (diagnostic.kind) {
    case "permission":
      return diagnostic.scope === "agentRuntime"
        ? translate(language, "directoryPermissionRuntime", params)
        : translate(language, "directoryPermissionLogs", params);
    case "readOnly":
      return translate(language, "directoryReadOnly", params);
    case "noSpace":
      return translate(language, "directoryNoSpace", params);
    case "notDirectory":
      return translate(language, "directoryNotDirectory", params);
    case "unknown":
      return translate(language, "directoryUnknown", params);
  }
}

/** Known backend failures get a short localized notice; details stay in logs. */
export function localizeDiagnostic(
  message: string,
  language: AppLanguage,
): string {
  const directory = extractDirectoryAccess(message);
  if (directory) return directoryAccessMessage(directory, language);
  const key = diagnosticKeys[message];
  if (key) return translate(language, key);
  if (TASK_ABORT_PATTERN.test(message)) {
    return translate(language, "runTaskAborted");
  }
  return message;
}

/**
 * Runtime warnings stay in the exported backend log in English. Known events
 * also carry structured values so the live UI can render the interface locale.
 */
export function localizeRunEvent(
  event: RunEvent,
  language: AppLanguage,
): string {
  const data = event.data;
  if (data?.diagnostic === "directoryAccess") {
    const directory = parseDirectoryAccess(data.directoryAccess);
    if (directory) return directoryAccessMessage(directory, language);
  }
  if (data?.diagnostic === "virtualDisplayCompatibility") {
    return translate(language, "virtualDisplayCompatibilityWarning");
  }
  if (data?.diagnostic === "adbInputRestricted") {
    return translate(language, "displayHazardAdbInput");
  }
  if (data?.diagnostic === "screenEmpty") {
    return translate(language, "diagnosticVirtualDisplayScreenEmpty");
  }
  if (data?.diagnostic === "gameFps") {
    const level =
      data.level === "low"
        ? "diagnosticGameFpsLow"
        : data.level === "degraded"
          ? "diagnosticGameFpsDegraded"
          : undefined;
    if (
      level &&
      typeof data.windowSeconds === "number" &&
      typeof data.medianFps === "number" &&
      typeof data.thresholdFps === "number"
    ) {
      const source =
        data.source === "taskCallback"
          ? translate(language, "diagnosticGameFpsSourceCallback")
          : data.source === "frameCounter"
            ? translate(language, "diagnosticGameFpsSourceCounter")
            : undefined;
      if (source) {
        return translate(language, level, {
          windowSeconds: Math.round(data.windowSeconds),
          medianFps: Math.round(data.medianFps),
          thresholdFps: Math.round(data.thresholdFps),
          source,
        });
      }
    }
  }
  return localizeDiagnostic(event.message, language);
}

/** Translated strings for the current configuration, re-rendering when it changes. */
export function useTranslation(): Translation {
  const setting = useAppStore(
    (state) => state.snapshot?.configuration.uiLanguage,
  );
  const language = resolveLanguage(setting, systemLanguageTags());
  return useMemo(
    () => ({
      language,
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(language, key, params),
    }),
    [language],
  );
}

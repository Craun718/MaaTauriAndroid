import type { MessageKey } from "./i18n";
import type { UpdateFailureCode } from "./types";
import { updateFailureKey } from "./updateMessages";

export interface CredentialStatus {
  state:
    | "unknown"
    | "valid"
    | "invalid"
    | "expired"
    | "disabled"
    | "quotaExceeded"
    | "mismatch";
  checking: boolean;
  expiresAtSeconds: number | null;
  failure: UpdateFailureCode | null;
}

export function credentialPresentation(
  status: CredentialStatus | undefined,
  nowSeconds: number,
): { key: MessageKey; days?: number; warning: boolean } {
  if (!status) return { key: "credentialUnknown", warning: false };
  if (status.checking) return { key: "credentialChecking", warning: false };
  if (status.failure && status.state !== "valid")
    return { key: updateFailureKey(status.failure), warning: true };
  const expiry = status.expiresAtSeconds;
  if (expiry !== null && Number.isFinite(expiry) && expiry > 0) {
    if (expiry <= nowSeconds)
      return { key: "updateFailureCdkExpired", warning: true };
    const days = Math.ceil((expiry - nowSeconds) / 86_400);
    return {
      key:
        status.state === "valid"
          ? "credentialExpiresIn"
          : "credentialKnownExpiry",
      days,
      warning: days <= 7,
    };
  }
  return {
    key:
      status.state === "valid"
        ? "credentialValidUnknownExpiry"
        : "credentialUnknown",
    warning: false,
  };
}

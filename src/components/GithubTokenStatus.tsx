import { type ReactElement, type ReactNode, useState } from "react";
import { validateGithubToken } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import type { UpdateFailureCode } from "../lib/types";
import { updateFailureKey } from "../lib/updateMessages";

export function GithubTokenStatus({
  savedToken,
  dirty,
  children,
}: {
  savedToken: string;
  dirty: boolean;
  children?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    token: string;
    valid?: boolean;
    failure?: UpdateFailureCode;
  }>();
  const current = !dirty && result?.token === savedToken ? result : undefined;
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        disabled={dirty || !savedToken.trim() || pending}
        onClick={async () => {
          setPending(true);
          try {
            const valid = await validateGithubToken();
            setResult({ token: savedToken, valid });
          } catch {
            setResult({ token: savedToken, failure: "network" });
          } finally {
            setPending(false);
          }
        }}
      >
        {t(pending ? "credentialChecking" : "githubTokenValidate")}
      </button>
      {children}
      {current && (
        <p
          className={`w-full text-sm ${current.valid ? "text-ink-muted" : "text-warning"}`}
        >
          {t(
            current.failure
              ? updateFailureKey(current.failure)
              : current.valid
                ? "githubTokenValid"
                : "githubTokenInvalid",
          )}
        </p>
      )}
    </>
  );
}

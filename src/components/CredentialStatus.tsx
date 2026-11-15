import { type ReactElement, type ReactNode, useEffect } from "react";
import { credentialPresentation } from "../lib/credentialStatus";
import { useTranslation } from "../lib/i18n";
import { updateFailureKey } from "../lib/updateMessages";
import { useCredentialStore } from "../store/credentialStore";
import { useUpdateStore } from "../store/updateStore";

export function CredentialStatus({
  savedCode,
  dirty,
  children,
}: {
  savedCode: string;
  dirty: boolean;
  children?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const status = useCredentialStore((state) => state.status);
  const pending = useCredentialStore((state) => state.pending);
  const load = useCredentialStore((state) => state.load);
  const validate = useCredentialStore((state) => state.validate);
  const phase = useUpdateStore((state) => state.status?.phase);
  useEffect(() => {
    void load(JSON.stringify([savedCode, phase]));
  }, [load, savedCode, phase]);
  const presentation = credentialPresentation(status, Date.now() / 1000);
  return (
    <div className="contents text-sm">
      <div className="contents">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={dirty || !savedCode.trim() || pending || status?.checking}
          onClick={() => void validate()}
        >
          {t(pending ? "credentialChecking" : "credentialValidate")}
        </button>
        {children}
        {!dirty && (
          <p
            className={`w-full ${presentation.warning ? "text-warning" : "text-ink-muted"}`}
          >
            {t(
              presentation.key,
              presentation.days === undefined
                ? undefined
                : { days: presentation.days },
            )}
          </p>
        )}
      </div>
      {status?.state === "valid" && status.failure && (
        <p className="w-full text-warning">
          {t(updateFailureKey(status.failure))}
        </p>
      )}
    </div>
  );
}

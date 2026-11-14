import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { pickOptionPath } from "../../lib/api";
import { useTranslation } from "../../lib/i18n";
import { TextField } from "./TextField";

interface PathPickerFieldProps {
  kind: "file" | "directory";
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  error?: ReactNode;
  description?: ReactNode;
  password?: boolean;
}

/** Editable native path with a SAF selection action; cancellation preserves the current value. */
export function PathPickerField({
  kind,
  label,
  value,
  onValueChange,
  placeholder,
  compact = false,
  error,
  description,
  password = false,
}: PathPickerFieldProps): ReactElement {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const picking = useRef(false);
  const onChange = useRef(onValueChange);
  onChange.current = onValueChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function choose(): Promise<void> {
    if (picking.current) return;
    picking.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const path = await pickOptionPath(kind);
      // A task/option may have been closed while Android's picker was open.
      // Use the latest callback so other input values are not overwritten.
      if (mounted.current && path !== null) onChange.current(path);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      picking.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5" aria-busy={busy}>
      <TextField
        label={label}
        type={password ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        compact={compact}
        disabled={busy}
        error={
          failed ? <span role="alert">{t("optionPathPickFailed")}</span> : error
        }
        description={description}
        onValueChange={(next) => {
          setFailed(false);
          onValueChange(next);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => {
            void choose();
          }}
        >
          {busy
            ? t("optionPathPicking")
            : kind === "file"
              ? t("optionPathFile")
              : t("optionPathDirectory")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || value.length === 0}
          onClick={() => {
            setFailed(false);
            onValueChange("");
          }}
        >
          {t("optionPathClear")}
        </button>
      </div>
      <p className="text-[0.8125rem] text-base-content/60">
        {t("optionPathCopyHint")}
      </p>
    </div>
  );
}

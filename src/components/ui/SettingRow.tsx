import { ArrowUpRight, ChevronRight, CircleHelp } from "lucide-react";
import { type ReactElement, type ReactNode, useId, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { Checkbox } from "./Checkbox";

export function SettingRow({
  title,
  description,
  helpTitle,
  children,
}: {
  title?: ReactNode;
  description?: string;
  helpTitle?: string;
  children?: ReactNode;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2">
        {title && <div className="min-w-0 flex-1 font-medium">{title}</div>}
        {children && <div className="min-w-0 flex-1">{children}</div>}
        {description && (
          <div
            className={`tooltip tooltip-left shrink-0 ${expanded ? "tooltip-open" : ""}`}
          >
            <div
              id={id}
              role="tooltip"
              className="tooltip-content w-64 max-w-[70vw] whitespace-normal text-left text-sm"
            >
              {description}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm shrink-0"
              aria-label={
                helpTitle
                  ? t("settingHelpFor", { name: helpTitle })
                  : t("settingHelp")
              }
              aria-describedby={id}
              onClick={() => setExpanded((value) => !value)}
              onBlur={() => setExpanded(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setExpanded(false);
              }}
            >
              <CircleHelp size="1rem" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingToggle({
  title,
  icon,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string;
  icon: ReactNode;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}): ReactElement {
  return (
    <SettingRow description={description} helpTitle={title}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="min-h-14 w-full gap-3"
      >
        <span className="flex items-center gap-3 font-medium">
          <span className="shrink-0 text-base-content/60">{icon}</span>
          <span>{title}</span>
        </span>
      </Checkbox>
    </SettingRow>
  );
}

export function SettingAction({
  title,
  icon,
  external = false,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  external?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left text-sm font-medium hover:bg-base-200"
    >
      <span className="shrink-0 text-base-content/60">{icon}</span>
      <span className="min-w-0 flex-1">{title}</span>
      {external ? <ArrowUpRight size="1rem" /> : <ChevronRight size="1rem" />}
    </button>
  );
}

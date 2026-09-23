import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "../lib/i18n";
import { RichDescription } from "./RichDescription";
import { Checkbox } from "./ui/Checkbox";

interface AnnouncementModalProps {
  open: boolean;
  content: string[];
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function AnnouncementModal({
  open,
  content,
  remember,
  onRememberChange,
  onClose,
  onConfirm,
}: AnnouncementModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("announcement")}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[calc(100dvh-2rem_-_var(--tt-safe-top))] max-w-md flex-col rounded-t-lg border border-b-0 border-line bg-raised shadow-lg outline-none"
      >
        <div className="flex items-center justify-between gap-3 p-3">
          <h2 className="font-medium">{t("announcement")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size="1rem" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3">
          {content.map((item) => (
            <RichDescription key={item} text={item} />
          ))}
        </div>
        <div className="space-y-3 p-3 pb-[calc(1rem_+_var(--tt-safe-bottom))]">
          <Checkbox
            checked={remember}
            onCheckedChange={onRememberChange}
            className="text-sm"
          >
            {t("hideAnnouncementOnLaunch")}
          </Checkbox>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary h-10 w-full"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </>
  );
}

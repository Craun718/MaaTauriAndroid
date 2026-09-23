import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../lib/i18n";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Centered modal with an inset panel: safe-area padding keeps it clear of the
 * system bars, while tall content scrolls inside the panel.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
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
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 pt-[calc(1rem_+_var(--tt-safe-top))] pb-[calc(1rem_+_var(--tt-safe-bottom))]">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className="pointer-events-auto flex max-h-full w-full max-w-md flex-col rounded-lg border border-line bg-raised p-3 shadow-lg outline-none"
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h2 className="font-medium">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size="1rem" />
            </button>
          </div>
          <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

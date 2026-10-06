import { Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "../lib/i18n";

/** Blocking progress notice for IPC work that has no intermediate UI. */
export function BusyModal() {
  const { t } = useTranslation();

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/40" />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 pt-[calc(1rem_+_var(--tt-safe-top))] pb-[calc(1rem_+_var(--tt-safe-bottom))]">
        <section
          aria-live="polite"
          aria-modal="true"
          aria-label={t("working")}
          role="dialog"
          className="pointer-events-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-raised p-3 text-sm font-medium shadow-lg"
        >
          <Loader2 className="shrink-0 animate-spin text-accent" size="1rem" />
          <span className="min-w-0 flex-1">{t("working")}</span>
        </section>
      </div>
    </>,
    document.body,
  );
}

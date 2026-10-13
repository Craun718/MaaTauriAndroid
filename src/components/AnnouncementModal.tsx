import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { announcementTitle } from "../lib/announcements";
import { useTranslation } from "../lib/i18n";
import { useHoldCountdown } from "../lib/useHoldCountdown";
import { RichDescription } from "./RichDescription";
import { Checkbox } from "./ui/Checkbox";
import { Tabs } from "./ui/Tabs";

interface AnnouncementModalProps {
  open: boolean;
  content: string[];
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
  /** While a hold window is running the announcement cannot be closed or
   * confirmed, so a startup announcement is not dismissed before it is read. */
  holdMs?: number;
}

export function AnnouncementModal({
  open,
  content,
  remember,
  onRememberChange,
  onClose,
  onConfirm,
  holdMs = 0,
}: AnnouncementModalProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string>();
  const holdSeconds = useHoldCountdown(open, holdMs);
  const held = holdSeconds > 0;

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || held) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, held, onClose]);

  if (!open) return null;

  function requestClose() {
    if (held) return;
    onClose();
  }

  const contentOccurrences = new Map<string, number>();
  const announcements = content.map((body, index) => {
    const occurrence = contentOccurrences.get(body) ?? 0;
    contentOccurrences.set(body, occurrence + 1);
    return {
      key: occurrence === 0 ? body : `${body}:${occurrence}`,
      body,
      label: announcementTitle(body) ?? `${t("announcement")} ${index + 1}`,
    };
  });
  // Announcement bodies can arrive after the modal opens; a key that is no
  // longer present falls back to the first tab instead of blanking the panel.
  const activeAnnouncement = announcements.some(
    (announcement) => announcement.key === activeKey,
  )
    ? activeKey
    : announcements[0]?.key;

  return (
    <>
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        onClick={requestClose}
        className="fixed inset-0 z-40 cursor-default bg-black/40"
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-8 pt-[calc(2rem_+_var(--tt-safe-top))] pb-[calc(2rem_+_var(--tt-safe-bottom))]">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("announcement")}
          tabIndex={-1}
          className="pointer-events-auto flex max-h-full w-full max-w-md flex-col rounded-lg border border-line bg-raised shadow-lg outline-none"
        >
          <div className="flex items-center justify-between gap-3 p-3">
            <h2 className="font-medium">{t("announcement")}</h2>
            <button
              type="button"
              onClick={requestClose}
              disabled={held}
              aria-label={t("close")}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
            >
              <X size="1rem" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {announcements.length > 1 ? (
              <Tabs
                items={announcements.map(({ key, label, body }) => ({
                  value: key,
                  label,
                  content: <RichDescription text={body} />,
                }))}
                value={activeAnnouncement}
                onValueChange={setActiveKey}
                ariaLabel={t("announcement")}
              />
            ) : (
              announcements.map(({ key, body }) => (
                <RichDescription key={key} text={body} />
              ))
            )}
            <Checkbox
              checked={remember}
              onCheckedChange={onRememberChange}
              className="text-sm"
            >
              {t("hideAnnouncementOnLaunch")}
            </Checkbox>
            {held && (
              <p className="text-xs text-ink-muted">
                {t("announcementDismissCountdown", { seconds: holdSeconds })}
              </p>
            )}
            <button
              type="button"
              onClick={onConfirm}
              disabled={held}
              className="btn btn-primary h-10 w-full"
            >
              {t("confirm")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

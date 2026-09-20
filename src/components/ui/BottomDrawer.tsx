import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../lib/i18n";

interface BottomDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * 底部抽屉：面板从屏幕底部升起，遮罩、Esc 和右上角按钮均可关闭。
 * 打开时把焦点移入面板，读屏用户能直接感知到对话框的出现。
 * WebView 视口直达物理屏幕边缘，面板底部的 env(safe-area-inset-bottom)
 * 让内容避开手势条/导航键（原生不做任何 inset padding，见 AGENTS.md）。
 */
export function BottomDrawer({
  open,
  onClose,
  title,
  children,
}: BottomDrawerProps) {
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
        aria-label={title}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-lg border border-b-0 border-line bg-raised p-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] shadow-lg outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-2 space-y-1">{children}</div>
      </div>
    </>
  );
}

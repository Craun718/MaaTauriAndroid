import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { resolveFocusModal } from "../lib/api";
import { useTranslation } from "../lib/i18n";

interface FocusNotice {
  channel: string;
  messageType: string;
  name?: string;
  message: string;
}

/// Global host for blocking (`display: "modal"`) focus messages. Mounted
/// outside the page router so a modal stays on screen — and the backend
/// queue gate stays resolvable — no matter which page the user is on. The
/// Rust run queue pauses task advancement until every modal is confirmed.
export function FocusModalHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<FocusNotice[]>([]);

  useEffect(() => {
    let disposed = false;
    let stop = (): void => undefined;
    listen<FocusNotice>("focus-notify", (notification) => {
      if (notification.payload.channel === "modal") {
        setPending((current) => [...current, notification.payload]);
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          stop = unlisten;
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  if (pending.length === 0) {
    return null;
  }
  const notice = pending[0];
  const confirm = (): void => {
    setPending((current) => current.slice(1));
    void resolveFocusModal().catch(() => undefined);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4"
    >
      <div className="w-full rounded-lg border border-line bg-raised p-3 shadow-lg">
        <p className="text-sm">
          {notice.name ? `${notice.name}: ${notice.message}` : notice.message}
        </p>
        <button
          type="button"
          onClick={confirm}
          className="mt-2 h-8 w-full rounded-md bg-accent font-semibold text-white"
        >
          {t("focusDismiss")}
        </button>
      </div>
    </div>
  );
}

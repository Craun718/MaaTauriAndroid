import {
  CircleAlert,
  Info,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  type AppNotification,
  type NotificationTone,
  useNotificationStore,
} from "../../store/notificationStore";

const toneStyles: Record<
  NotificationTone,
  { container: string; icon: string; Icon: LucideIcon }
> = {
  info: {
    container: "border-line text-ink",
    icon: "text-accent",
    Icon: Info,
  },
  warning: {
    container: "border-warning/40 text-ink",
    icon: "text-warning",
    Icon: TriangleAlert,
  },
  error: {
    container: "border-error/40 text-ink",
    icon: "text-error",
    Icon: CircleAlert,
  },
};

export function NotificationHost() {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);
  const { t } = useTranslation();

  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-[calc(1rem_+_env(safe-area-inset-top))] z-50 mx-auto flex max-w-xs flex-col gap-2">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          dismissLabel={t("dismissNotification")}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}

function NotificationItem({
  notification,
  dismissLabel,
  onDismiss,
}: {
  notification: AppNotification;
  dismissLabel: string;
  onDismiss: (id: number) => void;
}) {
  const tone = toneStyles[notification.tone];
  const Icon = tone.Icon;

  useEffect(() => {
    if (notification.durationMs === undefined) return;
    const timeout = window.setTimeout(() => {
      onDismiss(notification.id);
    }, notification.durationMs);
    return () => window.clearTimeout(timeout);
  }, [notification.durationMs, notification.id, onDismiss]);

  return (
    <div
      role={notification.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-raised p-3 shadow-lg ${tone.container}`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone.icon}`} />
      <p className="min-w-0 flex-1 break-words text-sm">
        {notification.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        aria-label={dismissLabel}
        className="-m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <X size={14} />
      </button>
    </div>
  );
}

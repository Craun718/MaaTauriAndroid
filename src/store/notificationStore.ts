import { create } from "zustand";

export type NotificationTone = "info" | "warning" | "error";

export interface AppNotification {
  id: number;
  tone: NotificationTone;
  message: string;
  durationMs?: number;
}

interface NotificationStore {
  notifications: AppNotification[];
  notify: (
    message: string,
    options?: { tone?: NotificationTone; durationMs?: number },
  ) => number;
  dismiss: (id: number) => void;
}

let nextNotificationId = 1;
const maxVisibleNotifications = 3;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  notify(message, options) {
    const id = nextNotificationId;
    nextNotificationId += 1;
    const notification: AppNotification = {
      id,
      tone: options?.tone ?? "info",
      message,
      durationMs: options?.durationMs ?? 5000,
    };
    set((state) => ({
      notifications: [...state.notifications, notification].slice(
        -maxVisibleNotifications,
      ),
    }));
    return id;
  },
  dismiss(id) {
    set((state) => ({
      notifications: state.notifications.filter(
        (notification) => notification.id !== id,
      ),
    }));
  },
}));

import { create } from "zustand";
import { useRunLogStore } from "./runLogStore";

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
    options?: {
      tone?: NotificationTone;
      durationMs?: number;
      logToActivity?: boolean;
    },
  ) => number;
  dismiss: (id: number) => void;
}

let nextNotificationId = 1;
const maxVisibleNotifications = 3;
const defaultNotificationDurationMs = 15000;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  notify(message, options) {
    const id = nextNotificationId;
    nextNotificationId += 1;
    const tone = options?.tone ?? "info";
    const notification: AppNotification = {
      id,
      tone,
      message,
      durationMs: options?.durationMs ?? defaultNotificationDurationMs,
    };
    if (tone !== "info" && options?.logToActivity !== false) {
      useRunLogStore.getState().appendNotification({
        atUnixMs: Date.now(),
        tone,
        message,
      });
    }
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

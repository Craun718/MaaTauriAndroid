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
  seenKeys: Set<string>;
  notify: (
    message: string,
    options?: {
      tone?: NotificationTone;
      durationMs?: number;
      logToActivity?: boolean;
    },
  ) => number;
  notifyOnce: (
    key: string,
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

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  seenKeys: new Set<string>(),
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
  notifyOnce(key, message, options) {
    if (get().seenKeys.has(key)) return -1;
    set((state) => ({ seenKeys: new Set(state.seenKeys).add(key) }));
    return get().notify(message, options);
  },
  dismiss(id) {
    set((state) => ({
      notifications: state.notifications.filter(
        (notification) => notification.id !== id,
      ),
    }));
  },
}));

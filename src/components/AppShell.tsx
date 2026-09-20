import { Home, ListChecks, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "../lib/i18n";
import { NotificationHost } from "./ui/NotificationHost";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigation = [
    { to: "/", label: t("navHome"), icon: Home },
    { to: "/tasks", label: t("navTasks"), icon: ListChecks },
    { to: "/settings", label: t("navSettings"), icon: Settings },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      {/* The only scroll container in the app: html/body are locked in index.css
          so the overlay nav below can never be dragged around with the page. */}
      <main className="flex-1 overscroll-none overflow-y-auto overflow-x-hidden px-4 pb-[calc(4rem_+_env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-md items-stretch">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] ${
                  isActive ? "text-accent" : "text-ink-muted"
                }`
              }
            >
              <Icon size={20} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <NotificationHost />
    </div>
  );
}

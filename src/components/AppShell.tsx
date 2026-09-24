import { History, Home, ListChecks, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "../lib/i18n";
import { NotificationHost } from "./ui/NotificationHost";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigation = [
    { to: "/", label: t("navHome"), icon: Home },
    { to: "/tasks", label: t("navTasks"), icon: ListChecks },
    { to: "/runs", label: t("navRuns"), icon: History },
    { to: "/settings", label: t("navSettings"), icon: Settings },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col pt-[var(--tt-safe-top)]">
      {/* The only scroll container in the app: html/body are locked in index.css
          so the overlay nav below can never be dragged around with the page.
          The top safe-area inset lives on the shell above, NOT on <main>:
          overflow clips at the scroll container's padding box, so a padding-top
          on <main> would let scrolled content slide under the status bar text. */}
      <main className="flex-1 overscroll-none overflow-y-auto overflow-x-hidden px-4 pb-[calc(4rem_+_var(--tt-safe-bottom))]">
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/92 pb-[var(--tt-safe-bottom)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-md items-stretch">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] ${
                  isActive ? "text-accent" : "text-ink-muted"
                }`
              }
            >
              <Icon size="1.25rem" strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <NotificationHost />
    </div>
  );
}

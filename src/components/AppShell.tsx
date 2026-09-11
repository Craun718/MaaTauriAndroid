import { NavLink } from "react-router-dom";
import { FolderOpen, Home, ListChecks, Settings } from "lucide-react";
import { useTranslation } from "../lib/i18n";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigation = [
    { to: "/", label: t("navHome"), icon: Home },
    { to: "/setup", label: t("navSetup"), icon: FolderOpen },
    { to: "/tasks", label: t("navTasks"), icon: ListChecks },
    { to: "/settings", label: t("navMore"), icon: Settings },
  ];

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-5">{children}</main>
      {/* No safe-area padding here: the system bar insets are applied natively to the
          webview container (MainActivity.insetContainerOf), so the viewport this nav is
          pinned to already ends above the gesture bar. Adding env(safe-area-inset-bottom)
          as well would double it. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-md items-stretch">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] ${
                  isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                }`
              }
            >
              <Icon size={20} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

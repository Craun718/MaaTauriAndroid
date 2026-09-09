import { NavLink } from "react-router-dom";
import { Activity, FolderOpen, Home, ListChecks, Settings } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { to: "/", label: "Home", icon: Home },
  { to: "/setup", label: "Setup", icon: FolderOpen },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/run", label: "Run", icon: Activity },
  { to: "/settings", label: "More", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col">
      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur">
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

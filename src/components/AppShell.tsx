import { History, Home, ListChecks, Settings } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  backgroundCardOpacity,
  useBackgroundImageObjectUrl,
} from "../lib/backgroundImage";
import { useTranslation } from "../lib/i18n";
import { useAppStore } from "../store/appStore";
import { NotificationHost } from "./ui/NotificationHost";

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const backgroundImage = useAppStore(
    (state) => state.snapshot?.configuration.backgroundImage,
  );
  const cardOpacity = backgroundCardOpacity(
    useAppStore((state) => state.snapshot?.configuration.backgroundCardOpacity),
  );
  const backgroundSource = useBackgroundImageObjectUrl(backgroundImage);
  const shellStyle = {
    "--tt-card-opacity": cardOpacity / 100,
  } as CSSProperties;
  const navigation = [
    { to: "/", label: t("navHome"), icon: Home },
    { to: "/tasks", label: t("navTasks"), icon: ListChecks },
    { to: "/runs", label: t("navRuns"), icon: History },
    { to: "/settings", label: t("navSettings"), icon: Settings },
  ];

  return (
    <>
      {backgroundSource && (
        <div aria-hidden="true" className="fixed inset-0 z-0 overflow-hidden">
          <img
            src={backgroundSource}
            alt=""
            className="absolute inset-0 size-full object-cover object-center"
          />
        </div>
      )}
      {backgroundSource && (
        <div aria-hidden="true" className="fixed inset-0 z-0 bg-surface/45" />
      )}
      <div
        className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col pt-[var(--tt-safe-top)]"
        style={shellStyle}
      >
        {/* The only scroll container in the app: html/body are locked in index.css
          so the overlay nav below can never be dragged around with the page.
          The top safe-area inset lives on the shell above, NOT on <main>:
          overflow clips at the scroll container's padding box, so a padding-top
          on <main> would let scrolled content slide under the status bar text.
          The bottom padding clears the fixed nav below (h-16 + safe-area) and
          adds a 1rem gap on top of it: without that gap the last element of
          every scrolling page rests exactly on the nav's border-t, which reads
          as "glued to the menu bar". */}
        <main className="flex min-h-0 flex-1 flex-col overscroll-none overflow-y-auto overflow-x-hidden px-4 pb-[calc(4rem_+_1rem_+_1px_+_var(--tt-safe-bottom))]">
          {children}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/82 pb-[var(--tt-safe-bottom)] backdrop-blur">
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
    </>
  );
}

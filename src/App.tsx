import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { BusyModal } from "./components/BusyModal";
import { FocusModalHost } from "./components/FocusModalHost";
import { PreparationOverlay } from "./components/PreparationOverlay";
import { HomePage } from "./pages/HomePage";
import { useAppStore } from "./store/appStore";
import { usePreparationStore } from "./store/preparationStore";

const RunHistoryPage = lazy(async () => {
  const module = await import("./pages/RunHistoryPage");
  return { default: module.RunHistoryPage };
});
const SchedulesPage = lazy(async () => {
  const module = await import("./pages/SchedulesPage");
  return { default: module.SchedulesPage };
});
const SettingsPage = lazy(async () => {
  const module = await import("./pages/SettingsPage");
  return { default: module.SettingsPage };
});
const TasksPage = lazy(async () => {
  const module = await import("./pages/TasksPage");
  return { default: module.TasksPage };
});

function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const bootstrapStatus = useAppStore((state) => state.bootstrapStatus);
  const busy = useAppStore((state) => state.busy);
  const initializePreparation = usePreparationStore(
    (state) => state.initialize,
  );

  useEffect(() => {
    void initializePreparation();
  }, [initializePreparation]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <HashRouter>
      <AppShell>
        {bootstrapStatus === "ready" && (
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/runs" element={<RunHistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
        {busy && <BusyModal />}
        <FocusModalHost />
        <PreparationOverlay />
      </AppShell>
    </HashRouter>
  );
}

function RouteFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[50vh] items-center justify-center"
    >
      <Loader2 className="animate-spin text-accent" size="1.25rem" />
    </div>
  );
}

export default App;

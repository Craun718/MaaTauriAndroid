import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { BusyModal } from "./components/BusyModal";
import { FocusModalHost } from "./components/FocusModalHost";
import { PreparationOverlay } from "./components/PreparationOverlay";
import { HomePage } from "./pages/HomePage";
import { RunHistoryPage } from "./pages/RunHistoryPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { useAppStore } from "./store/appStore";
import { usePreparationStore } from "./store/preparationStore";

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
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/runs" element={<RunHistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
        {busy && <BusyModal />}
        <FocusModalHost />
        <PreparationOverlay />
      </AppShell>
    </HashRouter>
  );
}

export default App;

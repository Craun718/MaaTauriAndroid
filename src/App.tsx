import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { TasksPage } from "./pages/TasksPage";
import { useAppStore } from "./store/appStore";

function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const busy = useAppStore((state) => state.busy);
  const error = useAppStore((state) => state.error);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <HashRouter>
      <AppShell>
        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {busy && <p className="mt-4 text-sm text-[var(--text-muted)]">Working</p>}
      </AppShell>
    </HashRouter>
  );
}

export default App;

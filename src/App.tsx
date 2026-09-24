import { useEffect } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { FocusModalHost } from "./components/FocusModalHost";
import { useTranslation } from "./lib/i18n";
import { HomePage } from "./pages/HomePage";
import { RunHistoryPage } from "./pages/RunHistoryPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { useAppStore } from "./store/appStore";

function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const busy = useAppStore((state) => state.busy);
  const { t } = useTranslation();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/runs" element={<RunHistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* 常驻占位：busy 文案出现/消失时内容高度不变，避免整页抖动。 */}
        <div aria-live="polite" className="mt-4 min-h-5 text-sm text-ink-muted">
          {busy ? t("working") : ""}
        </div>
        <FocusModalHost />
      </AppShell>
    </HashRouter>
  );
}

export default App;

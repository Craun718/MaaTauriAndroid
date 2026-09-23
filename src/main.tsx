import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installFrontendErrorLogging } from "./lib/frontendLogging";
import { syncSafeAreaInsets } from "./lib/safe-area";

installFrontendErrorLogging();

// Keep the CSS safe-area variables in sync with the real system-bar insets:
// startup, plus resize for rotation and navigation-mode switches (the manifest
// declares configChanges, so those resize the viewport without recreating it).
void syncSafeAreaInsets();
window.addEventListener("resize", () => void syncSafeAreaInsets());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installFrontendErrorLogging } from "./lib/frontendLogging";
import { syncSafeAreaInsets } from "./lib/safe-area";

installFrontendErrorLogging();

// Viewport metadata and touch-action cover touch zoom. Trackpad pinch and
// mouse-wheel zoom still arrive as wheel events on desktop, so reject them at
// the earliest app boundary. gesturestart also blocks legacy Safari behavior.
function rejectPageZoom(event: Event): void {
  if (event instanceof WheelEvent && !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
}

window.addEventListener("wheel", rejectPageZoom, { passive: false });
document.addEventListener("gesturestart", rejectPageZoom);
document.addEventListener("gesturechange", rejectPageZoom);

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

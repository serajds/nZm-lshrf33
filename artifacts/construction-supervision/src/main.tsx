import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { registerSW } from "virtual:pwa-register";
import { installAutoFlush } from "./lib/offline-attendance";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

// Drain any attendance check-in/out requests that were queued offline.
// Idempotent — safe even if the queue is empty or the user is signed out.
installAutoFlush();

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

// Hide the splash screen as soon as React commits its first render. We do
// NOT wait for /auth/me to resolve — that used to leave users stuck on the
// splash whenever the network was slow or the API was momentarily down.
// The app shell shows its own "جاري التحميل..." for any pending data.
function dismissSplash() {
  if (typeof window !== "undefined") {
    const t = (window as unknown as { __splashSafetyTimer?: number }).__splashSafetyTimer;
    if (t) clearTimeout(t);
  }
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("splash-hide");
  setTimeout(() => splash.remove(), 500);
}
// Two rAFs guarantees we run after React has actually painted, not just
// committed.
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

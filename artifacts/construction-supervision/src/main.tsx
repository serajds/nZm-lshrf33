import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { registerSW } from "virtual:pwa-register";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

// Drain any offline-queued attendance requests AFTER the first paint. The
// IndexedDB code + queue logic is ~5 KB but, more importantly, dragging it
// into the entry bundle blocked the splash from clearing. Defer to idle.
const scheduleIdle =
  (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
  ((cb: () => void) => setTimeout(cb, 200));
scheduleIdle(() => {
  void import("./lib/offline-attendance").then((m) => m.installAutoFlush());
});

// Hide the splash screen as soon as React commits its first render. We do
// NOT wait for /auth/me to resolve — that used to leave users stuck on the
// splash whenever the network was slow or the API was momentarily down.
function dismissSplash() {
  if (typeof window !== "undefined") {
    const t = (window as unknown as { __splashSafetyTimer?: number }).__splashSafetyTimer;
    if (t) clearTimeout(t);
  }
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("splash-hide");
  // Match the CSS transition duration (200ms) so the node is gone right
  // when the fade ends — no extra dead time on top of the visible fade.
  setTimeout(() => splash.remove(), 220);
}
// Two rAFs guarantees we run after React has actually painted, not just
// committed.
requestAnimationFrame(() => requestAnimationFrame(dismissSplash));

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

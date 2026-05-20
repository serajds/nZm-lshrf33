import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter, setAuthTokenSaver } from "@workspace/api-client-react";
import { registerSW } from "virtual:pwa-register";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));
// When the server rolls our session forward via X-Renewed-Token, persist
// the fresh token immediately so the next request (and the next page load)
// uses it. AuthProvider also listens on the storage event to sync its
// in-memory token state.
setAuthTokenSaver((token) => {
  try {
    if (localStorage.getItem("auth_token") !== token) {
      localStorage.setItem("auth_token", token);
      window.dispatchEvent(new CustomEvent("auth-token-renewed", { detail: token }));
    }
  } catch {
    // localStorage may be unavailable (private mode) — non-fatal.
  }
});

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

// Hide the splash screen ONLY when the auth bootstrap has settled — see
// AuthProvider, which calls window.__dismissAppSplash once /auth/me has
// resolved (or immediately when there is no token / a cached user is
// available). Dismissing earlier caused a brief "جاري التحميل..." text
// flash for tokens with no cached user. The 12-second safety timer in
// index.html still hides the splash if React or the network never makes
// it that far.
function dismissSplash() {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __splashSafetyTimer?: number; __splashSlowTimer?: number };
    if (w.__splashSafetyTimer) clearTimeout(w.__splashSafetyTimer);
    if (w.__splashSlowTimer) clearTimeout(w.__splashSlowTimer);
  }
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("splash-hide");
  // Match the CSS transition duration (200ms) so the node is gone right
  // when the fade ends — no extra dead time on top of the visible fade.
  setTimeout(() => splash.remove(), 220);
}
(window as unknown as { __dismissAppSplash?: () => void }).__dismissAppSplash = dismissSplash;

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

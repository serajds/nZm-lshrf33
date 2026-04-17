import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { registerSW } from "virtual:pwa-register";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

function hideSplash() {
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  splash.classList.add("splash-hide");
  window.setTimeout(() => splash.remove(), 600);
}

const MIN_SPLASH_MS = 600;
const startedAt = performance.now();

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const elapsed = performance.now() - startedAt;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    window.setTimeout(hideSplash, remaining);
  });
});

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

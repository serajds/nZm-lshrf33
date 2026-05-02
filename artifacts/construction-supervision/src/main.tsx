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

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

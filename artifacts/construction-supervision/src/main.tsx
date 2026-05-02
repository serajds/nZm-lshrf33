import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { registerSW } from "virtual:pwa-register";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

const rootEl = document.getElementById("root")!;
createRoot(rootEl).render(<App />);

if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

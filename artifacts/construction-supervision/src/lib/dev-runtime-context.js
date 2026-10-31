// Development-only, parser-blocking listener installed before the overlay's
// module executes. Preserve native Errors; recover metadata it otherwise drops.
(() => {
  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      if (!/^https?:$/.test(url.protocol)) return "[non-http resource]";
      url.search = "";
      url.hash = "";
      url.pathname = url.pathname.replace(/(\/(?:owner|form)\/)[^/]+/g, "$1[redacted]");
      return url.toString();
    } catch {
      return "[invalid resource URL]";
    }
  }
  function safeText(value) {
    return value.slice(0, 3000)
      .replace(/https?:\/\/[^\s"'<>)]*/g, safeUrl)
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted token]")
      .replace(/\b(password|token|secret|authorization|api[_-]?key)["']?\s*[:=]\s*["']?[^\s,;"']+/gi, "$1=[redacted]")
      .slice(0, 1500);
  }
  function normalize(value, fallback) {
    let message = fallback;
    try {
      if (typeof value === "string") message = value;
      else if (value && typeof value.message === "string") message = value.message;
    } catch {
      // A rejected proxy/getter must not throw a second error in this listener.
    }
    const error = new Error(safeText(message || fallback));
    error.stack = safeText(error.stack || error.message);
    return error;
  }
  function attach(event, property, error) {
    try {
      Object.defineProperty(event, property, { value: error, configurable: true });
    } catch {
      // Restricted browser events still get a useful, sanitized console entry.
    }
    console.error("[app-runtime-context]", error.message, error.stack);
  }
  window.addEventListener("error", event => {
    if (event instanceof ErrorEvent) {
      if (event.error instanceof Error) return;
      const error = normalize(event.error, event.message || "Browser script error without an Error object");
      if (event.filename) {
        error.stack = `${error.name}: ${error.message}\n    at ${safeUrl(event.filename)}:${event.lineno || 1}:${event.colno || 1}`;
      }
      attach(event, "error", error);
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && /^(SCRIPT|LINK|IMG)$/.test(target.tagName)) {
      const resource = target.getAttribute("src") || target.getAttribute("href");
      if (resource) console.error("[app-resource-error]", target.tagName, safeUrl(resource));
    }
  }, true);
  window.addEventListener("unhandledrejection", event => {
    if (event.reason instanceof Error) return;
    attach(event, "reason", normalize(event.reason, `Promise rejected without an Error (${typeof event.reason})`));
  }, true);
})();

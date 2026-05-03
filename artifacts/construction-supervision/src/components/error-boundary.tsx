import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Normalize whatever React threw into a real Error. React 18 can hand us
 *  a plain `{}`, a string, or a thenable (the latter happens when a lazy
 *  component suspends without a Suspense boundary above it — *that*
 *  silent class of failure cost us a full debugging round). Wrapping
 *  here means the rendered fallback always has a meaningful message
 *  and the console log isn't just `[RouteErrorBoundary] {}`. */
function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  if (typeof thrown === "string") return new Error(thrown);
  if (thrown && typeof thrown === "object" && "then" in thrown) {
    return new Error("A component suspended without a <Suspense> boundary above it.");
  }
  try {
    return new Error(`Non-Error value thrown: ${JSON.stringify(thrown)}`);
  } catch {
    return new Error("Non-Error value thrown (unserializable).");
  }
}

/**
 * Catches errors thrown during rendering, in lifecycle methods, and
 * (importantly) failures of `React.lazy(() => import(...))`. Without this
 * boundary, a single chunk-load failure on a flaky mobile network would
 * blank the whole app and leave the user staring at a stuck splash.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = toError(error);
    console.error("[RouteErrorBoundary]", e.message, info);

    // Auto-recover from chunk-load failures (most common cause: a deploy
    // shipped new chunk hashes while the user's tab still references the
    // old ones, OR the StaleWhileRevalidate service worker served a
    // cached chunk whose imports no longer exist on the server). Reload
    // ONCE per session — guarded by sessionStorage to prevent infinite
    // refresh loops if reload doesn't fix the underlying issue.
    const isChunkError =
      /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
        e.message,
      );
    if (isChunkError) {
      const KEY = "__chunk_reload_attempted_at";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        // Best-effort: blow away the SW asset cache before reloading so
        // the freshly fetched HTML pulls real chunks, not stale ones.
        if ("caches" in window) {
          caches.delete("asset-chunks").catch(() => {});
        }
        // Small delay so the boundary's UI can paint a hint before the
        // reload, in case it takes a moment.
        setTimeout(() => window.location.reload(), 300);
      }
    }
  }

  reload = () => {
    if ("caches" in window) {
      caches.delete("asset-chunks").catch(() => {});
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isChunkError =
      /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
        this.state.error.message,
      );

    return (
      <div
        dir="rtl"
        className="min-h-[60vh] flex items-center justify-center p-6"
      >
        <div className="max-w-md w-full text-center space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <div className="text-2xl">⚠️</div>
          <h2 className="text-lg font-semibold">
            {isChunkError ? "تعذّر تحميل هذا الجزء من التطبيق" : "حدث خطأ غير متوقع"}
          </h2>
          <p className="text-sm text-muted-foreground leading-6">
            {isChunkError
              ? "جارٍ إعادة التحميل تلقائياً... إذا لم يحدث شيء خلال ثانية، اضغط الزر بالأسفل."
              : this.state.error.message}
          </p>
          <button
            onClick={this.reload}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            إعادة التحميل
          </button>
        </div>
      </div>
    );
  }
}

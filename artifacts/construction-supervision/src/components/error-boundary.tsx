import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Catches errors thrown during rendering, in lifecycle methods, and
 * (importantly) failures of `React.lazy(() => import(...))`. Without this
 * boundary, a single chunk-load failure on a flaky mobile network would
 * blank the whole app and leave the user staring at a stuck splash.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", error, info);
  }

  reload = () => {
    // Hard reload — clears module cache and SW-served stale chunks.
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
              ? "يبدو أن الاتصال انقطع أثناء التحميل. تحقق من الإنترنت ثم أعد المحاولة."
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

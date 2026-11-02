/**
 * One visible/online polling lifecycle. No timers in hidden tabs, no overlap,
 * one catch-up on return when due. Caller owns cleanup (including HMR).
 */
export function installVisiblePolling(run: () => Promise<unknown>, intervalMs: number, immediate = true): () => void {
  let disposed = false;
  let pending = false;
  let last = immediate ? -Infinity : Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const active = () => !disposed && document.visibilityState !== "hidden" && navigator.onLine;
  const check = async () => {
    if (!active() || pending || Date.now() - last < intervalMs) return;
    pending = true;
    last = Date.now();
    try { await run(); } catch { /* Caller retains its own error/queue state. */ }
    finally { pending = false; }
  };
  const update = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (active()) {
      void check();
      timer = setInterval(() => { void check(); }, intervalMs);
    }
  };
  document.addEventListener("visibilitychange", update);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", update);
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AutomaticNoticeQueue, ElapsedCountdown } from "@/lib/automatic-notices";

const NoticeContext = createContext<AutomaticNoticeQueue | null>(null);

export function AutomaticNoticeProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new AutomaticNoticeQueue());
  useEffect(() => () => queue.clear(), [queue]);
  return <NoticeContext.Provider value={queue}>{children}</NoticeContext.Provider>;
}

export function useAutomaticNoticeSlot(requested: boolean, scope: number): boolean {
  const queue = useContext(NoticeContext);
  if (!queue) throw new Error("Automatic notices require their provider");
  const id = `${useId()}:${scope}`;
  const activeId = useSyncExternalStore(queue.subscribe, queue.getActive, () => null);
  useEffect(() => {
    if (!requested) return;
    queue.request(id);
    return () => queue.release(id);
  }, [queue, id, requested]);
  return requested && activeId === id;
}

export function useAutoCloseCountdown(visible: boolean, paused: boolean, onExpire: () => void, durationMs = 10_000) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const clock = useRef(new ElapsedCountdown(durationMs));
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    const timer = clock.current;
    if (!visible) {
      timer.reset();
      setRemainingMs(durationMs);
      return;
    }
    if (paused) {
      timer.pause();
      setRemainingMs(timer.remaining());
      return;
    }
    timer.resume();
    const tick = () => {
      const remaining = timer.remaining();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        window.clearInterval(interval);
        expire.current();
      }
    };
    const interval = window.setInterval(tick, 100);
    tick();
    return () => {
      window.clearInterval(interval);
      timer.pause();
    };
  }, [visible, paused, durationMs]);
  return remainingMs;
}

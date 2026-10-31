/** FIFO coordination without changing any notice's permission or dismissal rules. */
export class AutomaticNoticeQueue {
  private ids: string[] = [];
  private listeners = new Set<() => void>();
  getActive = () => this.ids[0] ?? null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  request(id: string) {
    if (this.ids.includes(id)) return;
    this.ids.push(id);
    this.notify();
  }
  release(id: string) {
    const next = this.ids.filter(value => value !== id);
    if (next.length === this.ids.length) return;
    this.ids = next;
    this.notify();
  }
  clear() {
    this.ids = [];
    this.notify();
  }
  private notify() {
    this.listeners.forEach(listener => listener());
  }
}

/** Timer ticks refresh the display; elapsed time, not tick count, spends the budget. */
export class ElapsedCountdown {
  private budget: number;
  private startedAt: number | null = null;
  constructor(private durationMs: number, private now = () => performance.now()) {
    this.budget = durationMs;
  }
  reset() {
    this.budget = this.durationMs;
    this.startedAt = null;
  }
  remaining() {
    return Math.max(0, this.budget - (this.startedAt === null ? 0 : Math.max(0, this.now() - this.startedAt)));
  }
  resume() {
    if (this.startedAt === null && this.budget > 0) this.startedAt = this.now();
  }
  pause() {
    this.budget = this.remaining();
    this.startedAt = null;
  }
}

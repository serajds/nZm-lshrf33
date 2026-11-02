import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export type RequestMetrics = { queries: number; queryMs: number; poolWaitMs: number; phases: Record<string, number> };
export const requestMetrics = new AsyncLocalStorage<RequestMetrics>();
export const newRequestMetrics = (): RequestMetrics => ({ queries: 0, queryMs: 0, poolWaitMs: 0, phases: {} });
export async function measurePhase<T>(name: string, run: () => Promise<T>): Promise<T> {
  const metrics = requestMetrics.getStore();
  const start = performance.now();
  try { return await run(); }
  finally { if (metrics) metrics.phases[name] = (metrics.phases[name] ?? 0) + performance.now() - start; }
}

// Instrument the pg boundary, including transactions. Never retain SQL, values,
// credentials or user data. Query time includes PostgreSQL execution/network;
// connection acquisition is measured separately (not a claim of server CPU).
export function instrumentPool(pool: any): void {
  const connect = pool.connect;
  const instrumented = new WeakSet<object>();
  pool.connect = function(callback?: (...args: any[]) => void) {
    const metrics = requestMetrics.getStore();
    const start = performance.now();
    const attach = (client: any) => {
      if (metrics) metrics.poolWaitMs += performance.now() - start;
      if (!client || instrumented.has(client)) return client;
      instrumented.add(client);
      const query = client.query;
      client.query = function(...args: any[]) {
        const current = requestMetrics.getStore();
        const began = performance.now();
        if (current) current.queries++;
        const done = () => { if (current) current.queryMs += performance.now() - began; };
        const last = args.length - 1;
        if (typeof args[last] === "function") {
          const cb = args[last];
          args[last] = (...values: any[]) => { done(); cb(...values); };
          try { return query.apply(this, args); } catch (error) { done(); throw error; }
        }
        try {
          const result = query.apply(this, args);
          if (result?.then) return result.finally(done);
          done();
          return result;
        } catch (error) { done(); throw error; }
      };
      return client;
    };
    if (callback) return connect.call(this, AsyncResource.bind((error: any, client: any, release: any) => {
      callback(error, attach(client), release);
    }));
    return connect.call(this).then(attach);
  };
}

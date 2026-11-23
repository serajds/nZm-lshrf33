import { randomUUID } from "node:crypto";
import type { ReportImageOptimizationItem } from "@workspace/db";

export type ReportImageOptimizationStatus =
  | "running"
  | "completed"
  | "completed_with_errors";

export type ReportImageOptimizationJob = {
  id: string;
  projectId: number;
  status: ReportImageOptimizationStatus;
  total: number;
  processed: number;
  optimized: number;
  skipped: number;
  failed: number;
  current: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
};

export type ReportImageOptimizationJobRecord = ReportImageOptimizationJob & {
  items: ReportImageOptimizationItem[];
  nextIndex: number;
  leaseOwner: string | null;
};

export type OptimizeResult = "optimized" | "skipped";

export type ReportImageOptimizationJobStore = {
  start(projectId: number, items: ReportImageOptimizationItem[]): Promise<{
    job: ReportImageOptimizationJob | null;
    blockedByOtherProject: boolean;
  }>;
  claim(workerId: string): Promise<ReportImageOptimizationJobRecord | null>;
  getOwned(jobId: string, workerId: string): Promise<ReportImageOptimizationJobRecord | null>;
  setCurrent(jobId: string, workerId: string, filename: string): Promise<void>;
  renewLease(jobId: string, workerId: string): Promise<void>;
  advance(jobId: string, workerId: string, result: OptimizeResult | "failed"): Promise<void>;
  finish(jobId: string, workerId: string, status: ReportImageOptimizationStatus): Promise<void>;
  getLatest(projectId: number): Promise<ReportImageOptimizationJob | null>;
};

type JobWorker = (projectId: number, item: ReportImageOptimizationItem) => Promise<OptimizeResult>;

const LEASE_HEARTBEAT_MS = 30 * 1000;
const POLL_INTERVAL_MS = 30_000;

export function createReportImageOptimizationJobs(
  store: ReportImageOptimizationJobStore,
  worker: JobWorker,
  options: { autoStart?: boolean; pollIntervalMs?: number } = {},
) {
  const workerId = randomUUID();
  let localWorkerBusy = false;
  let lastWorkerErrorAt = 0;

  async function processClaimedJob(initial: ReportImageOptimizationJobRecord): Promise<void> {
    while (true) {
      const row = await store.getOwned(initial.id, workerId);
      if (!row) return;

      if (row.nextIndex >= row.items.length) {
        await store.finish(
          row.id,
          workerId,
          row.failed > 0 ? "completed_with_errors" : "completed",
        );
        return;
      }

      const item = row.items[row.nextIndex];
      await store.setCurrent(row.id, workerId, item.filename);
      const heartbeat = setInterval(() => {
        void store.renewLease(row.id, workerId).catch(() => undefined);
      }, LEASE_HEARTBEAT_MS);
      heartbeat.unref?.();

      let result: OptimizeResult | "failed" = "skipped";
      try {
        result = await worker(row.projectId, item);
      } catch (error) {
        result = "failed";
        const now = Date.now();
        if (now - lastWorkerErrorAt > 30_000) {
          console.warn("Report image optimization item failed", {
            projectId: row.projectId,
            jobId: row.id,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          lastWorkerErrorAt = now;
        }
      } finally {
        clearInterval(heartbeat);
      }
      await store.advance(row.id, workerId, result);
    }
  }

  async function runOnce(): Promise<void> {
    if (localWorkerBusy) return;
    localWorkerBusy = true;
    try {
      const row = await store.claim(workerId);
      if (row) await processClaimedJob(row);
    } catch (error) {
      const now = Date.now();
      if (now - lastWorkerErrorAt > 30_000) {
        console.error("Report image optimization worker could not continue", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        lastWorkerErrorAt = now;
      }
    } finally {
      localWorkerBusy = false;
    }
  }

  if (options.autoStart !== false) {
    const poller = setInterval(() => void runOnce(), options.pollIntervalMs ?? POLL_INTERVAL_MS);
    poller.unref?.();
    void runOnce();
  }

  return {
    async start(projectId: number, items: ReportImageOptimizationItem[]) {
      const result = await store.start(projectId, items);
      if (options.autoStart !== false) void runOnce();
      return result;
    },
    get: (projectId: number) => store.getLatest(projectId),
    runOnce,
  };
}

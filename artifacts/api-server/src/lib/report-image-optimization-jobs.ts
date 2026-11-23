import { randomUUID } from "node:crypto";

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

type OptimizeResult = "optimized" | "skipped";
type JobWorker = (filename: string) => Promise<OptimizeResult>;

export function createReportImageOptimizationJobs() {
  const jobs = new Map<number, ReportImageOptimizationJob>();
  let activeProjectId: number | null = null;

  const copy = (job: ReportImageOptimizationJob): ReportImageOptimizationJob => ({ ...job });

  const start = (projectId: number, filenames: string[], worker: JobWorker) => {
    const existing = jobs.get(projectId);
    if (existing?.status === "running") {
      return { started: false as const, job: copy(existing), blockedByOtherProject: false };
    }
    if (activeProjectId !== null && activeProjectId !== projectId) {
      return {
        started: false as const,
        job: null,
        blockedByOtherProject: true,
      };
    }

    const job: ReportImageOptimizationJob = {
      id: randomUUID(),
      projectId,
      status: "running",
      total: filenames.length,
      processed: 0,
      optimized: 0,
      skipped: 0,
      failed: 0,
      current: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null,
    };
    jobs.set(projectId, job);
    activeProjectId = projectId;

    void (async () => {
      for (const filename of filenames) {
        job.current = filename;
        try {
          const result = await worker(filename);
          if (result === "optimized") job.optimized += 1;
          else job.skipped += 1;
        } catch (error) {
          job.failed += 1;
          job.lastError = "تعذّر تجهيز صورة واحدة أو أكثر؛ أعد المحاولة";
        } finally {
          job.processed += 1;
        }
      }
      job.current = null;
      job.status = job.failed > 0 ? "completed_with_errors" : "completed";
      job.finishedAt = new Date().toISOString();
      activeProjectId = null;
    })();

    return { started: true as const, job: copy(job), blockedByOtherProject: false };
  };

  return {
    start,
    get(projectId: number) {
      const job = jobs.get(projectId);
      return job ? copy(job) : null;
    },
    getActiveProjectId() {
      return activeProjectId;
    },
  };
}

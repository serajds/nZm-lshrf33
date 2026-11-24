import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { isolatedWorkerEnvironment } from "./worker-environment";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  IMAGE_PROCESSING_CONCURRENCY, IMAGE_PROCESSING_MAX_PENDING,
  type ImageProfile, type ImageProcessingException,
} from "@workspace/api-zod/image-policy";

export class ImageProcessingError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}
export type ProcessedImage = {
  buffer: Buffer; profile: ImageProfile; policyVersion: number;
  mimeType: string; byteSize: number; width: number; height: number;
  exception: ImageProcessingException | null; reused: boolean;
  inputBytes: number; encodes: number; metadataMs: number; encodeMs: number; elapsedMs: number;
  workerBootMs: number; workerWallMs: number; workerPeakRss: number | null;
};
type Job = {
  principal: string; sourcePath: string; profile: ImageProfile; format?: "jpeg"; prepared?: boolean; signal?: AbortSignal;
  resolve: (image: ProcessedImage) => void; reject: (error: unknown) => void; onAbort: () => void;
};

/**
 * The shared processing executor. One active job per principal; bounded total
 * workers and pending jobs. The API passes file paths, never many image buffers
 * waiting in RAM. Cross-instance admission must be acquired by the caller
 * before request parsing/processing; this is not a replacement for that lease.
 */
export function createImageProcessor(options: { workerPath?: string; timeoutMs?: number; rssLimitBytes?: number } = {}) {
  const compiledSibling = fileURLToPath(new URL("./image-processing-worker.mjs", import.meta.url));
  const workerPath = options.workerPath ?? (existsSync(compiledSibling) ? compiledSibling
    : fileURLToPath(new URL("../../dist/image-processing-worker.mjs", import.meta.url)));
  const queue: Job[] = [];
  const principals = new Set<string>();
  let active = 0;
  const run = () => {
    while (active < IMAGE_PROCESSING_CONCURRENCY) {
      const index = queue.findIndex(job => !principals.has(job.principal));
      if (index < 0) return;
      const job = queue.splice(index, 1)[0]!;
      job.signal?.removeEventListener("abort", job.onAbort);
      if (job.signal?.aborted) { job.reject(new ImageProcessingError("cancelled")); continue; }
      active++;
      principals.add(job.principal);
      const finish = () => {
        active--; principals.delete(job.principal); run();
      };
      void execute(job).then(image => { finish(); job.resolve(image); }, error => { finish(); job.reject(error); });
    }
  };
  async function execute(job: Job): Promise<ProcessedImage> {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "image-process-"));
    try {
      return await new Promise<ProcessedImage>((resolve, reject) => {
        const began = performance.now();
        const child = fork(workerPath, [], {
          stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: ["--max-old-space-size=128"],
          env: isolatedWorkerEnvironment(),
        });
        let result: (Omit<ProcessedImage, "buffer" | "workerBootMs" | "workerWallMs" | "workerPeakRss"> & { ok: boolean; filename: string; code?: string }) | null = null;
        let reason: ImageProcessingError | null = null;
        let inspecting = false, workerBootMs = 0, peakRss = 0;
        const abort = () => { reason = new ImageProcessingError("cancelled"); child.kill("SIGKILL"); };
        const deadline = setTimeout(() => {
          reason = new ImageProcessingError("processing_timeout", true); child.kill("SIGKILL");
        }, options.timeoutMs ?? 30_000);
        const sampler = setInterval(() => {
          if (inspecting) return;
          inspecting = true;
          void readFile(`/proc/${child.pid}/status`, "utf8").then(status => {
            const rss = Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) * 1024;
            peakRss = Math.max(peakRss, rss);
            if (rss > (options.rssLimitBytes ?? 350 * 1024 * 1024)) {
              reason = new ImageProcessingError("processing_memory_limit", true); child.kill("SIGKILL");
            }
          }).catch(() => undefined).finally(() => { inspecting = false; });
        }, 25);
        const cleanup = () => {
          clearTimeout(deadline); clearInterval(sampler); job.signal?.removeEventListener("abort", abort);
        };
        job.signal?.addEventListener("abort", abort, { once: true });
        child.on("message", message => {
          const packet = message as { kind?: string; ok?: boolean };
          if (packet.kind === "ready") workerBootMs = performance.now() - began;
          else if (typeof packet.ok === "boolean") result = message as typeof result;
        });
        child.once("error", () => { cleanup(); reject(new ImageProcessingError("worker_start_failed", true)); });
        child.once("exit", () => {
          cleanup();
          if (reason) return reject(reason);
          if (!result?.ok) return reject(new ImageProcessingError(result?.code ?? "worker_interrupted", !result));
          if (!/^image\.(?:jpg|png|webp)$/.test(result.filename)) return reject(new ImageProcessingError("invalid_worker_output"));
          const data = result;
          void readFile(path.join(outputDir, data.filename)).then(buffer => {
            if (buffer.length !== data.byteSize) throw new ImageProcessingError("output_size_mismatch");
            const { filename: _filename, ok: _ok, code: _code, ...metadata } = data;
            resolve({ ...metadata, buffer, workerBootMs, workerWallMs: performance.now() - began, workerPeakRss: peakRss || null });
          }).catch(reject);
        });
        if (job.signal?.aborted) abort();
        else child.send({ sourcePath: job.sourcePath, profile: job.profile, format: job.format, prepared: job.prepared, outputDir });
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
  return {
    process(input: { principal: string; sourcePath: string; profile: ImageProfile; format?: "jpeg"; prepared?: boolean; signal?: AbortSignal }): Promise<ProcessedImage> {
      if (input.signal?.aborted) return Promise.reject(new ImageProcessingError("cancelled"));
      if (queue.length >= IMAGE_PROCESSING_MAX_PENDING || queue.filter(job => job.principal === input.principal).length >= 3) {
        return Promise.reject(new ImageProcessingError("processing_busy", true));
      }
      return new Promise((resolve, reject) => {
        const job: Job = { ...input, resolve, reject, onAbort: () => {
          const index = queue.indexOf(job);
          if (index >= 0) { queue.splice(index, 1); reject(new ImageProcessingError("cancelled")); }
        } };
        input.signal?.addEventListener("abort", job.onAbort, { once: true });
        queue.push(job); run();
      });
    },
    getStatus: () => ({ active, pending: queue.length, principals: principals.size }),
  };
}

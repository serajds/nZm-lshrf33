import type { RequestHandler, Response } from "express";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";
import { createImageUploadAdmission, type ImageProcessingLease } from "./image-processing-admission";
import { ImageProcessingError } from "./image-processing";
import { sendImageUploadError } from "./image-upload-errors";

export type ImageUploadRequest = {
  signal: AbortSignal;
  lease: ImageProcessingLease;
  trackIncoming: (filename: string) => void;
  run: <T>(action: () => Promise<T>) => Promise<T>;
};
export function imageUploadRequest(res: Response): ImageUploadRequest | null {
  return (res.locals.imageUploadRequest as ImageUploadRequest | undefined) ?? null;
}

/**
 * Mount after current-role/project authorization and BEFORE a body parser.
 * A disconnected request cancels work but keeps its global lease until the
 * actual child/storage operation settles. Only owned incoming files are
 * eligible for this request's cleanup.
 */
export function createImageUploadRequestMiddleware(options: {
  temporaryRoot: string;
  admission?: ReturnType<typeof createImageUploadAdmission>;
}): RequestHandler {
  const admission = options.admission ?? createImageUploadAdmission(pool);
  const temporaryRoot = path.resolve(options.temporaryRoot);
  return async (req, res, next) => {
    if (imageUploadRequest(res)) { next(); return; }
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "يجب تسجيل الدخول" }); return; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once("aborted", abort);
    res.once("close", abort);
    if (req.aborted || res.destroyed) controller.abort();
    let lease: ImageProcessingLease;
    try { lease = await admission.acquire(`user:${userId}`, controller.signal); }
    catch (error) {
      req.removeListener("aborted", abort); res.removeListener("close", abort);
      sendImageUploadError(res, error); return;
    }
    const leaseLost = () => {
      controller.abort();
      // Stop raw-body/multipart reception too, not merely later CPU work.
      if (!res.writableEnded) req.destroy();
    };
    lease.signal.addEventListener("abort", leaseLost, { once: true });
    if (lease.signal.aborted) leaseLost();
    if (controller.signal.aborted || res.destroyed) {
      req.removeListener("aborted", abort); res.removeListener("close", abort);
      lease.signal.removeEventListener("abort", leaseLost);
      await lease.release(); return;
    }
    const held = new Set<Promise<unknown>>(), incoming = new Set<string>();
    let settling: Promise<void> | null = null;
    const settle = () => {
      if (settling) return;
      // Assignment happens before any asynchronous release/cleanup.
      settling = (async () => {
        await Promise.allSettled([...held]);
        try {
          for (const filename of incoming) await unlink(filename).catch(error => {
            if (error.code !== "ENOENT") throw error;
          });
        } finally {
          req.removeListener("aborted", abort); res.removeListener("close", abort);
          lease.signal.removeEventListener("abort", leaseLost);
          await lease.release();
        }
      })();
      void settling.catch(() => { req.log?.warn("Image request cleanup did not finish"); });
    };
    res.once("finish", settle);
    res.once("close", settle);
    res.locals.imageUploadRequest = {
      signal: controller.signal, lease,
      trackIncoming(filename) {
        const absolute = path.resolve(filename);
        const basename = path.basename(absolute);
        if (path.dirname(absolute) !== temporaryRoot
          || (!/^incoming-image-[a-f0-9-]{36}(?:\.[a-z0-9]{1,8})?$/i.test(basename)
            && !/^logo-\d+-\d+\.(?:jpe?g|png|svg|webp|gif)$/i.test(basename))) {
          throw new ImageProcessingError("invalid_temporary_image_path");
        }
        incoming.add(absolute);
      },
      run<T>(action: () => Promise<T>): Promise<T> {
        if (settling || controller.signal.aborted) return Promise.reject(new ImageProcessingError("cancelled"));
        const promise = Promise.resolve().then(action);
        held.add(promise);
        // Use both callbacks, not an unobserved rejecting .finally promise.
        void promise.then(() => held.delete(promise), () => held.delete(promise));
        return promise;
      },
    } satisfies ImageUploadRequest;
    next();
  };
}

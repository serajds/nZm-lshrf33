import { createReadStream } from "node:fs";
import { stat, open, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { pool, measurePhase, requestMetrics } from "@workspace/db";
import { IMAGE_SOURCE_MAX_BYTES, IMAGE_PROFILES, hasSupportedImageSignature, isReportImageProfile, type ImageProfile, type ImageReference } from "@workspace/api-zod";
import { imageAssetStore, type ImageAssetTransaction } from "./image-asset-store";
import { imageAssetObjectKeys, imageObjectName } from "./image-asset-keys";
import { createImageProcessor, ImageProcessingError, type ProcessedImage } from "./image-processing";
import { createImageProcessingAdmission, createImageUploadAdmission, type ImageProcessingLease } from "./image-processing-admission";
import { uploadBufferToCloud, verifyUploadObject, deleteImageObjectStrict } from "./fileStorage";

type Asset = NonNullable<Awaited<ReturnType<typeof imageAssetStore.get>>>;
type ReadyImage = {
  image: ImageReference; fileUrl: string; projectFileId: number | null;
  exceptions: Array<{ variant: string; code: string }>;
};
type UploadInput = {
  /** Verified server identity and authorized target, never body-supplied roles. */
  principal: string; authorizedScope: string; clientKey: string;
  userId: number | null; projectId: number | null; profile: ImageProfile; sourcePath: string;
  signal?: AbortSignal; lease?: ImageProcessingLease;
  prepared?: boolean; format?: "jpeg"; thumbnailSourcePath?: string; printSourcePath?: string;
  /** Database writes only. It runs exactly with the fenced ready transaction. */
  onCommit?: (tx: ImageAssetTransaction, asset: Asset) => Promise<number | null>;
};
const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
function workerMetrics(variant: string, image: ProcessedImage) {
  const metrics = requestMetrics.getStore();
  if (!metrics) return;
  for (const [name, ms] of [
    ["read_and_metadata", image.metadataMs], ["encode_and_write", image.encodeMs], ["worker_boot", image.workerBootMs],
  ] as const) metrics.phases[`image.${variant}.${name}`] = (metrics.phases[`image.${variant}.${name}`] ?? 0) + ms;
}
export function readyImageFromAsset(row: Asset): ReadyImage {
  if (row.state !== "ready" || !row.storageKey) throw new ImageProcessingError("image_not_ready", true);
  return {
    image: {
      id: row.id, profile: row.profile as ImageProfile, policyVersion: row.policyVersion,
      state: "ready", storageKey: row.storageKey, thumbnailKey: row.thumbnailKey, printKey: row.printKey,
      mimeType: row.mimeType, byteSize: row.byteSize, width: row.width, height: row.height,
    },
    fileUrl: `/api/uploads/${imageObjectName(row.storageKey)}`, projectFileId: row.projectFileId, exceptions: row.exceptions,
  };
}
const storage = { upload: uploadBufferToCloud, verify: verifyUploadObject, delete: deleteImageObjectStrict };

/**
 * The single lifecycle coordinator. No HTTP response, source-buffer persistence,
 * local-only success, inline-image fields, role changes or read-time conversion.
 * Consumers retain their existing authorization and commit reference changes
 * in onCommit; callers own and remove their temporary incoming source file.
 */
export function createImageLifecycle(options: {
  processor?: ReturnType<typeof createImageProcessor>;
  admission?: ReturnType<typeof createImageProcessingAdmission>;
  nativeAdmission?: ReturnType<typeof createImageProcessingAdmission>;
  store?: typeof imageAssetStore; storage?: typeof storage;
  bucketId?: string;
} = {}) {
  const processor = options.processor ?? createImageProcessor();
  const admission = options.admission ?? createImageUploadAdmission(pool);
  const nativeAdmission = options.nativeAdmission ?? createImageProcessingAdmission(pool);
  async function processImage(input: Parameters<typeof processor.process>[0]) {
    let lease: ImageProcessingLease;
    for (;;) {
      try { lease = await nativeAdmission.acquire(input.principal, input.signal); break; }
      catch (error) {
        if (!(error instanceof ImageProcessingError)
          || !["principal_image_busy", "image_capacity_busy"].includes(error.code)) throw error;
        try { await delay(80, undefined, { signal: input.signal }); }
        catch { throw new ImageProcessingError("cancelled"); }
      }
    }
    try {
      return await processor.process({ ...input, signal: AbortSignal.any([lease.signal, ...(input.signal ? [input.signal] : [])]) });
    } catch (error) {
      if (lease.signal.aborted && !input.signal?.aborted) throw new ImageProcessingError("image_admission_lost", true);
      throw error;
    } finally { await lease.release(); }
  }
  const store = options.store ?? imageAssetStore;
  // Explicitly separate development storage, without rewriting application
  // defaults. Production retains its configured bucket after a separate deploy.
  const bucketId = options.bucketId ?? (process.env.NODE_ENV === "production"
    ? process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID : process.env.IMAGE_AUDIT_BUCKET_ID);
  const objects: typeof storage = options.storage ?? {
    upload: (name, buffer, mimeType, settings) => uploadBufferToCloud(name, buffer, mimeType, { ...settings, bucketId }),
    verify: (name, expected, signal) => verifyUploadObject(name, expected, signal, bucketId),
    delete: name => deleteImageObjectStrict(name, bucketId),
  };
  return {
    async upload(input: UploadInput): Promise<ReadyImage> {
      if (input.signal?.aborted) throw new ImageProcessingError("cancelled");
      if (!bucketId) throw new ImageProcessingError("image_storage_unconfigured");
      if (input.lease && input.lease.principal !== input.principal) throw new ImageProcessingError("image_lease_principal_mismatch");
      if (input.lease && input.lease.kind !== "upload") throw new ImageProcessingError("image_lease_kind_mismatch");
      const hash = createHash("sha256");
      const hasReportVariants = isReportImageProfile(input.profile);
      const needsThumbnail = hasReportVariants || input.profile === "file_image";
      hash.update(`image-input-set-v1\0${input.profile}\0${input.format ?? "default"}\0${!!input.prepared}\0`);
      const sources: Array<[string, string | undefined, number]> = [
        ["primary", input.sourcePath, input.prepared ? IMAGE_PROFILES[input.profile].maxOutputBytes : IMAGE_SOURCE_MAX_BYTES],
        ["thumbnail", input.thumbnailSourcePath, IMAGE_PROFILES.thumbnail.maxOutputBytes],
        ["print", input.printSourcePath, hasReportVariants ? IMAGE_PROFILES[input.profile].maxOutputBytes : IMAGE_PROFILES.report.maxOutputBytes],
      ];
      for (const [variant, filename, maxBytes] of sources) {
        hash.update(`${variant}\0`);
        if (!filename) { hash.update("absent\0"); continue; }
        const info = await stat(filename);
        if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new ImageProcessingError("source_size_limit");
        hash.update(`${info.size}\0`);
        const header = await open(filename, "r");
        try {
          const bytes = Buffer.alloc(Math.min(4096, info.size));
          const { bytesRead } = await header.read(bytes, 0, bytes.length, 0);
          if (!hasSupportedImageSignature(bytes.subarray(0, bytesRead))) throw new ImageProcessingError("unsupported_format");
        } finally { await header.close(); }
        for await (const chunk of createReadStream(filename)) {
          if (input.signal?.aborted) throw new ImageProcessingError("cancelled");
          hash.update(chunk);
        }
      }
      const claim = await store.claim({
        scope: `${input.principal}:${input.authorizedScope}`, clientKey: input.clientKey,
        sourceSha256: hash.digest("hex"), profile: input.profile, projectId: input.projectId, userId: input.userId,
      });
      if (claim.kind === "ready") return readyImageFromAsset(claim.asset);
      if (claim.kind === "in_progress") throw new ImageProcessingError("image_in_progress", true);
      if (claim.kind === "failed") throw new ImageProcessingError(claim.asset.errorCode ?? "image_failed");
      const { id, attemptToken } = claim.asset;
      let lease = input.lease, temporary: string | undefined, processingSignal: AbortSignal | undefined;
      const verifiedKeys: string[] = [];
      try {
        lease ??= await admission.acquire(input.principal, input.signal);
        const signal = AbortSignal.any([
          lease.signal, ...(input.signal ? [input.signal] : []), AbortSignal.timeout(90_000),
        ]);
        processingSignal = signal;
        const primary = await measurePhase("image.primary.total", () => processImage({
          principal: input.principal, sourcePath: input.sourcePath, profile: input.profile, format: input.format, prepared: input.prepared, signal,
        }));
        workerMetrics("primary", primary);
        const primaryIsPrint = hasReportVariants && primary.mimeType === "image/jpeg" && !input.printSourcePath;
        const keys = imageAssetObjectKeys(id, attemptToken, primary.mimeType, input.format === "jpeg" ? "image/jpeg" : "image/webp", primaryIsPrint);
        const outputs: Array<{ variant: string; key: string; data: ProcessedImage }> = [
          { variant: "primary", key: keys.primary, data: primary },
        ];
        if (needsThumbnail) {
          // Derivatives use the bounded, metadata-free normalized image, not a
          // second giant source decode. The JPEG print companion is prepared
          // here, never generated during preview/print reads.
          temporary = await mkdtemp(path.join(os.tmpdir(), "image-derivatives-"));
          const normalized = path.join(temporary, "normalized");
          await writeFile(normalized, primary.buffer);
          const thumbnail = await measurePhase("image.thumbnail.total", () => processImage({
            principal: input.principal, sourcePath: input.thumbnailSourcePath ?? normalized,
            profile: "thumbnail", format: input.format, prepared: !!input.thumbnailSourcePath && input.prepared, signal,
          }));
          workerMetrics("thumbnail", thumbnail);
          outputs.push({
            variant: "thumbnail", key: keys.thumbnail,
            data: thumbnail,
          });
          if (hasReportVariants) {
            const print = primaryIsPrint ? primary : await measurePhase("image.print.total", () => processImage({
              principal: input.principal, sourcePath: input.printSourcePath ?? normalized,
              profile: input.profile, format: "jpeg", prepared: !!input.printSourcePath && input.prepared, signal,
            }));
            workerMetrics("print", print);
            outputs.push({
              variant: "print", key: keys.print,
              data: print,
            });
          }
        }
        await store.markUploading(id, attemptToken, {
          storageKey: keys.primary, storageBucket: bucketId, thumbnailKey: needsThumbnail ? keys.thumbnail : null,
          printKey: hasReportVariants ? keys.print : null,
          mimeType: primary.mimeType, byteSize: primary.byteSize, width: primary.width, height: primary.height,
          exceptions: [
            ...(input.profile === "report_technical"
              ? [{ variant: "primary", code: "user_declared_technical_detail" }]
              : []),
            ...outputs.flatMap(output => output.data.exception ? [{ variant: output.variant, code: output.data.exception }] : []),
          ],
        });
        for (const output of outputs) {
          if (verifiedKeys.includes(output.key)) continue; // JPEG primary/print may intentionally share bytes/key.
          signal.throwIfAborted();
          const name = imageObjectName(output.key);
          const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
          const expected = { byteSize: output.data.byteSize, mimeType: output.data.mimeType, sha256: sha256(output.data.buffer) };
          let verified = false;
          try {
            await measurePhase(`image.${output.variant}.storage_put`, () =>
              objects.upload(name, output.data.buffer, output.data.mimeType, {
                signal: deadline, createOnly: true, expectedSha256: expected.sha256,
              }));
          } catch {
            // A lost storage acknowledgement may still have persisted the
            // object. Verify its exact bytes rather than writing a duplicate.
            await measurePhase(`image.${output.variant}.storage_verify`, () => objects.verify(name, expected, deadline));
            verified = true;
          }
          if (!verified) await measurePhase(`image.${output.variant}.storage_verify`, () => objects.verify(name, expected, deadline));
          verifiedKeys.push(output.key);
        }
        signal.throwIfAborted();
        return readyImageFromAsset(await measurePhase("image.commit", () => store.markReady(id, attemptToken, input.onCommit)));
      } catch (error) {
        // COMMIT may have succeeded even when its acknowledgement was lost.
        // Unknown DB state is never permission to delete an uploaded object.
        let current: Asset | null;
        try { current = await store.get(id); }
        catch { throw new ImageProcessingError("image_commit_state_unknown", true); }
        if (current?.state === "ready" && current.attemptToken === attemptToken) return readyImageFromAsset(current);
        const leaseLost = lease?.signal.aborted && !input.signal?.aborted;
        const timedOut = processingSignal?.aborted && processingSignal.reason?.name === "TimeoutError" && !input.signal?.aborted && !leaseLost;
        const code = timedOut ? "image_deadline_exceeded" : leaseLost ? "image_admission_lost" : error instanceof ImageProcessingError ? error.code
          : input.signal?.aborted ? "cancelled" : "image_storage_or_commit_failed";
        const retryable = !!timedOut || leaseLost || (error instanceof ImageProcessingError ? error.retryable : code !== "cancelled");
        try {
          await store.fail(id, attemptToken, code, retryable || code === "cancelled");
          current = await store.get(id);
        } catch { throw new ImageProcessingError("image_commit_state_unknown", true); }
        if (current?.state === "ready" && current.attemptToken === attemptToken) return readyImageFromAsset(current);
        if (current && (current.attemptToken !== attemptToken || current.state === "failed")) {
          // Only this fenced attempt's verified objects. Uncertain remote
          // writes remain explicitly discoverable via cleanupPending/history.
          for (const key of verifiedKeys) {
            try { await objects.delete(imageObjectName(key)); } catch { /* persistent cleanupPending remains true */ }
          }
        }
        throw new ImageProcessingError(code, retryable);
      } finally {
        try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
        finally { if (lease && !input.lease) await lease.release(); }
      }
    },
  };
}

import { ImageProcessingError } from "./image-processing";
import { IMAGE_PROCESSING_CONCURRENCY, IMAGE_UPLOAD_CONCURRENCY, IMAGE_UPLOAD_PER_PRINCIPAL } from "@workspace/api-zod";

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: { acquired?: boolean }[] }>;
  release: (destroy?: boolean) => void;
  on: (event: "error", listener: () => void) => unknown;
  removeListener: (event: "error", listener: () => void) => unknown;
};
type Pool = { connect: () => Promise<Client> };
export type ImageProcessingLease = {
  principal: string;
  kind: "processing" | "upload";
  signal: AbortSignal;
  release: () => Promise<void>;
};

/**
 * Session-scoped PostgreSQL locks cover all API instances and workers using
 * the same database. A lost process/connection releases its locks. No polling,
 * long-running transaction, per-instance counter or permanent lock rows.
 *
 * Upload admission precedes parsing and lasts through durable storage.
 * Processing admission surrounds only native child work, not network waits.
 * The caller must cancel its child process if lease.signal aborts.
 */
export function createImageProcessingAdmission(pool: Pool) {
  return createAdmission(pool, { kind: "processing", namespace: 84631, global: IMAGE_PROCESSING_CONCURRENCY, perPrincipal: 1 });
}
export function createImageUploadAdmission(pool: Pool) {
  return createAdmission(pool, { kind: "upload", namespace: 84633, global: IMAGE_UPLOAD_CONCURRENCY, perPrincipal: IMAGE_UPLOAD_PER_PRINCIPAL });
}
function createAdmission(pool: Pool, policy: {
  kind: "processing" | "upload"; namespace: number; global: number; perPrincipal: number;
}) {
  return {
    async acquire(principal: string, signal?: AbortSignal): Promise<ImageProcessingLease> {
      if (!principal || principal.length > 200) throw new ImageProcessingError("invalid_principal");
      if (signal?.aborted) throw new ImageProcessingError("cancelled");
      const client = await pool.connect();
      const controller = new AbortController();
      const aborted = () => controller.abort();
      const lost = () => controller.abort();
      client.on("error", lost);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) controller.abort();
      let principalKey: string | null = null;
      let slot: number | null = null;
      let released = false;
      let failed = false;
      const release = async () => {
        if (released) return;
        released = true;
        try {
          if (slot !== null) await client.query("SELECT pg_advisory_unlock($1, $2)", [policy.namespace, slot]);
          if (principalKey !== null) await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))", [principalKey],
          );
        } catch { failed = true; controller.abort(); }
        finally {
          signal?.removeEventListener("abort", aborted);
          client.removeListener("error", lost);
          client.release(failed);
        }
      };
      try {
        if (controller.signal.aborted) throw new ImageProcessingError("cancelled");
        for (let candidate = 0; candidate < policy.perPrincipal; candidate++) {
          const key = policy.kind === "processing" ? `image-principal:${principal}` : `image-upload-principal:${principal}:${candidate}`;
          const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [key]);
          if (result.rows[0]?.acquired) { principalKey = key; break; }
        }
        if (principalKey === null) throw new ImageProcessingError("principal_image_busy", true);
        for (let candidate = 0; candidate < policy.global; candidate++) {
          const result = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [policy.namespace, candidate]);
          if (result.rows[0]?.acquired) { slot = candidate; break; }
        }
        if (slot === null) throw new ImageProcessingError("image_capacity_busy", true);
        if (controller.signal.aborted) throw new ImageProcessingError("cancelled");
        return { principal, kind: policy.kind, signal: controller.signal, release };
      } catch (error) {
        if (!(error instanceof ImageProcessingError)) failed = true;
        await release();
        throw error instanceof ImageProcessingError ? error : new ImageProcessingError("image_admission_unavailable", true);
      }
    },
  };
}

import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db, imageAssetsTable } from "@workspace/db";
import { IMAGE_CLIENT_KEY_PATTERN, IMAGE_POLICY_VERSION, IMAGE_PROFILES, isImageProfile, isReportImageProfile, type ImageProfile } from "@workspace/api-zod";
import { ImageProcessingError } from "./image-processing";
import { imageAssetObjectKeys } from "./image-asset-keys";

type Asset = typeof imageAssetsTable.$inferSelect;
export type ImageAssetTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Claim = {
  scope: string; clientKey: string; sourceSha256: string; profile: ImageProfile;
  projectId: number | null; userId: number | null;
};
export type ImageAssetClaim = { kind: "claimed" | "ready" | "in_progress" | "failed"; asset: Asset };
const claimDurationMs = 120_000;
const hasReportVariants = (profile: ImageProfile) => isReportImageProfile(profile);
const needsThumbnail = (profile: ImageProfile) => hasReportVariants(profile) || profile === "file_image";
const attemptWhere = (id: string, attemptToken: string) => and(
  eq(imageAssetsTable.id, id), eq(imageAssetsTable.attemptToken, attemptToken),
  inArray(imageAssetsTable.state, ["processing", "uploading"]),
);
const requireRow = (rows: Asset[]) => {
  if (!rows[0]) throw new ImageProcessingError("image_attempt_lost", true);
  return rows[0];
};

export const imageAssetStore = {
  /** scope/project/principal come from authorization, never an untrusted body. */
  async claim(input: Claim): Promise<ImageAssetClaim> {
    if (!isImageProfile(input.profile) || !/^[a-f0-9]{64}$/.test(input.sourceSha256)
      || !/^[A-Za-z0-9:._-]{1,200}$/.test(input.scope) || !IMAGE_CLIENT_KEY_PATTERN.test(input.clientKey)) {
      throw new ImageProcessingError("invalid_image_identity");
    }
    const now = new Date();
    const identity = and(eq(imageAssetsTable.scope, input.scope), eq(imageAssetsTable.clientKey, input.clientKey));
    const created = await db.insert(imageAssetsTable).values({
      ...input, policyVersion: IMAGE_POLICY_VERSION, state: "processing", primaryState: "pending",
      thumbnailState: needsThumbnail(input.profile) ? "pending" : "not_required",
      printState: hasReportVariants(input.profile) ? "pending" : "not_required",
      attemptToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + claimDurationMs),
    }).onConflictDoNothing().returning();
    if (created[0]) return { kind: "claimed", asset: created[0] };
    const [current] = await db.select().from(imageAssetsTable).where(identity);
    if (!current) throw new ImageProcessingError("image_identity_conflict", true);
    if (current.sourceSha256 !== input.sourceSha256 || current.profile !== input.profile
      || current.projectId !== input.projectId || current.userId !== input.userId) {
      throw new ImageProcessingError("idempotency_content_conflict");
    }
    if (current.state === "ready") return { kind: "ready", asset: current };
    if (current.state === "failed" && !current.retryable) return { kind: "failed", asset: current };
    if (current.state !== "failed" && current.leaseExpiresAt > now) return { kind: "in_progress", asset: current };
    const reclaimed = await db.update(imageAssetsTable).set({
      policyVersion: IMAGE_POLICY_VERSION,
      state: "processing", primaryState: "pending", thumbnailState: needsThumbnail(input.profile) ? "pending" : "not_required",
      printState: hasReportVariants(input.profile) ? "pending" : "not_required",
      attemptHistory: sql`${imageAssetsTable.attemptHistory} || CASE WHEN ${imageAssetsTable.storageKey} IS NOT NULL
        THEN jsonb_build_array(jsonb_build_object('attemptToken', ${imageAssetsTable.attemptToken},
          'storageBucket', ${imageAssetsTable.storageBucket},
          'storageKey', ${imageAssetsTable.storageKey}, 'thumbnailKey', ${imageAssetsTable.thumbnailKey}, 'printKey', ${imageAssetsTable.printKey}))
        ELSE '[]'::jsonb END`,
      attemptToken: randomUUID(), attemptCount: sql`${imageAssetsTable.attemptCount} + 1`,
      leaseExpiresAt: new Date(now.getTime() + claimDurationMs), updatedAt: now, errorCode: null, retryable: false,
      storageKey: null, storageBucket: null, thumbnailKey: null, printKey: null, mimeType: null, byteSize: null, width: null, height: null,
    }).where(and(identity, or(
      and(eq(imageAssetsTable.state, "failed"), eq(imageAssetsTable.retryable, true)),
      and(inArray(imageAssetsTable.state, ["processing", "uploading"]), lte(imageAssetsTable.leaseExpiresAt, now)),
    ))).returning();
    if (reclaimed[0]) return { kind: "claimed", asset: reclaimed[0] };
    const [latest] = await db.select().from(imageAssetsTable).where(identity);
    if (!latest) throw new ImageProcessingError("image_identity_conflict", true);
    return { kind: latest.state === "ready" ? "ready" : latest.state === "failed" ? "failed" : "in_progress", asset: latest };
  },
  async markUploading(id: string, attemptToken: string, output: {
    storageKey: string; storageBucket: string; thumbnailKey: string | null; printKey: string | null; mimeType: string; byteSize: number; width: number; height: number;
    exceptions?: Array<{ variant: string; code: string }>;
  }): Promise<Asset> {
    const keys = imageAssetObjectKeys(id, attemptToken, output.mimeType, output.thumbnailKey?.endsWith(".jpg") ? "image/jpeg" : "image/webp",
      output.mimeType === "image/jpeg" && output.printKey === output.storageKey
      && output.width <= IMAGE_PROFILES.report.maxEdge && output.height <= IMAGE_PROFILES.report.maxEdge);
    if (!output.storageBucket || output.storageBucket.length > 300
      || output.storageKey !== keys.primary || (output.thumbnailKey !== null && output.thumbnailKey !== keys.thumbnail)
      || (output.printKey !== null && output.printKey !== keys.print)
      || !["image/jpeg", "image/png", "image/webp"].includes(output.mimeType)
      || !Number.isSafeInteger(output.byteSize) || output.byteSize <= 0
      || !Number.isSafeInteger(output.width) || output.width <= 0 || !Number.isSafeInteger(output.height) || output.height <= 0) {
      throw new ImageProcessingError("invalid_image_output_reference");
    }
    return requireRow(await db.update(imageAssetsTable).set({
      ...output, state: "uploading", updatedAt: new Date(),
    }).where(and(attemptWhere(id, attemptToken), eq(imageAssetsTable.state, "processing"))).returning());
  },
  /** Caller must first verify durable primary AND required thumbnail objects. */
  async markReady(id: string, attemptToken: string, onCommit?: (tx: ImageAssetTransaction, asset: Asset) => Promise<number | null>): Promise<Asset> {
    return db.transaction(async tx => {
      let row = requireRow(await tx.update(imageAssetsTable).set({
      state: "ready", primaryState: "ready",
       thumbnailState: sql`CASE WHEN ${imageAssetsTable.profile} IN ('report', 'report_detail', 'report_technical', 'file_image') THEN 'ready' ELSE 'not_required' END`,
       printState: sql`CASE WHEN ${imageAssetsTable.profile} IN ('report', 'report_detail', 'report_technical') THEN 'ready' ELSE 'not_required' END`,
      errorCode: null, retryable: false,
      cleanupPending: sql`jsonb_array_length(${imageAssetsTable.attemptHistory}) > 0`, updatedAt: new Date(),
    }).where(and(attemptWhere(id, attemptToken), eq(imageAssetsTable.state, "uploading"))).returning());
      if (onCommit) {
        const projectFileId = await onCommit(tx, row);
        row = requireRow(await tx.update(imageAssetsTable).set({ projectFileId }).where(eq(imageAssetsTable.id, id)).returning());
      }
      return row;
    });
  },
  async get(id: string): Promise<Asset | null> {
    const [row] = await db.select().from(imageAssetsTable).where(eq(imageAssetsTable.id, id));
    return row ?? null;
  },
  async fail(id: string, attemptToken: string, errorCode: string, retryable: boolean): Promise<void> {
    if (!/^[a-z_]{1,80}$/.test(errorCode)) throw new ImageProcessingError("invalid_image_error_code");
    await db.update(imageAssetsTable).set({
      state: "failed", primaryState: "failed",
      thumbnailState: sql`CASE WHEN ${imageAssetsTable.profile} IN ('report', 'report_detail', 'report_technical', 'file_image') THEN 'failed' ELSE 'not_required' END`,
      printState: sql`CASE WHEN ${imageAssetsTable.profile} IN ('report', 'report_detail', 'report_technical') THEN 'failed' ELSE 'not_required' END`,
      cleanupPending: sql`${imageAssetsTable.storageKey} IS NOT NULL`,
      errorCode, retryable, updatedAt: new Date(),
    }).where(attemptWhere(id, attemptToken));
  },
};

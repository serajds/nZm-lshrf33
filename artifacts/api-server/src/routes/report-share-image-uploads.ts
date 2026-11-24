import { Router, json, text } from "express";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import { db, pool, projectFilesTable, reportImageShareUploadsTable, reportImageSharesTable, reportsTable } from "@workspace/db";
import {
  IMAGE_CLIENT_KEY_PATTERN,
  REPORT_IMAGE_MAX_BYTES,
  isJpgReportImageUpload,
  nextReportImageShareUploadCount,
  type ReportShareImageGroup,
} from "@workspace/api-zod";
import { createImageLifecycle } from "../lib/image-lifecycle";
import { createImageUploadAdmission } from "../lib/image-processing-admission";
import { ImageProcessingError } from "../lib/image-processing";
import { imageObjectName } from "../lib/image-asset-keys";
import { tryAcquireReportShareUploadLock } from "../lib/report-share-upload-lock";
import { sendImageUploadError } from "../lib/image-upload-errors";
import { isValidBase64String } from "../lib/base64-validation";

const sharePacketLimit = Math.ceil(REPORT_IMAGE_MAX_BYTES * 4 / 3) + 16 * 1024;
const parseJson = json({ limit: sharePacketLimit });
const parseText = text({ type: "text/plain", limit: sharePacketLimit });
const tokenPattern = /^[A-Za-z0-9_-]{40,100}$/;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const lifecycle = createImageLifecycle();
const uploadAdmission = createImageUploadAdmission(pool);
function sendShareUploadError(res: import("express").Response, error: unknown): void {
  if (error && typeof error === "object" && "status" in error && error.status === 413) {
    res.status(413).json({ error: "الحد الأقصى لحجم الصورة 5 ميغابايت", code: "source_size_limit", retryable: false });
    return;
  }
  sendImageUploadError(res, error);
}

type ShareContext = {
  shareId: number;
  projectId: number;
  reportId: number;
  controller: AbortController;
  signal: AbortSignal;
  lease: Awaited<ReturnType<typeof uploadAdmission.acquire>>;
  release: () => Promise<void>;
};

async function acquireShareContext(req: import("express").Request, res: import("express").Response, token: string): Promise<ShareContext | null> {
  if (!tokenPattern.test(token)) return null;
  const [share] = await db.select({
    id: reportImageSharesTable.id, projectId: reportImageSharesTable.projectId,
    reportId: reportImageSharesTable.reportId, status: reportImageSharesTable.status,
    expiresAt: reportImageSharesTable.expiresAt,
  }).from(reportImageSharesTable).where(eq(reportImageSharesTable.tokenHash, tokenHash(token))).limit(1);
  if (!share || share.status === "completed" || share.status === "cancelled" || share.expiresAt <= new Date()) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  let lease: ShareContext["lease"];
  try { lease = await uploadAdmission.acquire(`report-share:${share.id}`, controller.signal); }
  catch (error) {
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
    throw error;
  }
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    req.removeListener("aborted", abort);
    res.removeListener("close", abort);
    await lease.release();
  };
  const context: ShareContext = {
    shareId: share.id, projectId: share.projectId, reportId: share.reportId,
    controller, signal: AbortSignal.any([controller.signal, lease.signal]), lease, release,
  };
  res.locals.reportShareImageUpload = context;
  res.once("finish", () => { void release(); });
  return context;
}

export function createReportShareImageUploadsRouter() {
  const router = Router();

  router.post("/public/report-image-shares/upload", async (req, res, next) => {
    const token = req.query.token;
    if (typeof token !== "string" || !tokenPattern.test(token)) { next(); return; }
    let context: ShareContext | null;
    try { context = await acquireShareContext(req, res, token); }
    catch (error) { sendShareUploadError(res, error); return; }
    if (!context) {
      res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إلغاؤه أو إكمال الرفع" });
      return;
    }
    next();
  });

  router.post("/public/report-image-shares/upload", async (req, res): Promise<void> => {
    const startedAt = performance.now();
    let context = res.locals.reportShareImageUpload as ShareContext | undefined;
    try {
      if (req.is("text/plain")) {
        await new Promise<void>((resolve, reject) => parseText(req, res, error => error ? reject(error) : resolve()));
        try { req.body = JSON.parse(req.body); }
        catch { throw new ImageProcessingError("invalid_image_packet"); }
      } else if (req.is("application/json")) {
        await new Promise<void>((resolve, reject) => parseJson(req, res, error => error ? reject(error) : resolve()));
      } else {
        throw new ImageProcessingError("invalid_image_packet");
      }

      const body = req.body as Record<string, unknown>;
      const token = typeof req.query.token === "string" ? req.query.token
        : typeof body.token === "string" ? body.token : "";
      if (!tokenPattern.test(token)) { res.status(410).json({ error: "الرابط غير صالح أو انتهت صلاحيته" }); return; }
      if (!context) {
        context = (await acquireShareContext(req, res, token)) ?? undefined;
      }
      if (!context) { res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إكمال الرفع" }); return; }
      const activeContext = context;
      if (!isValidBase64String(typeof body.base64 === "string" ? body.base64
        : typeof body.imageBase64 === "string" ? body.imageBase64 : "")) {
        throw new ImageProcessingError("invalid_image_packet");
      }
      const base64 = typeof body.base64 === "string" ? body.base64
        : typeof body.imageBase64 === "string" ? body.imageBase64 : "";
      const clientKey = typeof body.clientKey === "string" ? body.clientKey
        : `legacy:${createHash("sha256").update(base64).digest("hex")}`;
      const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
      const fileName = typeof body.fileName === "string" ? body.fileName : "صورة.jpg";
      if (!IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) throw new ImageProcessingError("invalid_image_identity");
      if (!isJpgReportImageUpload(fileName, mimeType)) {
        res.status(400).json({ error: "يُسمح فقط برفع الصور بامتداد JPG" }); return;
      }
      const rawBytes = Buffer.byteLength(base64, "base64");
      if (!base64 || rawBytes <= 0 || rawBytes > REPORT_IMAGE_MAX_BYTES) {
        res.status(rawBytes > REPORT_IMAGE_MAX_BYTES ? 413 : 400).json({ error: "الحد الأقصى لحجم الصورة 5 ميغابايت" });
        return;
      }
      if (body && typeof body === "object") {
        body.base64 = "";
        body.imageBase64 = "";
      }
      const reservation = await db.transaction(async tx => {
        if (!await tryAcquireReportShareUploadLock(query => tx.execute(query))) return { kind: "busy" as const };
        const [report] = await tx.select().from(reportsTable)
          .where(and(eq(reportsTable.id, activeContext.reportId), eq(reportsTable.projectId, activeContext.projectId)))
          .for("update");
        const [share] = await tx.select().from(reportImageSharesTable)
          .where(eq(reportImageSharesTable.id, activeContext.shareId)).for("update");
        if (!report || !share || share.status === "completed" || share.status === "cancelled"
          || share.expiresAt <= new Date() || !Array.isArray(report.imageGroups)) return { kind: "unavailable" as const };
        const groups = (report.imageGroups as ReportShareImageGroup[])
          .map(group => ({ ...group, urls: Array.isArray(group.urls) ? group.urls : [] }));
        const group = groups.find(item => item.id === share.groupId);
        if (!group) return { kind: "unavailable" as const };

        const [existing] = await tx.select().from(reportImageShareUploadsTable).where(and(
          eq(reportImageShareUploadsTable.shareId, share.id),
          eq(reportImageShareUploadsTable.clientKey, clientKey),
        )).for("update");
        if (existing?.state === "ready" && existing.projectFileId) {
          return { kind: "ready" as const, fileId: existing.projectFileId, uploadedCount: share.uploadedCount, maxImages: share.maxImages };
        }
        if (existing?.state === "uploading" && existing.leaseExpiresAt > new Date()) return { kind: "busy" as const };

        const uploads = await tx.select({
          state: reportImageShareUploadsTable.state,
          position: reportImageShareUploadsTable.position,
          leaseExpiresAt: reportImageShareUploadsTable.leaseExpiresAt,
        }).from(reportImageShareUploadsTable).where(eq(reportImageShareUploadsTable.shareId, share.id));
        const active = uploads.filter(row => row.state === "uploading" && row.leaseExpiresAt > new Date()).length;
        const countForLimit = nextReportImageShareUploadCount(share.uploadedCount + active, share.maxImages);
        if (countForLimit === null) {
          return { kind: "limit" as const, uploadedCount: share.uploadedCount, maxImages: share.maxImages };
        }
        const position = Math.max(
          share.uploadedCount - 1,
          ...uploads.filter(row => row.state === "ready" || row.state === "uploading" && row.leaseExpiresAt > new Date())
            .map(row => row.position),
        ) + 1;
        const groupStartIndex = Math.max(0, group.urls.length - share.uploadedCount);
        const leaseExpiresAt = new Date(Date.now() + 4 * 60_000);
        if (existing) {
          await tx.update(reportImageShareUploadsTable).set({
            state: "uploading", position, groupStartIndex, projectFileId: null, fileUrl: null,
            errorCode: null, leaseExpiresAt, updatedAt: new Date(),
          }).where(eq(reportImageShareUploadsTable.id, existing.id));
        } else {
          await tx.insert(reportImageShareUploadsTable).values({
            shareId: share.id, clientKey, state: "uploading", position, groupStartIndex, leaseExpiresAt,
          });
        }
        await tx.update(reportImageSharesTable).set({ status: "uploading" }).where(eq(reportImageSharesTable.id, share.id));
        return { kind: "reserved" as const, uploadedCount: share.uploadedCount, maxImages: share.maxImages };
      });

      if (reservation.kind === "busy") {
        res.setHeader("Retry-After", "2");
        res.status(429).json({ error: "النظام يعالج صورًا أخرى الآن. أعد المحاولة بعد لحظات.", retryable: true });
        return;
      }
      if (reservation.kind === "limit") {
        res.status(409).json({
          error: `بلغ هذا الرابط الحد الذي اختاره منشئ الرابط وهو ${reservation.maxImages} صورة`,
          uploadedCount: reservation.uploadedCount, maxImages: reservation.maxImages,
        });
        return;
      }
      if (reservation.kind === "unavailable") {
        res.status(410).json({ error: "انتهت صلاحية الرابط أو لم يعد القسم متاحاً" });
        return;
      }
      if (reservation.kind === "ready") {
        const [file] = await db.select().from(projectFilesTable).where(eq(projectFilesTable.id, reservation.fileId));
        if (!file) { res.status(410).json({ error: "لم يعد الملف متاحًا" }); return; }
        res.status(200).json({ uploaded: true, uploadedCount: reservation.uploadedCount, maxImages: reservation.maxImages });
        return;
      }

      const tempDir = await mkdtemp(path.join(os.tmpdir(), "report-share-image-"));
      let sourcePath: string | undefined;
      const sourceBytes = Buffer.from(base64, "base64");
      try {
        sourcePath = path.join(tempDir, `incoming-image-${randomUUID()}.jpg`);
        await writeFile(sourcePath, sourceBytes, { flag: "wx", signal: activeContext.signal });
        const originalName = path.basename(fileName.replace(/\\/g, "/")).replace(/[\0\r\n]/g, "").slice(0, 255);
        const result = await lifecycle.upload({
          principal: `report-share:${activeContext.shareId}`,
          authorizedScope: `report-share:${activeContext.shareId}:report`,
          projectId: activeContext.projectId, userId: null, clientKey, profile: "report", sourcePath,
          signal: activeContext.signal, lease: activeContext.lease,
          onCommit: async (tx, asset) => {
            if (!await tryAcquireReportShareUploadLock(query => tx.execute(query))) {
              throw new ImageProcessingError("image_capacity_busy", true);
            }
            const [report] = await tx.select().from(reportsTable)
              .where(and(eq(reportsTable.id, activeContext.reportId), eq(reportsTable.projectId, activeContext.projectId)))
              .for("update");
            const [share] = await tx.select().from(reportImageSharesTable)
              .where(eq(reportImageSharesTable.id, activeContext.shareId)).for("update");
            const [attempt] = await tx.select().from(reportImageShareUploadsTable).where(and(
              eq(reportImageShareUploadsTable.shareId, activeContext.shareId),
              eq(reportImageShareUploadsTable.clientKey, clientKey),
              eq(reportImageShareUploadsTable.state, "uploading"),
            )).for("update");
            if (!report || !share || !attempt || share.status === "completed" || share.status === "cancelled"
              || share.expiresAt <= new Date() || !Array.isArray(report.imageGroups)) {
              throw new ImageProcessingError("report_share_expired");
            }
            const groups = (report.imageGroups as ReportShareImageGroup[])
              .map(group => ({ ...group, urls: Array.isArray(group.urls) ? [...group.urls] : [] }));
            const groupIndex = groups.findIndex(group => group.id === share.groupId);
            if (groupIndex < 0) throw new ImageProcessingError("report_share_group_missing");
            const filename = imageObjectName(asset.storageKey!);
            const fileUrl = `/api/uploads/${filename}`;
            const [file] = await tx.insert(projectFilesTable).values({
              projectId: activeContext.projectId, filename, originalName, category: "image", fileUrl,
              fileSize: asset.byteSize!, mimeType: asset.mimeType!, description: "صورة قسم تقرير",
            }).returning({ id: projectFilesTable.id });
            const group = groups[groupIndex]!;
            const localIndex = Math.min(attempt.groupStartIndex + attempt.position, group.urls.length);
            group.urls.splice(Math.max(0, localIndex), 0, fileUrl);
            const flatIndex = groups.slice(0, groupIndex).reduce((sum, item) => sum + item.urls.length, 0)
              + Math.max(0, localIndex);
            const imageUrls = Array.isArray(report.imageUrls) ? [...report.imageUrls] : [];
            imageUrls.splice(Math.min(flatIndex, imageUrls.length), 0, fileUrl);
            await tx.update(reportsTable).set({ imageGroups: groups, imageUrls }).where(eq(reportsTable.id, report.id));
            await tx.update(reportImageSharesTable).set({
              status: "uploading", uploadedCount: share.uploadedCount + 1,
            }).where(eq(reportImageSharesTable.id, share.id));
            await tx.update(reportImageShareUploadsTable).set({
              state: "ready", projectFileId: file.id, fileUrl, errorCode: null, updatedAt: new Date(),
            }).where(eq(reportImageShareUploadsTable.id, attempt.id));
            return file.id;
          },
        });
        if (!result.projectFileId) throw new ImageProcessingError("image_reference_removed");
        const [file] = await db.select().from(projectFilesTable).where(eq(projectFilesTable.id, result.projectFileId));
        const [share] = await db.select().from(reportImageSharesTable).where(eq(reportImageSharesTable.id, activeContext.shareId));
        if (!file || !share) throw new ImageProcessingError("image_reference_removed");
        if (process.env.NODE_ENV === "development") {
          const memory = process.memoryUsage();
          req.log.info({
            uploadBytes: sourceBytes.length, imageWidth: result.image.width, imageHeight: result.image.height,
            elapsedMs: Math.round(performance.now() - startedAt), rssBytes: memory.rss, externalBytes: memory.external,
          }, "Report-share image upload completed");
        }
        res.status(201).json({ uploaded: true, uploadedCount: share.uploadedCount, maxImages: share.maxImages });
      } catch (error) {
        await db.update(reportImageShareUploadsTable).set({
          state: "failed",
          errorCode: error instanceof ImageProcessingError ? error.code : "image_upload_failed",
          leaseExpiresAt: new Date(), updatedAt: new Date(),
        }).where(and(
          eq(reportImageShareUploadsTable.shareId, activeContext.shareId),
          eq(reportImageShareUploadsTable.clientKey, clientKey),
          eq(reportImageShareUploadsTable.state, "uploading"),
        )).catch(() => undefined);
        sendImageUploadError(res, error);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      sendShareUploadError(res, error);
    } finally {
      if (context) await context.release();
    }
  });
  return router;
}

export default createReportShareImageUploadsRouter();

import { Router, json, text, type RequestHandler } from "express";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { db, imageAssetsTable, projectFilesTable } from "@workspace/db";
import { IMAGE_CLIENT_KEY_PATTERN, IMAGE_PACKET_TEXT_LIMIT_BYTES, IMAGE_SOURCE_MAX_BYTES, isReportImageProfile, type ReportImageProfile } from "@workspace/api-zod";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { createImageLifecycle, readyImageFromAsset } from "../lib/image-lifecycle";
import { createImageUploadRequestMiddleware, imageUploadRequest } from "../lib/image-upload-request";
import { parseImageUploadEnvelope, writeIncomingImageEnvelope } from "../lib/image-upload-envelope";
import { sendImageUploadError } from "../lib/image-upload-errors";
import { ImageProcessingError } from "../lib/image-processing";
import { imageObjectName } from "../lib/image-asset-keys";

const parseJson = json({ limit: IMAGE_PACKET_TEXT_LIMIT_BYTES });
const parseText = text({ type: "text/plain", limit: IMAGE_PACKET_TEXT_LIMIT_BYTES });
function middleware(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], handler: RequestHandler) {
  return new Promise<void>((resolve, reject) => handler(req, res, error => error ? reject(error) : resolve()));
}

export function createReportImageUploadsRouter(options: { temporaryRoot?: string } = {}) {
const router = Router();
const temporaryRoot = path.resolve(options.temporaryRoot ?? path.join(process.cwd(), "uploads"));
const lifecycle = createImageLifecycle();
const ingress = createImageUploadRequestMiddleware({ temporaryRoot });
router.get("/projects/:projectId/reports/uploads/status",
  requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"),
  async (req, res) => {
    try {
    const clientKey = req.query.clientKey;
    if (typeof clientKey !== "string" || !IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) {
      sendImageUploadError(res, new ImageProcessingError("invalid_image_identity")); return;
    }
    const userId = req.user!.userId, projectId = Number(req.params.projectId);
    const [asset] = await db.select().from(imageAssetsTable).where(and(
      eq(imageAssetsTable.scope, `user:${userId}:project:${projectId}:report`),
      eq(imageAssetsTable.clientKey, clientKey), eq(imageAssetsTable.userId, userId), eq(imageAssetsTable.projectId, projectId),
    )).limit(1);
    if (!asset) { res.status(404).json({ error: "لم يبدأ رفع هذه الصورة", code: "image_not_found" }); return; }
    if (asset.state === "ready") {
      const [file] = asset.projectFileId
        ? await db.select().from(projectFilesTable).where(eq(projectFilesTable.id, asset.projectFileId)) : [];
      if (!file) { sendImageUploadError(res, new ImageProcessingError("image_reference_removed")); return; }
      const result = readyImageFromAsset(asset);
      res.json({ state: asset.state, imageId: asset.id, policyVersion: asset.policyVersion, image: result.image, file, exceptions: result.exceptions });
      return;
    }
    res.json({ state: asset.state, imageId: asset.id, policyVersion: asset.policyVersion, errorCode: asset.errorCode, retryable: asset.retryable });
    } catch {
      sendImageUploadError(res, new ImageProcessingError("image_status_unavailable", true));
    }
  });
/** Mounted before general body parsers; exactly the existing Reports edit ACL. */
router.post("/projects/:projectId/reports/uploads",
  requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), ingress,
  async (req, res) => {
    const context = imageUploadRequest(res)!;
    try {
      await context.run(async () => {
        await mkdir(temporaryRoot, { recursive: true });
        let sourcePath: string, clientKey: string, originalName: string, prepared = false, format: "jpeg" | undefined;
        let qualityProfile: ReportImageProfile = "report";
        if (req.is("multipart/form-data")) {
          // Transitional transport, not a second processing/storage pipeline.
          const upload = multer({
            storage: multer.diskStorage({
              destination: temporaryRoot,
              filename(_req, _file, done) {
                const filename = `incoming-image-${randomUUID()}`;
                context.trackIncoming(path.join(temporaryRoot, filename));
                done(null, filename);
              },
            }),
            limits: { files: 1, fields: 4, fieldSize: 1024, fileSize: IMAGE_SOURCE_MAX_BYTES },
          }).single("file");
          await middleware(req, res, upload);
          if (!req.file) throw new ImageProcessingError("invalid_image_packet");
          sourcePath = req.file.path; originalName = req.file.originalname;
          const digest = createHash("sha256");
          for await (const chunk of createReadStream(sourcePath)) digest.update(chunk);
          clientKey = req.get("Idempotency-Key") ?? req.body?.clientKey ?? `legacy:${digest.digest("hex")}`;
          // Old clients do not advertise WebP support; keep JPEG compatibility.
          format = "jpeg";
          if (req.body?.qualityProfile !== undefined) {
            if (!isReportImageProfile(req.body.qualityProfile)) throw new ImageProcessingError("invalid_profile");
            qualityProfile = req.body.qualityProfile;
          }
        } else {
          if (req.is("text/plain")) {
            await middleware(req, res, parseText);
            try { req.body = JSON.parse(req.body); }
            catch { throw new ImageProcessingError("invalid_image_packet"); }
          } else if (req.is("application/json")) await middleware(req, res, parseJson);
          else throw new ImageProcessingError("invalid_image_packet");
          const envelope = parseImageUploadEnvelope(req.body);
          // Clear the parsed transport copy; the validated envelope owns it now.
          if (req.body && typeof req.body === "object") req.body.base64 = "";
          clientKey = envelope.clientKey; originalName = envelope.fileName;
          prepared = envelope.mode === "prepared"; format = envelope.encoding === "jpeg" ? "jpeg" : undefined;
          qualityProfile = envelope.qualityProfile ?? "report";
          sourcePath = await writeIncomingImageEnvelope(envelope, context, temporaryRoot);
        }
        if (typeof clientKey !== "string" || !IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) {
          throw new ImageProcessingError("invalid_image_identity");
        }
        const projectId = Number(req.params.projectId), userId = req.user!.userId;
        const result = await lifecycle.upload({
          principal: `user:${userId}`, authorizedScope: `project:${projectId}:report`,
          projectId, userId, clientKey, profile: qualityProfile, sourcePath, prepared, format,
          signal: context.signal, lease: context.lease,
          onCommit: async (tx, asset) => {
            const filename = imageObjectName(asset.storageKey!);
            const [file] = await tx.insert(projectFilesTable).values({
              projectId, filename, originalName: path.basename(originalName.replace(/\\/g, "/")).replace(/[\0\r\n]/g, "").slice(0, 255),
              category: "image", fileUrl: `/api/uploads/${filename}`, fileSize: asset.byteSize!,
              mimeType: asset.mimeType!, description: "صورة تقرير",
            }).returning({ id: projectFilesTable.id });
            return file.id;
          },
        });
        if (!result.projectFileId) throw new ImageProcessingError("image_reference_removed");
        const [file] = await db.select().from(projectFilesTable).where(eq(projectFilesTable.id, result.projectFileId));
        if (!file) throw new ImageProcessingError("image_reference_removed");
        if (!res.destroyed) res.status(201).json({ ...file, image: result.image, exceptions: result.exceptions });
      });
    } catch (error) {
      const code = (error as { code?: string; type?: string })?.code;
      const type = (error as { type?: string })?.type;
      sendImageUploadError(res, code === "LIMIT_FILE_SIZE" || type === "entity.too.large"
        ? new ImageProcessingError("source_size_limit")
        : type === "entity.parse.failed" || code === "LIMIT_UNEXPECTED_FILE"
          ? new ImageProcessingError("invalid_image_packet") : error);
    }
  });
return router;
}
export default createReportImageUploadsRouter();

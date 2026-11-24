import { Router, json, text, type RequestHandler } from "express";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, projectFilesTable } from "@workspace/db";
import { IMAGE_PACKET_TEXT_LIMIT_BYTES, IMAGE_SOURCE_MAX_BYTES } from "@workspace/api-zod";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { createImageLifecycle } from "../lib/image-lifecycle";
import { createImageUploadRequestMiddleware, imageUploadRequest } from "../lib/image-upload-request";
import { parseImageUploadEnvelope, writeIncomingImageEnvelope } from "../lib/image-upload-envelope";
import { sendImageUploadError } from "../lib/image-upload-errors";
import { ImageProcessingError } from "../lib/image-processing";
import { imageObjectName } from "../lib/image-asset-keys";

const parseJson = json({ limit: IMAGE_PACKET_TEXT_LIMIT_BYTES });
const parseText = text({ type: "text/plain", limit: IMAGE_PACKET_TEXT_LIMIT_BYTES });

function runMiddleware(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  handler: RequestHandler,
) {
  return new Promise<void>((resolve, reject) => {
    handler(req, res, error => error ? reject(error) : resolve());
  });
}

export function createFileImageUploadsRouter(options: { temporaryRoot?: string } = {}) {
  const router = Router();
  const temporaryRoot = path.resolve(options.temporaryRoot ?? path.join(process.cwd(), "uploads"));
  const ingress = createImageUploadRequestMiddleware({ temporaryRoot });
  const lifecycle = createImageLifecycle();

  router.post(
    "/projects/:projectId/files/images/upload",
    requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("files"), ingress,
    async (req, res): Promise<void> => {
      const context = imageUploadRequest(res);
      if (!context) { res.status(400).json({ error: "طلب رفع الصورة غير صالح" }); return; }
      try {
        await context.run(async () => {
          if (req.is("text/plain")) {
            await runMiddleware(req, res, parseText);
            try { req.body = JSON.parse(req.body); }
            catch { throw new ImageProcessingError("invalid_image_packet"); }
          } else if (req.is("application/json")) {
            await runMiddleware(req, res, parseJson);
          } else {
            throw new ImageProcessingError("invalid_image_packet");
          }

          const envelope = parseImageUploadEnvelope(req.body);
          if (envelope.qualityProfile !== undefined) throw new ImageProcessingError("invalid_profile");
          const description = typeof req.body?.description === "string"
            ? req.body.description.slice(0, 500) : null;
          if (req.body && typeof req.body === "object") req.body.base64 = "";
          const projectId = Number(req.params.projectId);
          const userId = req.user!.userId;
          if (!Number.isSafeInteger(projectId) || projectId <= 0) {
            throw new ImageProcessingError("invalid_image_identity");
          }
          if (Buffer.byteLength(envelope.base64, "base64") > IMAGE_SOURCE_MAX_BYTES) {
            throw new ImageProcessingError("source_size_limit");
          }
          const originalName = path.basename(envelope.fileName.replace(/\\/g, "/"))
            .replace(/[\0\r\n]/g, "").slice(0, 255);
          if (!/\.(?:jpe?g|png|webp|heic|heif|tif?f|avif)$/i.test(originalName)) {
            throw new ImageProcessingError("unsupported_format");
          }
          const sourcePath = await writeIncomingImageEnvelope(envelope, context, temporaryRoot);

          const result = await lifecycle.upload({
            principal: `user:${userId}`,
            authorizedScope: `project:${projectId}:files`,
            projectId,
            userId,
            clientKey: envelope.clientKey,
            profile: "file_image",
            sourcePath,
            signal: context.signal,
            lease: context.lease,
            onCommit: async (tx, asset) => {
              const filename = imageObjectName(asset.storageKey!);
              const [file] = await tx.insert(projectFilesTable).values({
                projectId,
                filename,
                originalName,
                category: "image",
                fileUrl: `/api/uploads/${filename}`,
                fileSize: asset.byteSize!,
                mimeType: asset.mimeType!,
                description,
              }).returning({ id: projectFilesTable.id });
              return file.id;
            },
          });
          if (!result.projectFileId) throw new ImageProcessingError("image_reference_removed");
          const [file] = await db.select().from(projectFilesTable)
            .where(eq(projectFilesTable.id, result.projectFileId));
          if (!file) throw new ImageProcessingError("image_reference_removed");
          if (!res.destroyed) res.status(201).json({ ...file, image: result.image, exceptions: result.exceptions });
        });
      } catch (error) {
        sendImageUploadError(res, error);
      }
    },
  );
  return router;
}

export default createFileImageUploadsRouter();

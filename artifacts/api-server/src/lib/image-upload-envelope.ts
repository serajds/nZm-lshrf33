import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PreparedImageUploadEnvelopeSchema, type PreparedImageUploadEnvelope,
} from "@workspace/api-zod";
import { ImageProcessingError } from "./image-processing";
import type { ImageUploadRequest } from "./image-upload-request";

export function parseImageUploadEnvelope(body: unknown, allowLegacy = false): PreparedImageUploadEnvelope {
  let value = body;
  if (allowLegacy && body && typeof body === "object") {
    const old = body as Record<string, unknown>;
    if (old.mode === undefined && typeof old.base64 === "string") {
      value = {
        mode: "source", encoding: "jpeg", base64: old.base64,
        fileName: old.fileName ?? "image.jpg", mimeType: old.mimeType,
        clientKey: old.clientKey ?? `legacy:${createHash("sha256").update(old.base64).digest("hex")}`,
      };
    }
  }
  const result = PreparedImageUploadEnvelopeSchema.safeParse(value);
  if (!result.success) {
    const large = result.error.issues.some(issue => issue.message === "source_size_limit" || issue.code === "too_big");
    throw new ImageProcessingError(large ? "source_size_limit" : "invalid_image_packet");
  }
  return result.data;
}

/** The caller wraps this AND the lifecycle call in context.run(). */
export async function writeIncomingImageEnvelope(envelope: PreparedImageUploadEnvelope, context: ImageUploadRequest, temporaryRoot: string) {
  if (context.signal.aborted) throw new ImageProcessingError("cancelled");
  const filename = path.join(temporaryRoot, `incoming-image-${randomUUID()}`);
  context.trackIncoming(filename);
  const bytes = Buffer.from(envelope.base64, "base64");
  // Do not retain the transport's additional large string through cloud writes.
  envelope.base64 = "";
  try { await writeFile(filename, bytes, { flag: "wx", signal: context.signal }); }
  catch (error) {
    if (context.signal.aborted) throw new ImageProcessingError("cancelled");
    throw error;
  }
  return filename;
}

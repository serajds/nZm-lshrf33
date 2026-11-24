import { z } from "zod";
import { IMAGE_CLIENT_KEY_PATTERN, IMAGE_PROFILES, IMAGE_SOURCE_MAX_BYTES } from "./image-policy";

export const IMAGE_PACKET_TEXT_LIMIT_BYTES = Math.ceil(IMAGE_SOURCE_MAX_BYTES / 3) * 4 + 16 * 1024;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function isCanonicalImageBase64(value: string): boolean {
  if (!value.length || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  if (value.endsWith("==")) return alphabet.indexOf(value[value.length - 3]!) % 16 === 0;
  if (value.endsWith("=")) return alphabet.indexOf(value[value.length - 2]!) % 4 === 0;
  return true;
}
export const PreparedImageUploadEnvelopeSchema = z.object({
  mode: z.enum(["prepared", "source"]),
  clientKey: z.string().regex(IMAGE_CLIENT_KEY_PATTERN),
  batchKey: z.string().uuid().optional(),
  position: z.number().int().min(0).max(49).optional(),
  qualityProfile: z.enum(["report", "report_detail", "report_technical"]).optional(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  encoding: z.enum(["webp", "jpeg"]).default("webp"),
  base64: z.string().min(4).max(Math.ceil(IMAGE_SOURCE_MAX_BYTES / 3) * 4),
}).strict().superRefine((value, ctx) => {
  const profile = value.qualityProfile ?? "report";
  const max = value.mode === "prepared" ? IMAGE_PROFILES[profile].maxOutputBytes : IMAGE_SOURCE_MAX_BYTES;
  const size = value.base64.length / 4 * 3 - (value.base64.endsWith("==") ? 2 : value.base64.endsWith("=") ? 1 : 0);
  if (size > max) {
    ctx.addIssue({ code: "custom", message: "source_size_limit", path: ["base64"] }); return;
  }
  if (!isCanonicalImageBase64(value.base64)) ctx.addIssue({ code: "custom", message: "invalid_image_packet", path: ["base64"] });
  if ((value.batchKey === undefined) !== (value.position === undefined)) {
    ctx.addIssue({ code: "custom", message: "invalid_image_packet", path: ["batchKey"] });
  }
});
export type PreparedImageUploadEnvelope = z.infer<typeof PreparedImageUploadEnvelopeSchema>;

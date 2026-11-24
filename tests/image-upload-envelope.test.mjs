import assert from "node:assert/strict";
import test from "node:test";
import {
  PreparedImageUploadEnvelopeSchema, isCanonicalImageBase64, IMAGE_PACKET_TEXT_LIMIT_BYTES,
} from "../lib/api-zod/src/image-upload-envelope.ts";
import { IMAGE_SOURCE_MAX_BYTES } from "../lib/api-zod/src/image-policy.ts";

test("the text envelope has canonical Base64 and bounded prepared/source sizes", () => {
  assert.equal(isCanonicalImageBase64("Zg=="), true);
  for (const value of ["Zh==", "Zg", "Zg==\n", "====", "data:image/jpeg;base64,Zg=="]) {
    assert.equal(isCanonicalImageBase64(value), false);
  }
  const base = { mode: "prepared", clientKey: "synthetic", fileName: "site.jpg", base64: "Zg==" };
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse(base).success, true);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({ ...base, role: "admin" }).success, false);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({ ...base, position: 1 }).success, false);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({ ...base, base64: "AAAA".repeat(710_000) }).success, false);
  const largePreparedBase64 = "AAAA".repeat(250_000);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({ ...base, base64: largePreparedBase64 }).success, false);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({
    ...base, qualityProfile: "report_detail", base64: largePreparedBase64,
  }).success, false);
  assert.equal(PreparedImageUploadEnvelopeSchema.safeParse({
    ...base, qualityProfile: "report_technical", base64: largePreparedBase64,
  }).success, true);
  assert.ok(IMAGE_PACKET_TEXT_LIMIT_BYTES > Math.ceil(IMAGE_SOURCE_MAX_BYTES / 3) * 4);
});

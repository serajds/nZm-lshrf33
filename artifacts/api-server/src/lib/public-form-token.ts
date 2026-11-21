import { randomBytes } from "node:crypto";

/** 192 bits of entropy, encoded as a URL-safe 32-character token. */
export function generatePublicFormToken(): string {
  return randomBytes(24).toString("base64url");
}

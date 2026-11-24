/**
 * Shared image policy. Target bytes are quality goals, not permission to
 * downscale engineering details indefinitely. Tiny inputs are never enlarged.
 * No storage keys, credentials, or image bytes belong in this contract.
 */
export const IMAGE_POLICY_VERSION = 4;
export const IMAGE_CLIENT_KEY_PATTERN = /^[A-Za-z0-9:._-]{1,180}$/;
export const IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_SOURCE_MAX_PIXELS = 40_000_000;
export const IMAGE_PROCESSING_CONCURRENCY = 2;
// Bound incoming bodies/storage separately from CPU work. One user cannot
// occupy every upload slot; two requests can overlap network and processing.
export const IMAGE_UPLOAD_CONCURRENCY = 3;
export const IMAGE_UPLOAD_PER_PRINCIPAL = 2;
export const IMAGE_PROCESSING_MAX_PENDING = 32;

export const IMAGE_PROFILES = {
  report: {
    maxEdge: 1600, targetMinBytes: 150 * 1024, targetMaxBytes: 350 * 1024,
    maxOutputBytes: 350 * 1024, qualities: [84, 80, 76], format: "webp", fallbackFormat: "jpeg", preserveAlpha: false,
  },
  report_detail: {
    maxEdge: 1600, targetMinBytes: 350 * 1024, targetMaxBytes: 600 * 1024,
    maxOutputBytes: 600 * 1024, qualities: [92, 89, 86], format: "webp", fallbackFormat: "jpeg", preserveAlpha: false,
  },
  report_technical: {
    maxEdge: 1600, targetMinBytes: 600 * 1024, targetMaxBytes: 1536 * 1024,
    maxOutputBytes: 1536 * 1024, qualities: [96, 93, 90, 87], format: "webp", fallbackFormat: "jpeg", preserveAlpha: false,
  },
  thumbnail: {
    maxEdge: 400, targetMinBytes: 15 * 1024, targetMaxBytes: 50 * 1024,
    maxOutputBytes: 200 * 1024, qualities: [78, 74, 70], format: "webp", fallbackFormat: "jpeg", preserveAlpha: false,
  },
  logo: {
    maxEdge: 1000, targetMinBytes: 0, targetMaxBytes: 350 * 1024,
    maxOutputBytes: 4 * 1024 * 1024, qualities: [90, 86], format: "png", preserveAlpha: true,
  },
  attendance: {
    maxEdge: 800, targetMinBytes: 0, targetMaxBytes: 160 * 1024,
    maxOutputBytes: 1024 * 1024, qualities: [82, 78], format: "jpeg", preserveAlpha: false,
  },
  file_image: {
    maxEdge: 2400, targetMinBytes: 0, targetMaxBytes: 700 * 1024,
    maxOutputBytes: 8 * 1024 * 1024, qualities: [88, 84, 80], format: "webp", preserveAlpha: true,
  },
} as const;
export type ImageProfile = keyof typeof IMAGE_PROFILES;
export type ReportImageProfile = "report" | "report_detail" | "report_technical";
export type ImageProcessingException = "quality_floor_exceeds_target" | "small_output_below_target" | "prepared_input_above_target";
export type ImageLifecycleState = "uploading" | "processing" | "ready" | "failed";
export type ImageReference = {
  id: string;
  policyVersion: number;
  profile: ImageProfile;
  state: ImageLifecycleState;
  storageKey: string | null;
  thumbnailKey: string | null;
  printKey: string | null;
  mimeType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
};

export function isImageProfile(value: unknown): value is ImageProfile {
  return typeof value === "string" && Object.hasOwn(IMAGE_PROFILES, value);
}
export function isReportImageProfile(value: unknown): value is ReportImageProfile {
  return value === "report" || value === "report_detail" || value === "report_technical";
}

export function isSvgImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return /^\uFEFF?\s*(?:(?:<!--[\s\S]*?-->)\s*|(?:<\?xml[^?]*\?>)\s*)*<svg(?:\s|>)/i.test(prefix);
}

/** Cheap signature gate before handing untrusted bytes to a native decoder. */
export function hasSupportedImageSignature(bytes: Uint8Array): boolean {
  const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length >= 6) {
    const gif = String.fromCharCode(...bytes.subarray(0, 6));
    if (gif === "GIF87a" || gif === "GIF89a") return true;
  }
  if (isSvgImageSignature(bytes)) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return true;
  if (bytes.length >= 12 && ascii(0) === "RIFF" && ascii(8) === "WEBP") return true;
  if (bytes.length >= 4 && ((bytes[0] === 73 && bytes[1] === 73 && [42, 43].includes(bytes[2]!) && bytes[3] === 0)
    || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && [42, 43].includes(bytes[3]!)))) return true;
  return bytes.length >= 12 && ascii(4) === "ftyp"
    && ["avif", "avis", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(8));
}

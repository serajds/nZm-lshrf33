import { Readable } from "node:stream";
import { signObjectURL } from "./objectStorage";
import { isLifecycleImageObjectFilename, UPLOADS_PREFIX } from "./image-asset-keys";
import { ImageProcessingError } from "./image-processing";

/** After consumer authorization and metadata resolution; no conversion/cache. */
export async function streamStoredImage(filename: string, bucketId: string, signal?: AbortSignal) {
  if (!isLifecycleImageObjectFilename(filename)) throw new ImageProcessingError("invalid_image_output_reference");
  const deadline = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  const url = await signObjectURL({
    bucketName: bucketId, objectName: UPLOADS_PREFIX + filename, method: "GET", ttlSec: 60, signal: deadline,
  });
  let response: globalThis.Response;
  try { response = await fetch(url, { signal: deadline, cache: "no-store" }); }
  catch { throw new ImageProcessingError("image_read_failed", true); }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new ImageProcessingError("image_read_failed", true);
  }
  return {
    stream: Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    contentLength: response.headers.get("content-length"),
  };
}

export {};
import { IMAGE_PROFILES, IMAGE_SOURCE_MAX_PIXELS, isReportImageProfile, type ReportImageProfile } from "@workspace/api-zod/image-policy";
type ImagePreparationRequest = { id: string; file: File; qualityProfile?: ReportImageProfile };
type ImagePreparationResponse = { id: string; ok: true; blob: Blob; encoding: "webp" | "jpeg"; width: number; height: number; exception?: string }
  | { id: string; ok: false; code: string };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ImagePreparationRequest>) => void) | null;
  postMessage: (message: ImagePreparationResponse) => void;
};
workerScope.onmessage = async (event: MessageEvent<ImagePreparationRequest>) => {
  const { id, file } = event.data;
  const qualityProfile = event.data.qualityProfile ?? "report";
  if (!isReportImageProfile(qualityProfile)) {
    workerScope.postMessage({ id, ok: false, code: "invalid_quality_profile" });
    return;
  }
  if (file.type === "image/svg+xml" || file.type === "image/gif" || /\.(?:svg|gif)$/i.test(file.name)) {
    // Keep vector sanitation and animated-GIF detection in the shared server
    // worker rather than flattening these formats silently in the browser.
    workerScope.postMessage({ id, ok: false, code: "server_processing_required" });
    return;
  }
  const policy = IMAGE_PROFILES[qualityProfile];
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
      throw new Error("browser_image_preparation_unavailable");
    }
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > IMAGE_SOURCE_MAX_PIXELS) {
      throw new Error("image_pixel_limit");
    }
    const scale = Math.min(1, policy.maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("browser_canvas_unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close(); bitmap = undefined;
    let best: Blob | null = null;
    for (const qualityPercent of policy.qualities) {
      const quality = qualityPercent / 100;
      const candidate = await canvas.convertToBlob({ type: "image/webp", quality });
      if (candidate.type === "image/webp" && (!best || candidate.size < best.size)) best = candidate;
      if (candidate.type === "image/webp" && candidate.size <= policy.targetMaxBytes) { best = candidate; break; }
    }
    let encoding: "webp" | "jpeg" = "webp";
    if (!best || best.size > policy.maxOutputBytes) {
      let jpegBest: Blob | null = null;
      for (const qualityPercent of [...policy.qualities].reverse()) {
        const quality = qualityPercent / 100;
        const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
        if (jpeg.type !== "image/jpeg") break;
        jpegBest = jpeg;
        if (jpeg.size <= policy.targetMaxBytes) break;
      }
      if (!jpegBest || jpegBest.size > policy.maxOutputBytes) throw new Error("quality_preserving_output_too_large");
      best = jpegBest; encoding = "jpeg";
    }
    if (best.size > policy.maxOutputBytes) throw new Error("quality_preserving_output_too_large");
    const response: ImagePreparationResponse = {
      id, ok: true, blob: best, encoding, width, height,
      ...(best.size > policy.targetMaxBytes ? { exception: "prepared_input_above_target" } : {}),
    };
    workerScope.postMessage(response);
  } catch (error) {
    const code = error instanceof Error && /pixel_limit/.test(error.message) ? "image_pixel_limit"
      : error instanceof Error && /quality_preserving_output_too_large/.test(error.message) ? "quality_preserving_output_too_large"
        : "browser_image_preparation_failed";
    workerScope.postMessage({ id, ok: false, code });
  } finally {
    bitmap?.close();
  }
};

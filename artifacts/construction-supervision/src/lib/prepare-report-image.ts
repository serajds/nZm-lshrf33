import type { ReportImageProfile } from "@workspace/api-zod/image-policy";
export type PreparedReportImage = { blob: Blob; encoding: "webp" | "jpeg"; width: number; height: number; exception?: string };
const managedReportFilename = /^image-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;
export function reportThumbnailUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/uploads/")) return url;
    const filename = decodeURIComponent(parsed.pathname.slice("/api/uploads/".length));
    if (!managedReportFilename.test(filename)) return url;
    parsed.searchParams.set("variant", "report-thumbnail");
    return `${parsed.pathname}${parsed.search}`;
  } catch { return url; }
}

/** Isolated browser worker: no large image decoding/encoding on the UI thread. */
export function prepareReportImage(file: File, signal: AbortSignal, qualityProfile: ReportImageProfile = "report"): Promise<PreparedReportImage> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let worker: Worker;
    try {
      worker = new Worker(new URL("./report-image-preparation.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new Error("تعذر بدء تجهيز الصورة في المتصفح")); return;
    }
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error("تعذر تجهيز الصورة في المتصفح")); };
    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; blob?: Blob; encoding?: "webp" | "jpeg"; width?: number; height?: number; exception?: string; code?: string }>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (!event.data.ok || !event.data.blob || !event.data.encoding || !event.data.width || !event.data.height) {
        reject(new Error(event.data.code ?? "browser_image_preparation_failed")); return;
      }
      resolve({
        blob: event.data.blob, encoding: event.data.encoding,
        width: event.data.width, height: event.data.height, exception: event.data.exception,
      });
    };
      worker.postMessage({ id, file, qualityProfile });
  });
}

export function blobToCanonicalBase64(blob: Blob, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal.addEventListener("abort", abort, { once: true });
    reader.onerror = () => reject(reader.error ?? new Error("تعذر قراءة الصورة"));
    reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("invalid_image_packet"));
      else resolve(result.slice(comma + 1));
    };
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.readAsDataURL(blob);
  });
}

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { fetchWithSession } from "@workspace/api-client-react";
import { reportPreviewAssetUrl } from "@/lib/report-logos";

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function isProtectedApiAsset(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin &&
      (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/"));
  } catch {
    return url === "/api" || url.startsWith("/api/");
  }
}

async function fetchProtectedBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetchWithSession(url, {
    signal,
    headers: { Accept: "image/*,application/pdf,application/octet-stream" },
  });
  if (!response.ok) {
    throw new Error(`Protected asset request failed with HTTP ${response.status}`);
  }
  return response.blob();
}

function waitBeforePreviewRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new Error("Report preview asset request was aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function fetchPreviewBlob(url: string, signal: AbortSignal, authenticated = true): Promise<Blob> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw signal.reason ?? new Error("Report preview asset request was aborted");
    let response: Response;
    try {
      response = authenticated
        ? await fetchWithSession(url, {
            signal,
            headers: { Accept: "image/*,application/pdf,application/octet-stream" },
          })
        : await fetch(url, {
            signal,
            mode: "cors",
            credentials: "omit",
            headers: { Accept: "image/*" },
          });
    } catch (error) {
      if (signal.aborted || attempt === 2) throw error;
      lastError = error;
      await waitBeforePreviewRetry(300 * (2 ** attempt), signal);
      continue;
    }

    if (response.ok) {
      try {
        return await response.blob();
      } catch (error) {
        if (signal.aborted || attempt === 2) throw error;
        lastError = error;
        await waitBeforePreviewRetry(300 * (2 ** attempt), signal);
        continue;
      }
    }

    const error = new Error(`Protected asset request failed with HTTP ${response.status}`);
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 2) throw error;
    lastError = error;
    await waitBeforePreviewRetry(300 * (2 ** attempt), signal);
  }
  throw lastError instanceof Error ? lastError : new Error("Report preview asset request failed");
}

function isSignedObjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "storage.googleapis.com"
      && parsed.searchParams.has("X-Goog-Signature");
  } catch {
    return false;
  }
}

/** Preview-owned blob URLs avoid base64 expansion and are released with its window. */
export async function protectedAssetToPreviewUrl(url: string, owner: Window, kind: "photo" | "logo" = "photo"): Promise<string> {
  const protectedApiAsset = isProtectedApiAsset(url);
  const signedObjectUrl = isSignedObjectUrl(url);
  if (!protectedApiAsset && !signedObjectUrl) {
    if (owner.closed) throw new Error("Report preview was closed");
    return url;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    const assetUrl = protectedApiAsset
      ? reportPreviewAssetUrl(url, kind, window.location.origin)
      : url;
    const blob = await fetchPreviewBlob(assetUrl, controller.signal, protectedApiAsset);
    if (owner.closed) throw new Error("Report preview was closed");
    return (owner as Window & typeof globalThis).URL.createObjectURL(blob);
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function protectedAssetToDataUrl(url: string): Promise<string> {
  if (!isProtectedApiAsset(url)) return url;
  const blob = await fetchProtectedBlob(url);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read asset"));
    reader.readAsDataURL(blob);
  });
}

export async function downloadProtectedAsset(url: string, filename?: string): Promise<void> {
  const blob = isProtectedApiAsset(url)
    ? await fetchProtectedBlob(url)
    : await (await fetch(url, { cache: "no-store" })).blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    if (filename) anchor.download = filename;
    else anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  }
}

export async function openProtectedAsset(url: string): Promise<void> {
  return downloadProtectedAsset(url);
}

export function ProtectedImage({
  src,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(
    isProtectedApiAsset(src) ? TRANSPARENT_PIXEL : src,
  );

  useEffect(() => {
    if (!isProtectedApiAsset(src)) {
      setResolvedSrc(src);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setResolvedSrc(TRANSPARENT_PIXEL);
    void fetchWithSession(src, {
      signal: controller.signal,
      headers: { Accept: "image/*" },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResolvedSrc(TRANSPARENT_PIXEL);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return <img {...props} src={resolvedSrc} />;
}
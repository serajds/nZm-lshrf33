import { prepareReportLogos, type ReportLogo } from "./report-logos";
import { reportPreviewScreenHtml } from "./report-preview-screen";

type ImageGroup = {
  category: string;
  urls: string[];
  shareStatus?: "pending" | "uploading" | "completed";
};
type ReportImages = { imageUrls?: string[] | null; imageGroups?: unknown };
export type ReportPreviewImageVariant = "thumbnail" | "photo";

export function applySignedReportImageLinks(
  imageUrls: string[],
  imageGroups: ImageGroup[] | null,
  assets: Record<string, string>,
  origin: string,
): { imageUrls: string[]; imageGroups: ImageGroup[] | null } {
  const resolve = (value: string): string => {
    let parsed: URL;
    try {
      parsed = new URL(value, origin);
    } catch {
      return value;
    }
    if (parsed.origin !== new URL(origin).origin) return value;
    const match = /^\/api\/uploads\/([^/]+)$/.exec(parsed.pathname);
    if (!match) return value;
    let filename: string;
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      return value;
    }
    return assets[`/api/uploads/${encodeURIComponent(filename)}`] ?? value;
  };
  return {
    imageUrls: imageUrls.map(resolve),
    imageGroups: imageGroups?.map(group => ({ ...group, urls: group.urls.map(resolve) })) ?? null,
  };
}

/**
 * Load report metadata and the small company logos only.
 * Photos remain as protected URLs until the preview window needs them.
 */
export async function loadReportPreview<T extends ReportImages>(options: {
  loadReport: () => Promise<T>;
  loadLogos: () => Promise<Record<string, ReportLogo>>;
  loadSignedAssets?: (report: T) => Promise<Record<string, string>>;
  loadAsset: (url: string) => Promise<string>;
  loadLogoAsset?: (url: string) => Promise<string>;
}) {
  const reportTask = options.loadReport();
  const logosTask = options.loadLogos().then(logos =>
    prepareReportLogos(logos, options.loadLogoAsset ?? options.loadAsset),
  );
  const report = await reportTask;
  const signedAssetsTask = options.loadSignedAssets
    ? options.loadSignedAssets(report)
    : Promise.resolve({});
  const [companyLogos, signedAssets] = await Promise.all([logosTask, signedAssetsTask]);
  const groups = report.imageGroups as ImageGroup[] | null | undefined;
  const imageGroups = groups?.length
    ? groups.map(group => ({
        category: group.category,
        urls: Array.isArray(group.urls) ? group.urls : [],
        shareStatus: group.shareStatus,
      }))
    : null;
  const imageUrls = imageGroups
    ? []
    : Array.isArray(report.imageUrls) ? report.imageUrls : [];
  const origin = typeof window !== "undefined" ? window.location.origin : "https://report-preview.invalid";
  const resolved = applySignedReportImageLinks(imageUrls, imageGroups, signedAssets, origin);
  return {
    report,
    imageGroups: resolved.imageGroups,
    imageUrls: resolved.imageUrls,
    companyLogos,
  };
}

export function attachProgressiveReportImages(options: {
  owner: Window;
  imageUrls: string[];
  initialObjectUrls?: string[];
  loadAsset: (
    url: string,
    variant: ReportPreviewImageVariant,
    signal: AbortSignal,
  ) => Promise<string>;
  onProgress: (progress: {
    loaded: number;
    failed: number;
    total: number;
    printing: boolean;
  }) => void;
  sameVariantForPrint?: boolean;
}): () => void {
  const { owner, imageUrls } = options;
  const popup = owner as Window & typeof globalThis;
  const imageElements = Array.from(
    owner.document.querySelectorAll<HTMLImageElement>("img[data-report-image-index]"),
  );
  const images = new Map<number, HTMLImageElement>();
  for (const image of imageElements) {
    const index = Number(image.dataset.reportImageIndex);
    if (Number.isSafeInteger(index) && index >= 0 && index < imageUrls.length) {
      images.set(index, image);
    }
  }

  const loadedKinds = new Map<number, ReportPreviewImageVariant>();
  const loadedUrls = new Map<number, string>();
  const failedImages = new Set<number>();
  const pending = new Map<string, Promise<void>>();
  const controllers = new Map<AbortController, ReportPreviewImageVariant>();
  const objectUrls = new Set((options.initialObjectUrls ?? []).filter(url => url.startsWith("blob:")));
  const queue: Array<{
    variant: ReportPreviewImageVariant;
    run: () => void;
    cancel: () => void;
  }> = [];
  let active = 0;
  let activeThumbnails = 0;
  let printing = false;
  let disposed = false;
  let observer: IntersectionObserver | null = null;

  const updateProgress = () => {
    options.onProgress({
      loaded: loadedKinds.size,
      failed: failedImages.size,
      total: images.size,
      printing,
    });
  };

  const setPlaceholder = (index: number, text: string, state: "loading" | "error" | "loaded") => {
    const placeholder = owner.document.querySelector<HTMLElement>(
      `[data-report-image-placeholder="${index}"]`,
    );
    if (!placeholder) return;
    placeholder.textContent = text;
    placeholder.dataset.state = state;
    placeholder.hidden = state === "loaded";
    placeholder.style.display = state === "loaded" ? "none" : "grid";
  };

  const schedule = (variant: ReportPreviewImageVariant, task: () => Promise<void>): Promise<void> =>
    new Promise((resolve, reject) => {
      queue.push({
        variant,
        run: () => {
          active += 1;
          if (variant === "thumbnail") activeThumbnails += 1;
          const finish = () => {
            active -= 1;
            if (variant === "thumbnail") activeThumbnails -= 1;
            runNext();
          };
          void task().then(resolve, reject).then(finish, finish);
        },
        cancel: () => reject(new Error("Report preview was closed")),
      });
      runNext();
    });

  function runNext(): void {
    while (!disposed && active < 2 && queue.length > 0) {
      const nextIndex = queue.findIndex(item =>
        item.variant !== "thumbnail" || activeThumbnails < 1,
      );
      if (nextIndex < 0) return;
      queue.splice(nextIndex, 1)[0]?.run();
    }
  }

  const setImageSource = (image: HTMLImageElement, src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onLoad = () => finish();
      const onError = () => finish(new Error("تعذّر عرض صورة التقرير"));
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
      image.src = src;
      if (image.complete && image.naturalWidth > 0) finish();
    });

  const ensureImage = async (index: number, variant: ReportPreviewImageVariant): Promise<void> => {
    if (disposed || owner.closed) return Promise.reject(new Error("Report preview was closed"));
    const currentVariant = loadedKinds.get(index);
    if (currentVariant === "photo" || currentVariant === variant) return Promise.resolve();
    const key = `${index}:${variant}`;
    const existing = pending.get(key);
    if (existing) return await existing;

    if (variant === "thumbnail") {
      const fullResolutionPending = pending.get(`${index}:photo`);
      if (fullResolutionPending) return await fullResolutionPending;
    }

    if (variant === "photo") {
      const lowerResolutionPending = pending.get(`${index}:thumbnail`);
      if (lowerResolutionPending) await lowerResolutionPending.catch(() => undefined);
      if (loadedKinds.get(index) === "photo") return;
      const pendingPhoto = pending.get(key);
      if (pendingPhoto) return await pendingPhoto;
    }

    const image = images.get(index);
    const url = imageUrls[index];
    if (!image || !url) {
      if (image) setPlaceholder(index, "رابط الصورة غير متاح", "error");
      failedImages.add(index);
      updateProgress();
      return Promise.reject(new Error("رابط صورة التقرير غير متاح"));
    }

    const work = schedule(variant, async () => {
      if (disposed || owner.closed) throw new Error("Report preview was closed");
      if (loadedKinds.get(index) === "photo"
        || (variant === "thumbnail" && loadedKinds.has(index))) return;

      const controller = new AbortController();
      controllers.set(controller, variant);
      setPlaceholder(index, variant === "photo" ? "جارٍ تجهيز صورة الطباعة…" : "جارٍ تحميل الصورة…", "loading");
      try {
        const objectUrl = await options.loadAsset(url, variant, controller.signal);
        if (!objectUrl) throw new Error("تعذّر تحميل صورة التقرير");
        if (objectUrl.startsWith("blob:")) objectUrls.add(objectUrl);
        if (disposed || owner.closed) {
          if (objectUrl.startsWith("blob:")) {
            popup.URL.revokeObjectURL(objectUrl);
            objectUrls.delete(objectUrl);
          }
          throw new Error("Report preview was closed");
        }
        await setImageSource(image, objectUrl);
        const previousUrl = loadedUrls.get(index);
        loadedUrls.set(index, objectUrl);
        loadedKinds.set(index, variant);
        failedImages.delete(index);
        setPlaceholder(index, "", "loaded");
        if (previousUrl?.startsWith("blob:") && previousUrl !== objectUrl) {
          popup.URL.revokeObjectURL(previousUrl);
          objectUrls.delete(previousUrl);
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) throw error;
        if (!loadedUrls.has(index)) {
          failedImages.add(index);
          setPlaceholder(index, "تعذّر تحميل هذه الصورة", "error");
        } else if (variant === "photo" && loadedKinds.get(index) === "thumbnail") {
          failedImages.add(index);
          setPlaceholder(index, "تعذّرت نسخة الطباعة؛ ستُستخدم نسخة المعاينة", "loaded");
        }
        throw error;
      } finally {
        controllers.delete(controller);
        updateProgress();
      }
    });

    const tracked = work.finally(() => {
      if (pending.get(key) === tracked) pending.delete(key);
    });
    pending.set(key, tracked);
    return tracked;
  };

  const onIntersection: IntersectionObserverCallback = entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target as HTMLImageElement;
      const index = Number(image.dataset.reportImageIndex);
      observer?.unobserve(image);
      void ensureImage(index, options.sameVariantForPrint ? "photo" : "thumbnail").catch(() => undefined);
    }
  };

  const Observer = popup.IntersectionObserver;
  if (Observer) {
    observer = new Observer(onIntersection, { rootMargin: "500px 0px" });
    for (const image of images.values()) observer.observe(image);
  } else {
    for (const index of images.keys()) {
      void ensureImage(index, options.sameVariantForPrint ? "photo" : "thumbnail").catch(() => undefined);
    }
  }

  const printButton = owner.document.getElementById("report-print-button") as HTMLButtonElement | null;
  const onPrint = (event: MouseEvent) => {
    event.preventDefault();
    if (printing || disposed) return;
    printing = true;
    observer?.disconnect();
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].variant !== "thumbnail") continue;
      queue.splice(index, 1)[0]?.cancel();
    }
    for (const [controller, variant] of controllers) {
      if (variant === "thumbnail") controller.abort();
    }
    if (printButton) {
      printButton.disabled = true;
      printButton.textContent = "جارٍ تجهيز الصور للطباعة…";
    }
    updateProgress();
    runNext();
    void Promise.allSettled(
      Array.from(images.keys(), index => ensureImage(index, "photo")),
    ).then(() => {
      if (disposed || owner.closed) return;
      if (failedImages.size > 0
        && !owner.confirm(`تعذّر تجهيز ${failedImages.size} صورة للطباعة. هل تريد متابعة الطباعة بالصور المتاحة؟`)) return;
      owner.focus();
      owner.print();
    }).finally(() => {
      printing = false;
      if (printButton && !disposed) {
        printButton.disabled = false;
        printButton.textContent = "🖨️ طباعة / حفظ PDF";
      }
      updateProgress();
    });
  };
  printButton?.addEventListener("click", onPrint);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    for (const controller of controllers.keys()) controller.abort();
    controllers.clear();
    for (const queued of queue.splice(0)) queued.cancel();
    for (const url of objectUrls) popup.URL.revokeObjectURL(url);
    objectUrls.clear();
    printButton?.removeEventListener("click", onPrint);
    owner.removeEventListener("pagehide", cleanup);
    owner.removeEventListener("beforeunload", cleanup);
  };
  owner.addEventListener("pagehide", cleanup, { once: true });
  owner.addEventListener("beforeunload", cleanup, { once: true });
  updateProgress();
  return cleanup;
}

/** Open synchronously inside the click so browsers don't block a delayed popup. */
export function openReportPreviewWindow(): Window | null {
  const win = window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) return null;
  win.document.write(reportPreviewScreenHtml());
  win.document.close();
  return win;
}

export function updateReportPreviewStatus(win: Window, text: string, completed?: number, total?: number): void {
  if (win.closed) return;
  const status = win.document.getElementById("preview-status");
  if (status) status.textContent = text;
  if (completed !== undefined && total !== undefined && total > 0) {
    const progress = win.document.getElementById("preview-progress") as HTMLProgressElement | null;
    if (progress) progress.value = Math.min(100, completed / total * 100);
    const count = win.document.getElementById("preview-count");
    if (count) count.textContent = `${completed} / ${total}`;
    if (status) status.textContent = `${text}: ${completed} من ${total}`;
  }
}

export function updateReportPreviewImages(
  win: Window,
  progress: { loaded: number; failed: number; total: number; printing: boolean },
): void {
  if (win.closed) return;
  const status = win.document.getElementById("report-image-status");
  if (!status) return;
  if (progress.printing) {
    status.textContent = progress.failed > 0
      ? `تجهيز الصور للطباعة: ${progress.loaded} من ${progress.total}؛ تعذّر ${progress.failed}`
      : `تجهيز الصور للطباعة: ${progress.loaded} من ${progress.total}`;
  } else if (progress.failed > 0) {
    status.textContent = `تم تحميل ${progress.loaded} من ${progress.total} صورة؛ تعذّر ${progress.failed}`;
  } else {
    status.textContent = `الصور تُحمّل عند عرضها: ${progress.loaded} من ${progress.total}`;
  }
}

export function showReportPreviewError(win: Window): void {
  if (win.closed) return;
  win.document.body.classList.add("is-error");
  const title = win.document.getElementById("preview-title");
  if (title) title.textContent = "تعذّر تجهيز المعاينة";
  updateReportPreviewStatus(win, "تعذّر تحميل التقرير كاملًا. ارجع إلى صفحة التقارير وأعد المحاولة.");
  const note = win.document.querySelector(".note");
  if (note) note.textContent = "لم تُصدر معاينة ناقصة. يمكنك إغلاق هذه النافذة والمحاولة مجددًا.";
}

import { prepareReportLogos, type ReportLogo } from "./report-logos";

type ImageGroup = { category: string; urls: string[] };
type ReportImages = { imageUrls?: string[] | null; imageGroups?: unknown };

/** All asset reuse is confined to this preview, never shared across sessions. */
export async function loadReportPreview<T extends ReportImages>(options: {
  loadReport: () => Promise<T>;
  loadLogos: () => Promise<Record<string, ReportLogo>>;
  loadAsset: (url: string) => Promise<string>;
  onProgress: (completed: number, total: number) => void;
}) {
  const assets = new Map<string, Promise<string>>();
  let completed = 0;
  let preparing = true;
  const load = (url: string) => {
    if (!preparing) throw new Error("Report preview preparation has ended");
    let pending = assets.get(url);
    if (!pending) {
      pending = options.loadAsset(url).then(result => {
        if (!result) throw new Error("تعذّر تحميل إحدى صور التقرير");
        completed += 1;
        if (preparing) options.onProgress(completed, assets.size);
        return result;
      });
      assets.set(url, pending);
      options.onProgress(completed, assets.size);
    }
    return pending;
  };
  const reportTask = options.loadReport().then(async report => {
    const groups = report.imageGroups as ImageGroup[] | null | undefined;
    const imageGroups = groups?.length
      ? await Promise.all(groups.map(async group => ({
          category: group.category,
          urls: await Promise.all((group.urls ?? []).map(load)),
        })))
      : null;
    const imageUrls = imageGroups ? [] : await Promise.all((report.imageUrls ?? []).map(load));
    return { report, imageGroups, imageUrls };
  });
  const logosTask = options.loadLogos().then(logos => prepareReportLogos(logos, load));
  const [images, companyLogos] = await Promise.all([reportTask, logosTask])
    .finally(() => { preparing = false; });
  return { ...images, companyLogos };
}

/** Open synchronously inside the click so browsers don't block a delayed popup. */
export function openReportPreviewWindow(): Window | null {
  const win = window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) return null;
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تجهيز معاينة التقرير</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;text-align:center;padding:64px 24px"><h2>جارٍ تجهيز معاينة التقرير</h2><p id="preview-status" role="status" aria-live="polite">جارٍ تحميل بيانات التقرير والصور والشعارات…</p><p>ستظهر المعاينة هنا تلقائيًا بعد اكتمال التحميل.</p></body></html>`);
  win.document.close();
  return win;
}

export function updateReportPreviewStatus(win: Window, text: string): void {
  if (win.closed) return;
  const status = win.document.getElementById("preview-status");
  if (status) status.textContent = text;
}

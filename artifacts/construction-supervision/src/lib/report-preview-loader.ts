import { prepareReportLogos, type ReportLogo } from "./report-logos";
import { reportPreviewScreenHtml } from "./report-preview-screen";

type ImageGroup = { category: string; urls: string[] };
type ReportImages = { imageUrls?: string[] | null; imageGroups?: unknown };

/** All asset reuse is confined to this preview, never shared across sessions. */
export async function loadReportPreview<T extends ReportImages>(options: {
  loadReport: () => Promise<T>;
  loadLogos: () => Promise<Record<string, ReportLogo>>;
  loadAsset: (url: string) => Promise<string>;
  loadLogoAsset?: (url: string) => Promise<string>;
  onProgress: (completed: number, total: number) => void;
}) {
  const assets = new Map<string, Promise<string>>();
  let completed = 0;
  let preparing = true;
  // Bound downloads rather than sending a large report's full photo set at once.
  let active = 0;
  const queue: Array<() => void> = [];
  const runAsset = async (url: string, logo: boolean): Promise<string> => {
    if (active >= 6) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      if (!preparing) throw new Error("Report preview preparation has ended");
      return await (logo && options.loadLogoAsset ? options.loadLogoAsset : options.loadAsset)(url);
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
  const load = (url: string, logo = false) => {
    if (!preparing) throw new Error("Report preview preparation has ended");
    const key = logo && options.loadLogoAsset ? `logo:${url}` : url;
    let pending = assets.get(key);
    if (!pending) {
      pending = runAsset(url, logo).then(result => {
        if (!result) throw new Error("تعذّر تحميل إحدى صور التقرير");
        completed += 1;
        if (preparing) options.onProgress(completed, assets.size);
        return result;
      });
      assets.set(key, pending);
      options.onProgress(completed, assets.size);
    }
    return pending;
  };
  const reportTask = options.loadReport().then(async report => {
    const groups = report.imageGroups as ImageGroup[] | null | undefined;
    const imageGroups = groups?.length
      ? await Promise.all(groups.map(async group => ({
          category: group.category,
          urls: await Promise.all((group.urls ?? []).map(url => load(url))),
        })))
      : null;
    const imageUrls = imageGroups ? [] : await Promise.all((report.imageUrls ?? []).map(url => load(url)));
    return { report, imageGroups, imageUrls };
  });
  const logosTask = options.loadLogos().then(logos => prepareReportLogos(logos, url => load(url, true)));
  const [images, companyLogos] = await Promise.all([reportTask, logosTask])
    .finally(() => { preparing = false; });
  return { ...images, companyLogos };
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

export function showReportPreviewError(win: Window): void {
  if (win.closed) return;
  win.document.body.classList.add("is-error");
  const title = win.document.getElementById("preview-title");
  if (title) title.textContent = "تعذّر تجهيز المعاينة";
  updateReportPreviewStatus(win, "تعذّر تحميل التقرير كاملًا. ارجع إلى صفحة التقارير وأعد المحاولة.");
  const note = win.document.querySelector(".note");
  if (note) note.textContent = "لم تُصدر معاينة ناقصة. يمكنك إغلاق هذه النافذة والمحاولة مجددًا.";
}

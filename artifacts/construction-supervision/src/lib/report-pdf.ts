import { reportTypeLabel } from "./report-types";
import { reportAssetUrl } from "./report-logos";

export interface ActivityForReport {
  name: string;
  plannedProgress: number;
  actualProgress: number;
  status: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualEndDate?: string | null;
  plannedAsOfDate?: string;
  plannedHistoricalUnverified?: boolean;
  actualHistoricalUnverified?: boolean;
  actualValueMissing?: boolean;
  plannedValueMissing?: boolean;
  delayed?: boolean;
  delayDays?: number | null;
}

export interface CompanyLogo {
  name: string;
  logoUrl: string | null;
}

export interface ReportImageGroupForPdf {
  id?: string;
  category: string;
  urls: string[];
  shareStatus?: "pending" | "uploading" | "completed";
}

export interface ReportPdfData {
  projectName: string;
  ownerEntity?: string | null;
  contractor?: string | null;
  supervisorEntity?: string | null;
  location?: string | null;
  reportType: "weekly" | "monthly" | string;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  progressPercentage: number | null;
  workDescription: string;
  technicalNotes?: string | null;
  recommendations?: string | null;
  imageUrls?: string[];
  imageGroups?: ReportImageGroupForPdf[] | null;
  reportId: number;
  reportNumber?: number;
  activities?: ActivityForReport[];
  /** False when a legacy report has no saved historical activity snapshot. */
  snapshotAvailable?: boolean;
  /** Weighted actual progress calculated from the report's saved snapshot. */
  actualProgress?: number | null;
  spi?: number | null;
  actualHistoricalUnverified?: boolean;
  /** The supervisor approved the report aggregate, not individual historical activity values. */
  approvedProgress?: boolean;
  plannedHistoricalUnverified?: boolean;
  contractValue?: number | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
  noSchedule?: boolean;
  plannedProgress?: number | null;
  companyLogos?: {
    owner?: CompanyLogo;
    contractor?: CompanyLogo;
    supervisor?: CompanyLogo;
  };
  apiBase?: string;
  reportSignatures?: {id: string, title: string, role: string, name?: string}[] | null;
  reportDisplayMode?: "type_and_number" | "period_only";
  actualProgressUnavailable?: boolean;
  actualAsOfDate?: string;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(url: string): string {
  const cleaned = url.replace(/["'<>]/g, "");
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(cleaned)) {
    return cleaned;
  }
  // Authenticated preview assets are browser-generated object URLs, not API links.
  if (/^blob:https?:\/\/[^/\s]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned)) {
    return esc(cleaned);
  }
  if (/^(https?:\/\/|\/)/i.test(cleaned)) return esc(cleaned);
  return "";
}

function statusLabel(s: string): string {
  return ({ completed: "مكتمل", in_progress: "جارٍ", delayed: "متأخر", not_started: "لم يبدأ" } as Record<string, string>)[s] ?? s;
}

function statusColor(s: string): string {
  return ({ completed: "#16a34a", in_progress: "#2563eb", delayed: "#dc2626", not_started: "#6b7280" } as Record<string, string>)[s] ?? "#6b7280";
}

function statusBg(s: string): string {
  return ({ completed: "#f0fdf4", in_progress: "#eff6ff", delayed: "#fef2f2", not_started: "#f9fafb" } as Record<string, string>)[s] ?? "#f9fafb";
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("ar-u-nu-latn", { maximumFractionDigits: 0 });
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = new Date(a), db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function hasValidSchedule(startDate: string | null | undefined, endDate: string | null | undefined, noSchedule = false): boolean {
  if (noSchedule || !startDate || !endDate) return false;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

export function buildPrintHTML(data: ReportPdfData): string {
  const typeLbl = reportTypeLabel(data.reportType);
  const periodOnly = data.reportDisplayMode === "period_only";
  const periodLabel = `${fmtDate(data.periodStart)} — ${fmtDate(data.periodEnd)}`;
  const pct = data.progressPercentage == null
    ? null
    : Math.round(Math.min(100, Math.max(0, data.progressPercentage)) * 10) / 10;
  const snapshotAvailable = data.snapshotAvailable !== false;
  const scheduleAvailable = hasValidSchedule(data.startDate, data.expectedEndDate, data.noSchedule);
  const plannedUnverified = data.plannedHistoricalUnverified === true
    || (data.activities ?? []).some(activity => activity.plannedHistoricalUnverified === true);
  const plannedPct = snapshotAvailable && data.plannedProgress != null && Number.isFinite(data.plannedProgress)
    ? Math.round(Math.min(100, Math.max(0, data.plannedProgress)) * 10) / 10
    : null;
  const recordedActual = snapshotAvailable && data.actualProgress != null
    ? Math.min(100, Math.max(0, data.actualProgress))
    : null;
  const historicalActual = data.actualProgressUnavailable
    ? null
    : data.approvedProgress ? pct : data.actualHistoricalUnverified ? null : recordedActual;
  const comparisonActual = historicalActual ?? (data.actualProgressUnavailable ? null : pct);
  const displayedComparisonActual = comparisonActual == null ? null : Math.round(comparisonActual * 10) / 10;
  const deviation = !plannedUnverified && plannedPct != null && historicalActual != null && data.plannedProgress != null
    ? Math.round((historicalActual - data.plannedProgress) * 10) / 10
    : null;

  const totalDuration = scheduleAvailable ? daysBetween(data.startDate, data.expectedEndDate) : null;
  const elapsed = scheduleAvailable ? daysBetween(data.startDate, data.reportDate) : null;
  const remainingRaw = scheduleAvailable ? daysBetween(data.reportDate, data.expectedEndDate) : null;
  const overrunDays = scheduleAvailable && remainingRaw != null && remainingRaw < 0 && pct != null && pct < 100 ? -remainingRaw : 0;
  const remaining = remainingRaw != null ? Math.max(0, remainingRaw) : null;
  const elapsedPct = totalDuration && elapsed != null ? Math.min(100, Math.round((elapsed / totalDuration) * 100)) : null;

  const acts = data.activities ?? [];
  const completedCount = acts.filter(a => a.status === "completed").length;
  const inProgressCount = acts.filter(a => a.status === "in_progress").length;
  const delayedCount = acts.filter(a => a.status === "delayed").length;
  const notStartedCount = acts.filter(a => a.status === "not_started").length;

  const metaRows = [
    data.ownerEntity ? ["جهة المالك", data.ownerEntity] : null,
    data.contractor ? ["المقاول", data.contractor] : null,
    data.supervisorEntity ? ["جهة الإشراف", data.supervisorEntity] : null,
    data.location ? ["الموقع", data.location] : null,
  ].filter(Boolean) as string[][];

  const activitiesHTML = acts.length > 0 ? `
    <div class="section activities-section">
      <div class="section-title blue-title">📋 حالة بنود الأعمال</div>
      <table class="tbl">
        <thead>
          <tr>
            <th class="th" style="text-align:right;width:40%">البند</th>
            <th class="th tc" style="width:12%">مخطط %</th>
            <th class="th tc" style="width:12%">فعلي %</th>
            <th class="th tc" style="width:16%">الحالة</th>
            <th class="th" style="width:20%">الإنجاز</th>
          </tr>
        </thead>
        <tbody>
          ${acts.map((a, i) => {
            const barW = Math.min(100, Math.max(0, a.actualProgress));
            return `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"}">
              <td class="td">${esc(a.name)}${a.plannedStartDate || a.plannedEndDate ? `<div style="font-size:10px;color:#64748b">البرنامج الزمني: ${fmtDate(a.plannedStartDate)} — ${fmtDate(a.plannedEndDate)}</div>` : ""}</td>
              <td class="td tc">${a.plannedValueMissing || !Number.isFinite(a.plannedProgress) ? "—" : `${(Math.round(a.plannedProgress * 10) / 10).toFixed(1)}%`}</td>
              <td class="td tc" style="font-weight:700">${a.actualValueMissing || !Number.isFinite(a.actualProgress) ? "—" : `${(Math.round(a.actualProgress * 10) / 10).toFixed(1)}%`}</td>
              <td class="td tc">
                <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${statusBg(a.status)};color:${statusColor(a.status)};border:1px solid ${statusColor(a.status)}">
                  ${a.actualValueMissing ? "—" : statusLabel(a.status)}
                </span>
              </td>
              <td class="td">
                ${a.actualValueMissing || !Number.isFinite(a.actualProgress) ? "—" : `<div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:${barW}%;background:${statusColor(a.status)};border-radius:4px"></div></div>`}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : "";

  const notesHTML = data.technicalNotes ? `
    <div class="section avoid-break" style="background:#fffbeb;border-color:#fcd34d">
      <div class="section-title" style="color:#92400e;border-color:#fcd34d">⚠️ الملاحظات الفنية</div>
      <p class="body-text">${esc(data.technicalNotes)}</p>
    </div>` : "";

  const recsHTML = data.recommendations ? `
    <div class="section avoid-break" style="background:#f0fdf4;border-color:#86efac">
      <div class="section-title" style="color:#166534;border-color:#86efac">✅ التوصيات</div>
      <p class="body-text">${esc(data.recommendations)}</p>
    </div>` : "";

  const renderImageGrid = (urls: string[], total: number, startIdx: number): string => `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${urls.map((url, i) => { const safe = escAttr(url); return safe ? `
        <div class="avoid-break" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc">
          <img src="${safe}" style="width:100%;height:200px;object-fit:cover;display:block" onerror="this.parentNode.style.display='none'" />
          <div style="font-size:11px;color:#64748b;text-align:center;padding:6px;background:#f1f5f9">صورة ${startIdx + i + 1} من ${total}</div>
        </div>` : ""; }).join("")}
    </div>`;

  const groups = (data.imageGroups ?? []).filter(g => g && Array.isArray(g.urls));
  let imagesHTML = "";
  if (groups.length > 0) {
    let runningIdx = 0;
    const totalImages = groups.reduce((s, g) => s + g.urls.length, 0);
    const sectionsHTML = groups.map((g, gi) => {
      const shareStatus = g.shareStatus === "pending" ? " — بانتظار الرفع"
        : g.shareStatus === "uploading" ? " — جارٍ الرفع"
        : g.shareStatus === "completed" ? " — مكتمل" : "";
      const html = `
        <div class="avoid-break" style="${gi > 0 ? "margin-top:18px;" : ""}break-after:avoid;page-break-after:avoid">
          <div class="section-title blue-title" style="border:none;padding:0 0 10px 0;margin-bottom:14px;border-bottom:2px solid #bfdbfe">📷 ${esc(g.category)} (${g.urls.length} صورة)${shareStatus}</div>
        </div>
        ${g.urls.length > 0 ? renderImageGrid(g.urls, totalImages, runningIdx)
          : `<p class="body-text" style="border:1px dashed #cbd5e1;border-radius:6px;padding:10px;color:#64748b">لا توجد صور في هذا القسم بعد.</p>`}`;
      runningIdx += g.urls.length;
      return html;
    }).join("");
    imagesHTML = `<div style="break-before:page;page-break-before:always">${sectionsHTML}</div>`;
  } else {
    const images = data.imageUrls ?? [];
    if (images.length > 0) {
      imagesHTML = `
        <div style="break-before:page;page-break-before:always">
          <div class="section-title blue-title avoid-break" style="border:none;padding:0 0 10px 0;margin-bottom:16px;border-bottom:2px solid #bfdbfe">📷 صور الموقع (${images.length} صورة)</div>
          ${renderImageGrid(images, images.length, 0)}
        </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${periodOnly ? `تقرير الفترة ${periodLabel}` : `تقرير ${typeLbl}`} — ${esc(data.projectName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm 14mm 14mm; }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Latin Digits', 'Noto Kufi Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1e293b;
    direction: rtl;
    text-align: right;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .avoid-break { break-inside: avoid; page-break-inside: avoid; }

  /* ── COMPANY LOGOS STRIP ── */
  .logos-strip {
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 18px 24px;
    margin-bottom: 12px;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
  }
  .logo-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .logo-img-box {
    width: 80px;
    height: 80px;
    border-radius: 12px;
    border: 1.5px solid #e2e8f0;
    background: #f8fafc;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 4px;
  }
  .logo-img-box img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .logo-role {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
  }
  .logo-name {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── HEADER ── */
  .header {
    background: #1e293b;
    color: #fff;
    padding: 24px 28px 20px;
    border-radius: 10px;
    margin-bottom: 16px;
    position: relative;
    overflow: hidden;
  }
  .header::before {
    content: '';
    position: absolute;
    top: -50px; left: -50px;
    width: 150px; height: 150px;
    background: rgba(255,255,255,0.04);
    border-radius: 50%;
  }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; position: relative; z-index: 1; }
  .header-info { flex: 1; min-width: 0; }
  .header-sys { font-size: 10px; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.45); margin-bottom: 6px; }
  .header-name { font-size: 22px; font-weight: 800; line-height: 1.3; margin-bottom: 12px; }
  .header-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-block; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 12px; font-size: 11px; color: rgba(255,255,255,0.8); }
  .header-badge { background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.25); border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 90px; }
  .header-badge.period-badge { width: 180px; flex: 0 0 180px; padding-left: 10px; padding-right: 10px; }
  .header-badge.period-badge .badge-val { font-size: 13px; line-height: 1.4; white-space: nowrap; }
  .badge-lbl { font-size: 9px; color: rgba(255,255,255,0.5); margin-bottom: 4px; }
  .badge-val { font-size: 20px; font-weight: 800; }

  /* ── INFO STRIP ── */
  .info-strip { display: flex; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .info-cell { flex: 1; text-align: center; padding: 12px 8px; border-left: 1px solid #e2e8f0; }
  .info-cell:first-child { border-left: none; }
  .info-lbl { font-size: 10px; color: #64748b; font-weight: 600; margin-bottom: 3px; }
  .info-val { font-size: 15px; font-weight: 800; color: #1e293b; }

  /* ── DUAL PROGRESS ── */
  .dual-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; background: #fafbfc; }
  .dual-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .dual-title { font-size: 15px; font-weight: 700; color: #334155; }
  .dev-badge { font-size: 12px; font-weight: 700; padding: 3px 14px; border-radius: 14px; }
  .dev-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #86efac; }
  .dev-warn { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; }
  .dp-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .dp-row:last-child { margin-bottom: 0; }
  .dp-lbl { font-size: 12px; font-weight: 600; color: #64748b; width: 45px; }
  .dp-track { flex: 1; height: 16px; background: #e2e8f0; border-radius: 8px; overflow: hidden; }
  .dp-fill-blue { height: 100%; border-radius: 8px; background: #2563eb; }
  .dp-fill-gray { height: 100%; border-radius: 8px; background: #94a3b8; }
  .dp-val { font-size: 16px; font-weight: 800; width: 50px; text-align: left; }

  /* ── STATS ── */
  .stats-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
  .stat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
  .stat-lbl { font-size: 11px; color: #64748b; font-weight: 600; }
  .stat-val { font-size: 16px; font-weight: 800; color: #1e293b; }
  .stat-unit { font-size: 11px; font-weight: 600; color: #94a3b8; }

  /* ── TIMELINE ── */
  .tl-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 20px; margin-bottom: 16px; background: #fafbfc; }
  .tl-title { font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 8px; }
  .tl-dates { display: flex; justify-content: space-between; font-size: 12px; color: #475569; margin-bottom: 8px; }
  .tl-track { height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 6px; }
  .tl-fill { height: 100%; background: #1e40af; border-radius: 6px; }
  .tl-legend { display: flex; gap: 20px; font-size: 10px; color: #64748b; }

  /* ── ACTIVITY SUMMARY ── */
  .act-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 20px; margin-bottom: 16px; background: #fafbfc; }
  .act-title { font-size: 14px; font-weight: 700; color: #334155; margin-bottom: 12px; }
  .act-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .act-item { text-align: center; }
  .act-num { font-size: 26px; font-weight: 800; line-height: 1.1; }
  .act-dot { width: 10px; height: 10px; border-radius: 50%; margin: 4px auto; }
  .act-lbl { font-size: 11px; color: #64748b; font-weight: 600; }
  .act-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 2px; }
  .act-seg { border-radius: 3px; }

  /* ── SECTIONS / CARDS ── */
  .section { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; background: #fafbfc; }
  .section-title { font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
  .blue-title { color: #1e40af; border-bottom-color: #bfdbfe; }
  .body-text { font-size: 14px; color: #475569; line-height: 1.9; white-space: pre-wrap; }

  /* ── TABLE ── */
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl thead { display: table-header-group; }
  .tbl tr { break-inside: avoid; page-break-inside: avoid; }
  .th { background: #f1f5f9; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #475569; border-bottom: 2px solid #cbd5e1; text-align: right; }
  .tc { text-align: center !important; }
  .td { padding: 9px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: middle; }

  /* ── FOOTER ── */
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }

  /* ── TOOLBAR ── */
  .toolbar { position: sticky; top: 0; left: 0; right: 0; background: #1e293b; padding: 10px 16px; display: flex; justify-content: center; align-items: center; gap: 10px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .btn-print { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .btn-print:hover { background: #1d4ed8; }
  .btn-close { background: rgba(255,255,255,0.15); color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .btn-close:hover { background: rgba(255,255,255,0.25); }

  @media print {
    .toolbar { display: none !important; }
  }
  @media screen {
    body { max-width: 210mm; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
  }
</style>
</head>
<body>

<div class="toolbar">
  <button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <button class="btn-close" onclick="window.close()">✕ إغلاق</button>
</div>

${(() => {
  const logos = data.companyLogos;
  const base = data.apiBase || "";
  if (!logos || (!logos.owner?.logoUrl && !logos.contractor?.logoUrl && !logos.supervisor?.logoUrl)) return "";
  const entries: Array<{role: string; name: string; src: string}> = [];
  if (logos.supervisor) {
    entries.push({ role: "جهة الإشراف", name: logos.supervisor.name, src: logos.supervisor.logoUrl ? escAttr(reportAssetUrl(logos.supervisor.logoUrl, base)) : "" });
  }
  if (logos.owner) {
    entries.push({ role: "الجهة المالكة", name: logos.owner.name, src: logos.owner.logoUrl ? escAttr(reportAssetUrl(logos.owner.logoUrl, base)) : "" });
  }
  if (logos.contractor) {
    entries.push({ role: "المقاول", name: logos.contractor.name, src: logos.contractor.logoUrl ? escAttr(reportAssetUrl(logos.contractor.logoUrl, base)) : "" });
  }
  const html = entries.map(e => `<div class="logo-item">
    <div class="logo-role">${e.role}</div>
    <div class="logo-img-box">${e.src ? `<img src="${e.src}" onerror="this.style.display='none'" />` : ""}</div>
    <div class="logo-name">${esc(e.name)}</div>
  </div>`).join("");
  return `<div class="logos-strip avoid-break">${html}</div>`;
})()}

${data.actualProgressUnavailable ? `<div class="section avoid-break" style="background:#fffbeb;border-color:#f59e0b;color:#92400e;font-weight:700;text-align:center">
  أصبح هذا تقريراً عادياً غير معتمد. لا يتوفر سجل إنجاز موثوق حتى تاريخ التقرير؛ أدخل النسبة الفعلية الموثقة وراجعها قبل الاعتماد.
</div>` : ""}

<!-- HEADER -->
<div class="header avoid-break">
  <div class="header-row">
    <div class="header-info">
      <div class="header-sys">إدارة الإشراف والمتابعة</div>
      <div class="header-name">${esc(data.projectName)}</div>
      <div class="header-pills">
        ${metaRows.map(([l, v]) => `<span class="pill">${l}: ${esc(v)}</span>`).join("")}
      </div>
    </div>
    <div class="header-badge${periodOnly ? " period-badge" : ""}">
      <div class="badge-lbl">${periodOnly ? "الفترة" : "نوع التقرير"}</div>
      <div class="badge-val">${periodOnly ? periodLabel : typeLbl}</div>
    </div>
  </div>
</div>

<!-- INFO STRIP -->
<div class="info-strip avoid-break">
  <div class="info-cell"><div class="info-lbl">تاريخ التقرير</div><div class="info-val">${fmtDate(data.reportDate)}</div></div>
  <div class="info-cell"><div class="info-lbl">بداية الفترة</div><div class="info-val">${fmtDate(data.periodStart)}</div></div>
  <div class="info-cell"><div class="info-lbl">نهاية الفترة</div><div class="info-val">${fmtDate(data.periodEnd)}</div></div>
  ${periodOnly ? "" : `<div class="info-cell"><div class="info-lbl">رقم التقرير</div><div class="info-val">#${data.reportNumber ?? data.reportId}</div></div>`}
</div>

<!-- DUAL PROGRESS -->
<div class="dual-box avoid-break">
  <div class="dual-head">
    <span class="dual-title">مقارنة الإنجاز</span>
    ${deviation != null ? `<span class="dev-badge ${deviation >= 0 ? "dev-ok" : "dev-warn"}">${deviation >= 0 ? "+" : ""}${deviation}% ${deviation >= 0 ? "متقدم عن الخطة" : "خلف الخطة"}</span>` : ""}
    ${overrunDays > 0 ? `<span class="dev-badge dev-warn">تجاوز المدة: ${overrunDays} يوم</span>` : ""}
  </div>
  <div class="dp-row">
    <span class="dp-lbl">${data.actualProgressUnavailable ? "الإنجاز الفعلي غير متاح" : "الإنجاز حتى نهاية الفترة"}</span>
    <div class="dp-track"><div class="dp-fill-blue" style="width:${comparisonActual ?? 0}%"></div></div>
    <span class="dp-val" style="color:#2563eb">${displayedComparisonActual == null ? "—" : `${displayedComparisonActual}%`}</span>
  </div>
  ${plannedPct != null ? `<div class="dp-row">
    <span class="dp-lbl">المخطط</span>
    <div class="dp-track"><div class="dp-fill-gray" style="width:${plannedPct}%"></div></div>
    <span class="dp-val">${plannedPct}%</span>
  </div>` : ""}
  ${data.spi != null && snapshotAvailable && scheduleAvailable && (!data.actualHistoricalUnverified || data.approvedProgress) && !plannedUnverified ? `<div class="dp-row"><span class="dp-lbl">SPI</span><span class="dp-val">${(Math.round(data.spi * 100) / 100).toFixed(2)}</span></div>` : ""}
    ${historicalActual != null && pct != null && historicalActual !== pct ? `<div class="reported-progress-note">نسبة الإنجاز المُبلَّغ عنها في التقرير: ${pct}%</div>` : ""}
</div>

<!-- STATS -->
<div class="stats-row avoid-break">
  ${data.contractValue ? `<div class="stat">
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">💰</div>
    <div><div class="stat-lbl">قيمة العقد</div><div class="stat-val">${fmtMoney(data.contractValue)} <span class="stat-unit">د.ل</span></div></div>
  </div>` : ""}
  ${totalDuration != null ? `<div class="stat">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">📅</div>
    <div><div class="stat-lbl">مدة المشروع</div><div class="stat-val">${totalDuration} <span class="stat-unit">يوم</span></div></div>
  </div>` : ""}
  ${elapsed != null ? `<div class="stat">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">⏱️</div>
    <div><div class="stat-lbl">الأيام المنقضية</div><div class="stat-val">${elapsed} <span class="stat-unit">يوم (${elapsedPct ?? 0}%)</span></div></div>
  </div>` : ""}
  ${overrunDays > 0 ? `<div class="stat">
    <div class="stat-icon" style="background:#fef2f2;color:#dc2626">⚠️</div>
    <div><div class="stat-lbl">تجاوز المدة التعاقدية</div><div class="stat-val">${overrunDays} <span class="stat-unit">يوم</span></div></div>
  </div>` : remaining != null ? `<div class="stat">
    <div class="stat-icon" style="background:${remaining < 180 ? "#fef2f2" : "#f0f9ff"};color:${remaining < 180 ? "#dc2626" : "#0284c7"}">⏳</div>
    <div><div class="stat-lbl">الأيام المتبقية</div><div class="stat-val">${remaining} <span class="stat-unit">يوم</span></div></div>
  </div>` : ""}
</div>

<!-- TIMELINE -->
${scheduleAvailable && data.startDate && data.expectedEndDate ? `<div class="tl-box avoid-break">
  <div class="tl-title">الجدول الزمني للمشروع</div>
  <div class="tl-dates">
    <span>بداية: <strong>${fmtDate(data.startDate)}</strong></span>
    <span>نهاية: <strong>${fmtDate(data.expectedEndDate)}</strong></span>
  </div>
  <div class="tl-track"><div class="tl-fill" style="width:${elapsedPct ?? 0}%"></div></div>
  <div class="tl-legend">
    <span>🟦 الزمن المنقضي (${elapsedPct ?? 0}%)</span>
    <span>⬜ المتبقي (${100 - (elapsedPct ?? 0)}%)</span>
  </div>
</div>` : ""}

<!-- ACTIVITY SUMMARY -->
${acts.length > 0 ? `<div class="act-box avoid-break">
  <div class="act-title">ملخص حالة بنود الأعمال (${acts.length} بند)</div>
  <div class="act-grid">
    <div class="act-item">
      <div class="act-num" style="color:#16a34a">${completedCount}</div>
      <div class="act-dot" style="background:#16a34a"></div>
      <div class="act-lbl">مكتمل</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#2563eb">${inProgressCount}</div>
      <div class="act-dot" style="background:#2563eb"></div>
      <div class="act-lbl">قيد التنفيذ</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#dc2626">${delayedCount}</div>
      <div class="act-dot" style="background:#dc2626"></div>
      <div class="act-lbl">متأخر</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#6b7280">${notStartedCount}</div>
      <div class="act-dot" style="background:#6b7280"></div>
      <div class="act-lbl">لم يبدأ</div>
    </div>
  </div>
  <div class="act-bar">
    ${completedCount > 0 ? `<div class="act-seg" style="flex:${completedCount};background:#16a34a"></div>` : ""}
    ${inProgressCount > 0 ? `<div class="act-seg" style="flex:${inProgressCount};background:#2563eb"></div>` : ""}
    ${delayedCount > 0 ? `<div class="act-seg" style="flex:${delayedCount};background:#dc2626"></div>` : ""}
    ${notStartedCount > 0 ? `<div class="act-seg" style="flex:${notStartedCount};background:#d1d5db"></div>` : ""}
  </div>
</div>` : ""}

<!-- ACTIVITIES TABLE -->
${activitiesHTML}

<!-- WORK DESCRIPTION -->
<div class="section avoid-break">
    <div class="section-title">📝 وصف الأعمال المنجزة خلال الفترة</div>
  <p class="body-text">${esc(data.workDescription)}</p>
</div>

<!-- NOTES -->
${notesHTML}

<!-- RECOMMENDATIONS -->
${recsHTML}

<!-- IMAGES -->
${imagesHTML}

<!-- SIGNATURES -->
${(() => {
  let sigs = [
    { title: "المقاول المنفذ", name: data.contractor },
    { title: "الجهة المشرفة", name: data.supervisorEntity },
    { title: "الجهة المالكة", name: data.ownerEntity },
  ];
  if (data.reportSignatures && Array.isArray(data.reportSignatures)) {
    sigs = data.reportSignatures.map((sig: any) => ({
      title: sig.title || sig.role,
      name: sig.name || "—"
    }));
  }
  
  if (sigs.length === 0) return "";
  
  return `
  <div class="section avoid-break">
    <div class="section-title">التوقيعات والاعتماد</div>
    <div style="display: flex; gap: 10px; margin-top: 10px;">
      ${sigs.map(sig => `
        <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; height: 100px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${esc(sig.title)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">${esc(sig.name || "—")}</div>
          </div>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 4px; font-size: 10px; color: #94a3b8;">التوقيع والختم</div>
        </div>
      `).join('')}
    </div>
  </div>`;
})()}

<!-- FOOTER -->
<div class="footer avoid-break">
  <span></span>
  <span style="font-weight:700;color:#64748b">${periodOnly ? `الفترة ${periodLabel}` : `تقرير ${typeLbl} #${data.reportNumber ?? data.reportId}`}</span>
</div>

</body>
</html>`;
}

export function previewReport(data: ReportPdfData, targetWindow?: Window): void {
  const html = buildPrintHTML(data);
  const win = targetWindow ?? window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  if (win.closed) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export interface ExecutiveSummaryAI {
  headline: string;
  status: string;
  progressNote: string;
  decisionNote?: string;
  scheduleOutlook?: string;
  highlights: string[];
  risks: string[];
  nextActions: string[];
  executiveAssessment?: string;
  managementFocus?: string[];
}

export interface ExecutiveSummaryData {
  projectName: string;
  ownerEntity?: string | null;
  contractor?: string | null;
  supervisorEntity?: string | null;
  location?: string | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
  actualEndDate?: string | null;
  status?: string;
  overallProgress: number;
  plannedProgress: number | null;
  asOfDate?: string;
  curve?: string;
  spi?: number | null;
  progressDeviation?: number | null;
  forecastCompletionDate?: string | null;
  forecastDelayDays?: number | null;
  forecastStatus?: string;
  overrunDays?: number | null;
  dataStatus?: string;
  scheduleStatus?: string;
  activities: ActivityForReport[];
  reportsCount: number;
  contractValue?: number | null;
  companyLogos?: {
    owner?: CompanyLogo;
    contractor?: CompanyLogo;
    supervisor?: CompanyLogo;
  };
  apiBase?: string;
  suspensionDays?: number;
  extensionDays?: number;
  aiSummary?: ExecutiveSummaryAI | null;
  noSchedule?: boolean;
}

function startOfExecutiveDay(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysLateForExecutiveActivity(
  activity: ActivityForReport,
  noSchedule = false,
  today = new Date(),
): number {
  if (activity.delayDays !== undefined) return activity.delayDays ?? 0;
  if (noSchedule) return 0;
  const plannedStart = startOfExecutiveDay(activity.plannedStartDate);
  const plannedEnd = startOfExecutiveDay(activity.plannedEndDate);
  const actualEnd = startOfExecutiveDay(activity.actualEndDate);
  const currentDay = startOfExecutiveDay(today)!;
  const daysBetweenDates = (from: Date, to: Date) => Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86400000));

  if (activity.status === "completed" || activity.actualProgress >= 100) {
    return plannedEnd && actualEnd ? daysBetweenDates(plannedEnd, actualEnd) : 0;
  }
  if (activity.status === "not_started" && activity.actualProgress <= 0) {
    return plannedStart ? daysBetweenDates(plannedStart, currentDay) : 0;
  }
  return plannedEnd ? daysBetweenDates(plannedEnd, currentDay) : 0;
}

function isExecutiveActivityDelayed(
  activity: ActivityForReport,
  noSchedule = false,
  today = new Date(),
): boolean {
  if (typeof activity.delayed === "boolean") return activity.delayed;
  return daysLateForExecutiveActivity(activity, noSchedule, today) > 0;
}

function executivePriorityScore(activity: ActivityForReport, noSchedule = false): number {
  const delayDays = daysLateForExecutiveActivity(activity, noSchedule);
  const varianceGap = Math.max(0, (activity.plannedProgress ?? 0) - (activity.actualProgress ?? 0));
  const statusWeight = activity.status === "in_progress" ? 20 : activity.status === "not_started" ? 10 : activity.status === "completed" ? 5 : 0;
  return delayDays * 100 + varianceGap * 2 + statusWeight;
}

export function buildExecutiveSummaryHTML(data: ExecutiveSummaryData): string {
  const clampPct = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const actual = clampPct(data.overallProgress);
  const planned = data.plannedProgress==null ? Number.NaN : clampPct(data.plannedProgress);
  const deviation = actual - planned;
  const totalDays = daysBetween(data.startDate, data.expectedEndDate);
  const elapsedDays = daysBetween(data.startDate, data.asOfDate ?? new Date().toISOString());
  const remainingRaw = daysBetween(data.asOfDate ?? new Date().toISOString(), data.expectedEndDate);
  const remainingDays = remainingRaw == null ? null : Math.max(0, remainingRaw);
  const overrunDays = data.dataStatus === "stale" ? Number.NaN : data.overrunDays ?? Number.NaN;
  const elapsedPct = totalDays && elapsedDays != null ? clampPct((elapsedDays / totalDays) * 100) : null;
  const scheduleGap = Math.max(0, -deviation);

  const acts = data.activities ?? [];
  const isDelayed = (a: ActivityForReport) => isExecutiveActivityDelayed(a, data.noSchedule);
  const completed = acts.filter(a => a.status === 'completed').length;
  const inProgress = acts.filter(a => a.status === 'in_progress').length;
  const delayed = acts.filter(isDelayed).length;
  const notStarted = acts.filter(a => a.status === 'not_started').length;
  const total = acts.length;
  const statusLbl = ({ active: 'نشط', completed: 'مكتمل', delayed: 'متأخر', suspended: 'معلّق', on_hold: 'معلّق' } as Record<string, string>)[data.status ?? ''] ?? data.status ?? 'غير محددة';
  const statusTone = !Number.isFinite(overrunDays) ? 'neutral' : data.status === 'completed' || actual >= 100 ? 'good' : overrunDays > 0 || delayed > 0 || deviation < -5 ? 'risk' : 'neutral';
  const statusColor = statusTone === 'good' ? '#047857' : statusTone === 'risk' ? '#b91c1c' : '#1d4ed8';
  const statusBg = statusTone === 'good' ? '#ecfdf5' : statusTone === 'risk' ? '#fef2f2' : '#eff6ff';

  const escValue = (value: unknown) => esc(String(value ?? ''));
  const optionalMeta = [
    data.ownerEntity ? ['المالك', data.ownerEntity] : null,
    data.contractor ? ['المقاول', data.contractor] : null,
    data.supervisorEntity ? ['جهة الإشراف', data.supervisorEntity] : null,
    data.location ? ['الموقع', data.location] : null,
    data.startDate ? ['تاريخ البدء', fmtDate(data.startDate)] : null,
    data.expectedEndDate ? ['النهاية المجدولة الحالية', fmtDate(data.expectedEndDate)] : null,
    data.asOfDate ? ['تاريخ القياس', data.asOfDate] : null,
    data.contractValue != null ? ['قيمة العقد', `${fmtMoney(data.contractValue)} ر.س`] : null,
  ].filter(Boolean) as string[][];

  const logoItems = [data.companyLogos?.owner, data.companyLogos?.supervisor, data.companyLogos?.contractor]
    .filter((logo): logo is CompanyLogo => Boolean(logo?.logoUrl));
  const logosHtml = logoItems.length > 0 ? `<div class="logos-strip no-print-break">${logoItems.map(logo => {
    const url = logo.logoUrl!.startsWith('/') && data.apiBase ? data.apiBase + logo.logoUrl! : logo.logoUrl!;
    return `<div class="logo-item"><img src="${escAttr(url)}" alt="${escValue(logo.name)}"/><span>${escValue(logo.name)}</span></div>`;
  }).join('')}</div>` : '';

  const safeList = (items: string[] | undefined, limit = 4) => (items ?? [])
    .filter(item => typeof item === 'string' && item.trim())
    .slice(0, limit);
  const renderList = (items: string[] | undefined, limit = 4) => safeList(items, limit).map(item => `<li>${esc(item)}</li>`).join('');
  const hasList = (items: string[] | undefined) => safeList(items).length > 0;

  const orderedActivities = [...acts].sort((a, b) => {
    const scoreGap = executivePriorityScore(b, data.noSchedule) - executivePriorityScore(a, data.noSchedule);
    if (scoreGap !== 0) return scoreGap;
    const aEnd = startOfExecutiveDay(a.plannedEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bEnd = startOfExecutiveDay(b.plannedEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aEnd - bEnd;
  });
  const attentionActivities = orderedActivities.filter(a => {
    const delayedFlag = isDelayed(a);
    const varianceGap = (a.plannedProgress ?? 0) - (a.actualProgress ?? 0);
    return delayedFlag || varianceGap >= 5;
  });
  const stableActivitiesCount = Math.max(0, total - attentionActivities.length);
  const compactActivities = attentionActivities.length > 0 ? `<div class="activity-table-wrap"><table class="activity-table">
    <thead><tr><th>#</th><th>البند ذو الأولوية</th><th>التأخير</th><th>الإنجاز فعلي/مخطط</th><th>الفارق</th><th>الحالة</th></tr></thead>
    <tbody>${attentionActivities.map((a, index) => {
      const diff = (a.actualProgress ?? 0) - (a.plannedProgress ?? 0);
      const delayedFlag = isDelayed(a);
      const delayDays = daysLateForExecutiveActivity(a, data.noSchedule);
      const tone = delayedFlag || diff < 0 ? '#b91c1c' : '#047857';
      const planLabel=Number.isFinite(a.plannedProgress)?`${a.plannedProgress.toFixed(2)}%`:'—';
      const gapLabel=Number.isFinite(diff)?`${diff>0?'+':''}${diff.toFixed(2)} نقطة`:'—';
      return `<tr><td>${index+1}</td><td>${esc(a.name)}</td><td>${delayedFlag?`${delayDays} يوم`:'فجوة أداء'}</td><td>${a.actualProgress.toFixed(2)}% / ${planLabel}</td><td style="color:${tone}">${gapLabel}</td><td>${esc(statusLabelForActivity(a.status,delayedFlag))}</td></tr>`;
    }).join('')}</tbody>
  </table></div>` : `<div class="empty-note">لا توجد استثناءات تشغيلية تستدعي الإدراج؛ البنود المستقرة مدمجة في المؤشرات أعلاه.</div>`;

  function statusLabelForActivity(status: string, delayedFlag: boolean): string {
    if (delayedFlag) return 'متأخر';
    return ({ completed: 'مكتمل', in_progress: 'قيد التنفيذ', not_started: 'لم يبدأ', suspended: 'معلّق' } as Record<string, string>)[status] ?? status;
  }
  function statusColorForActivity(status: string, delayedFlag: boolean): string {
    if (delayedFlag) return '#b91c1c';
    return ({ completed: '#047857', in_progress: '#1d4ed8', not_started: '#64748b', suspended: '#b45309' } as Record<string, string>)[status] ?? '#475569';
  }
  function statusBgForActivity(status: string, delayedFlag: boolean): string {
    if (delayedFlag) return '#fef2f2';
    return ({ completed: '#ecfdf5', in_progress: '#eff6ff', not_started: '#f8fafc', suspended: '#fffbeb' } as Record<string, string>)[status] ?? '#f8fafc';
  }

  const ai = data.aiSummary;
  const aiHtml = ai ? `<section class="decision-section avoid-break">
    <div class="section-kicker">القراءة التنفيذية</div>
    <div class="decision-head"><div><h2>${esc(ai.headline)}</h2><p class="source-note">تحليل مولّد من سجل المشروع ومؤشرات التقدم الحالية فقط</p></div><span class="status-badge" style="color:${statusColor};background:${statusBg};border-color:${statusColor}">${esc(ai.status)}</span></div>
    <div class="decision-grid">
      <div class="decision-card primary"><div class="card-label">قراءة الأداء</div><p>${esc(ai.progressNote || 'لا توجد قراءة كمية إضافية موثقة.')}</p></div>
      <div class="decision-card"><div class="card-label">القرار / المتابعة المطلوبة</div><p>${esc(ai.decisionNote || 'لا توجد ملاحظة قرار إضافية؛ يعتمد التقييم على المؤشرات الرقمية.')}</p></div>
      <div class="decision-card schedule"><div class="card-label">المسار الزمني</div><p>${esc(ai.scheduleOutlook || 'لا يتوفر توقع زمني موثق.')}</p></div>
    </div>
  </section>` : '';

  const listSection = (title: string, className: string, items: string[] | undefined, limit = 4) => hasList(items) ? `<div class="list-card ${className} avoid-break"><div class="card-label">${title}</div><ul>${renderList(items, limit)}</ul></div>` : '';

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>ملخص حالة المشروع — ${esc(data.projectName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Latin Digits','Noto Kufi Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;background:#e5e7eb;color:#172033;font-size:10.5px;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:11mm 12mm 10mm}.no-print{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:8px;padding:10px;background:#172033}.no-print button{font:600 12px inherit;color:#fff;border:1px solid #334155;background:#24344d;border-radius:4px;padding:7px 16px;cursor:pointer}.no-print button:first-child{background:#1d4ed8;border-color:#1d4ed8}.brand-bar{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #1d4ed8;padding-bottom:9px;margin-bottom:9px}.brand-title{font-size:8px;letter-spacing:1.5px;color:#64748b;font-weight:800}.report-code{font-size:9px;color:#64748b}.hero{display:grid;grid-template-columns:1fr 118px;gap:14px;align-items:stretch;background:#172033;color:#fff;padding:16px 18px;border-radius:5px;margin-bottom:9px}.hero h1{font-size:20px;line-height:1.45;font-weight:800;margin-bottom:4px}.hero p{font-size:10px;color:#cbd5e1}.hero-side{border-right:1px solid #475569;padding-right:14px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:5px}.hero-side .label{font-size:8px;color:#94a3b8}.hero-side .status{font-size:13px;font-weight:800;border:1px solid #93c5fd;padding:4px 11px;border-radius:4px;color:#dbeafe;background:#263a5e}.logos-strip{display:flex;justify-content:center;gap:22px;align-items:center;margin-bottom:8px}.logo-item{display:flex;align-items:center;gap:5px;color:#64748b;font-size:8px}.logo-item img{max-width:55px;max-height:28px;object-fit:contain}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:9px}.meta-item{border:1px solid #dbe2ea;padding:5px 7px;border-radius:3px;min-width:0}.meta-item .key{display:block;font-size:7.5px;color:#64748b;margin-bottom:1px}.meta-item .value{display:block;font-size:9px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.section{margin-top:9px}.section-title{font-size:11px;font-weight:800;color:#172033;border-right:3px solid #1d4ed8;padding-right:7px;margin-bottom:6px}.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.kpi{border:1px solid #dbe2ea;border-top:3px solid #1d4ed8;border-radius:3px;padding:7px 6px;text-align:center;min-height:58px}.kpi.good{border-top-color:#059669}.kpi.risk{border-top-color:#dc2626}.kpi .value{font-size:18px;font-weight:800;line-height:1.25;color:#172033}.kpi .label{font-size:7.5px;color:#64748b;line-height:1.45;margin-top:2px}.meter{height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;margin-top:5px}.meter span{height:100%;display:block}.progress-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}.compare-row{display:flex;align-items:center;gap:6px;font-size:8px;color:#475569}.compare-row b{width:42px;color:#172033}.compare-line{height:6px;flex:1;background:#e5e7eb;overflow:hidden;border-radius:2px}.compare-line span{height:100%;display:block}.decision-section{margin-top:10px;border:1px solid #cbd5e1;border-radius:4px;padding:10px;background:#f8fafc}.section-kicker{font-size:8px;color:#1d4ed8;font-weight:800;letter-spacing:.5px;margin-bottom:3px}.decision-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid #dbe2ea;padding-bottom:7px}.decision-head h2{font-size:13px;line-height:1.65;color:#172033}.source-note{font-size:7.5px;color:#64748b;margin-top:2px}.status-badge{font-size:9px;font-weight:800;border:1px solid;padding:3px 8px;border-radius:3px;white-space:nowrap}.decision-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:6px;margin-top:7px}.decision-card{background:#fff;border:1px solid #dbe2ea;border-right:3px solid #64748b;padding:7px 8px;border-radius:3px;min-height:76px}.decision-card.primary{border-right-color:#1d4ed8}.decision-card.schedule{border-right-color:#047857}.card-label{font-size:8.5px;font-weight:800;color:#334155;margin-bottom:3px}.decision-card p{font-size:8.5px;line-height:1.8;color:#475569}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.list-card{background:#fff;border:1px solid #dbe2ea;border-top:3px solid #64748b;border-radius:3px;padding:7px 8px}.list-card ul{padding:0 15px 0 0;margin:0;color:#475569;font-size:8.5px;line-height:1.75}.list-card li{margin:1px 0}.list-card.risk{border-top-color:#dc2626}.list-card.action{border-top-color:#1d4ed8}.list-card.success{border-top-color:#059669}.list-card.focus{border-top-color:#7c3aed}.activities-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:6px}.activity-count{border:1px solid #dbe2ea;border-radius:3px;padding:5px;text-align:center}.activity-count b{display:block;font-size:15px;line-height:1.2}.activity-count span{font-size:7.5px;color:#64748b}.activity-table-wrap{border:1px solid #dbe2ea;border-radius:3px;overflow:visible}.activity-table{width:100%;border-collapse:collapse;font-size:8px;break-inside:auto;page-break-inside:auto}.activity-table th{background:#172033;color:#fff;padding:5px 6px;text-align:right;font-weight:700}.activity-table td{padding:5px 6px;border-bottom:1px solid #e5e7eb;vertical-align:middle}.activity-table tr:nth-child(even){background:#f8fafc}.activity-table td:not(:first-child),.activity-table th:not(:first-child){text-align:center}.activity-table td:first-child{font-weight:600;max-width:245px}.status-pill{display:inline-block;border-radius:3px;padding:1px 5px;font-size:7px;font-weight:700;white-space:nowrap}.empty-note{border:1px dashed #cbd5e1;padding:10px;text-align:center;color:#64748b;font-size:9px}.coverage{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #dbe2ea;margin-top:8px;padding-top:5px;color:#64748b;font-size:7.5px}.footer{border-top:1px solid #cbd5e1;margin-top:9px;padding-top:5px;display:flex;justify-content:space-between;color:#64748b;font-size:7px}@media print{body{background:#fff}.page{margin:0;width:auto;min-height:0;padding:0}.no-print{display:none!important}.avoid-break{break-inside:avoid;page-break-inside:avoid}.activity-table-wrap{break-inside:auto;page-break-inside:auto}.activity-table thead{display:table-header-group}.activity-table tr{break-inside:avoid;page-break-inside:avoid}}@media(max-width:800px){body{background:#fff}.page{width:100%;padding:16px}.meta-grid{grid-template-columns:repeat(2,1fr)}.kpi-grid{grid-template-columns:repeat(2,1fr)}.decision-grid,.two-col{grid-template-columns:1fr}.hero{grid-template-columns:1fr}.hero-side{border-right:0;border-top:1px solid #475569;padding:7px 0 0;align-items:flex-start}.activities-summary{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="no-print"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>
<main class="page">
  <div class="brand-bar"><span class="brand-title">CONSTRUCTION SUPERVISION · PROJECT STATUS REPORT</span><span class="report-code">تقرير حالة تنفيذي · ${fmtDate(new Date().toISOString())}</span></div>
  ${logosHtml}
  <section class="hero"><div><h1>${esc(data.projectName)}</h1><p>${esc(data.location ?? 'الموقع غير مسجل')} · ملخص تنفيذي مبني على السجل التشغيلي الحالي</p></div><div class="hero-side"><span class="label">الحالة الحالية</span><span class="status">${esc(statusLbl)}</span></div></section>
  ${optionalMeta.length > 0 ? `<section class="meta-grid">${optionalMeta.map(([key, value]) => `<div class="meta-item"><span class="key">${esc(key)}</span><span class="value">${esc(value)}</span></div>`).join('')}</section>` : ''}

  <section class="section avoid-break"><div class="section-title">لوحة المؤشرات الأساسية</div><div class="kpi-grid">
    <div class="kpi good"><div class="value">${actual.toFixed(2)}%</div><div class="label">الإنجاز الفعلي</div><div class="meter"><span style="width:${actual}%;background:#059669"></span></div></div>
    <div class="kpi"><div class="value">${data.plannedProgress==null?'—':`${planned.toFixed(2)}%`}</div><div class="label">الإنجاز المخطط</div><div class="meter"><span style="width:${Number.isFinite(planned)?planned:0}%;background:#2563eb"></span></div></div>
    <div class="kpi ${deviation < 0 ? 'risk' : Number.isFinite(deviation)?'good':''}"><div class="value" style="color:${deviation < 0 ? '#b91c1c' : '#172033'}">${Number.isFinite(deviation)?`${deviation > 0 ? '+' : ''}${deviation.toFixed(2)}`:'—'}</div><div class="label">الفارق بالنقاط المئوية</div></div>
    <div class="kpi"><div class="value">${data.spi==null?'—':data.spi.toFixed(2)}</div><div class="label">SPI (الفعلي ÷ المخطط)</div></div>
    <div class="kpi ${delayed > 0 ? 'risk' : 'good'}"><div class="value" style="color:${delayed > 0 ? '#b91c1c' : '#047857'}">${delayed}</div><div class="label">بنود متأخرة فعلياً</div></div>
    <div class="kpi ${overrunDays > 0 ? 'risk' : ''}"><div class="value" style="color:${overrunDays > 0 ? '#b91c1c' : '#172033'}">${!Number.isFinite(overrunDays)?'—':overrunDays>0?overrunDays:(remainingDays??'—')}</div><div class="label">${!Number.isFinite(overrunDays)?'تجاوز النهاية المجدولة غير متاح':overrunDays>0?'تجاوز النهاية بالأيام':'أيام متبقية'}</div></div>
  </div><div class="progress-compare"><div class="compare-row"><b>فعلي</b><div class="compare-line"><span style="width:${actual}%;background:#059669"></span></div><strong>${actual.toFixed(2)}%</strong></div><div class="compare-row"><b>مخطط</b><div class="compare-line"><span style="width:${Number.isFinite(planned)?planned:0}%;background:#2563eb"></span></div><strong>${data.plannedProgress==null?'—':`${planned.toFixed(2)}%`}</strong></div></div></section>

  ${aiHtml}

  <section class="section avoid-break"><div class="section-title">المدة والضبط الزمني</div><div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi"><div class="value">${totalDays ?? '—'}</div><div class="label">إجمالي المدة بالأيام</div></div>
    <div class="kpi"><div class="value">${elapsedDays != null ? Math.max(0, elapsedDays) : '—'}</div><div class="label">الأيام المنقضية</div></div>
    <div class="kpi"><div class="value">${data.suspensionDays ?? 0}</div><div class="label">توقفات مسجلة بالأيام</div></div>
    <div class="kpi"><div class="value">${data.extensionDays ?? 0}</div><div class="label">تمديدات مسجلة بالأيام</div></div>
  </div>${elapsedPct != null ? `<div class="compare-row" style="margin-top:6px"><b>استهلاك الزمن</b><div class="compare-line"><span style="width:${elapsedPct}%;background:#475569"></span></div><strong>${elapsedPct.toFixed(0)}%</strong></div>` : ''}</section>

  ${(hasList(ai?.highlights) || hasList(ai?.risks) || hasList(ai?.nextActions) || hasList(ai?.managementFocus)) ? `<section class="two-col">${listSection('إشارات إيجابية موثقة', 'success', ai?.highlights)}${listSection('المخاطر والقيود الموثقة', 'risk', ai?.risks)}${listSection('الإجراءات المطلوبة', 'action', ai?.nextActions)}${listSection('محاور المتابعة', 'focus', ai?.managementFocus, 3)}</section>` : ''}

  <section class="section"><div class="section-title avoid-break">الاستثناءات التشغيلية وأولوية المتابعة</div><div class="activities-summary avoid-break"><div class="activity-count"><b style="color:#b91c1c">${delayed}</b><span>متأخر فعلياً</span></div><div class="activity-count"><b style="color:#b45309">${Math.max(0, attentionActivities.length - delayed)}</b><span>فجوة أداء</span></div><div class="activity-count"><b style="color:#047857">${stableActivitiesCount}</b><span>مستقر ومدمج</span></div><div class="activity-count"><b style="color:#64748b">${total}</b><span>إجمالي البنود</span></div></div>${compactActivities}<div class="coverage avoid-break"><span>إجمالي البنود المسجلة: ${total}</span><span>المعروض تفصيلياً: ${attentionActivities.length} استثناء؛ البنود المستقرة مدمجة في الرقم الإجمالي</span></div></section>

  <footer class="footer"><span>هذا الملخص يعرض البيانات المسجلة في النظام دون إضافة معلومات غير موثقة.</span><span>التقارير المسجلة: ${data.reportsCount}</span></footer>
</main></body></html>`;
}
export function previewExecutiveSummary(data: ExecutiveSummaryData): void {
  const html = buildExecutiveSummaryHTML(data);
  const win = window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}


export function buildExecutiveSlidesHTML(data: ExecutiveSummaryData): string {
  const clampPct = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const actual = clampPct(data.overallProgress);
  const planned = data.plannedProgress==null ? Number.NaN : clampPct(data.plannedProgress);
  const deviation = actual - planned;
  const acts = data.activities ?? [];
  const isDelayed = (a: ActivityForReport) => isExecutiveActivityDelayed(a, data.noSchedule);
  const completed = acts.filter(a => a.status === "completed").length;
  const inProgress = acts.filter(a => a.status === "in_progress").length;
  const delayed = acts.filter(isDelayed).length;
  const notStarted = acts.filter(a => a.status === "not_started").length;
  const total = acts.length;
  const totalDays = daysBetween(data.startDate, data.expectedEndDate);
  const elapsedDays = daysBetween(data.startDate, data.asOfDate ?? new Date().toISOString());
  const remainingRaw = daysBetween(data.asOfDate ?? new Date().toISOString(), data.expectedEndDate);
  const remainingDays = remainingRaw == null ? null : Math.max(0, remainingRaw);
  const overrunDays = data.dataStatus === "stale" ? Number.NaN : data.overrunDays ?? Number.NaN;
  const elapsedPct = totalDays && elapsedDays != null ? clampPct((elapsedDays / totalDays) * 100) : null;
  const statusLabel = ({ active: "نشط", completed: "مكتمل", delayed: "متأخر", suspended: "متوقف", on_hold: "متوقف" } as Record<string, string>)[data.status ?? ""] ?? "غير محددة";
  const statusTone = !Number.isFinite(overrunDays) ? "neutral" : data.status === "completed" || actual >= 100 ? "good" : overrunDays > 0 || delayed > 0 || deviation < -5 ? "risk" : "neutral";
  const statusText = !Number.isFinite(overrunDays) ? "التقييم الزمني غير متاح" : statusTone === "good" ? "مستقر" : statusTone === "risk" ? "يتطلب تدخلاً" : "تحت المتابعة";
  const statusColor = statusTone === "good" ? "#047857" : statusTone === "risk" ? "#be123c" : "#1d4ed8";
  const ai = data.aiSummary ?? null;
  const escValue = (value: unknown) => esc(String(value ?? ""));
  const safeList = (items: unknown, limit: number) => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, limit) : [];
  const listItems = (items: unknown, empty = "لا توجد بيانات موثقة لهذا القسم.") => {
    const values = safeList(items, 4);
    return values.length ? `<ul>${values.map(item => `<li>${escValue(item)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
  };
  const progressBar = (value: number, color: string) => `<div class="bar"><span style="width:${clampPct(value)}%;background:${color}"></span></div>`;
  const isExecutiveDelayed = (a: ActivityForReport) => isExecutiveActivityDelayed(a, data.noSchedule);
  const priorityActivities = [...acts]
    .sort((a, b) => {
      const scoreGap = executivePriorityScore(b, data.noSchedule) - executivePriorityScore(a, data.noSchedule);
      if (scoreGap !== 0) return scoreGap;
      const aEnd = startOfExecutiveDay(a.plannedEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bEnd = startOfExecutiveDay(b.plannedEndDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aEnd - bEnd;
    })
    .filter(a => isExecutiveDelayed(a) || (a.plannedProgress ?? 0) - (a.actualProgress ?? 0) >= 5);
  const activityPageSize = 8;
  const activityPages = [];
  for (let offset = 0; offset < priorityActivities.length; offset += activityPageSize) {
    activityPages.push(priorityActivities.slice(offset, offset + activityPageSize));
  }
  if (activityPages.length === 0) activityPages.push([]);
  const activityPageCount = activityPages.length;
  const stableActivities = Math.max(0, total - priorityActivities.length);
  const deckTotal = 5 + activityPageCount;
  const activitySlides = activityPages.map((page, pageIndex) => {
    const rows = page.length ? page.map((a, index) => {
      const globalIndex = pageIndex * activityPageSize + index + 1;
      const gap = (a.actualProgress ?? 0) - (a.plannedProgress ?? 0);
      const delayedFlag = isExecutiveDelayed(a);
      const delayDays = daysLateForExecutiveActivity(a, data.noSchedule);
      const tone = delayedFlag || gap < 0 ? "risk" : "neutral";
      const planLabel=Number.isFinite(a.plannedProgress)?`${a.plannedProgress.toFixed(2)}%`:'—';
      const gapLabel=Number.isFinite(gap)?`${gap>0?'+':''}${gap.toFixed(2)} نقطة`:'—';
      return `<tr><td>${globalIndex}</td><td>${escValue(a.name)}</td><td>${delayedFlag?`${delayDays} يوم`:'فجوة أداء'}</td><td>${a.actualProgress.toFixed(2)}% / ${planLabel}</td><td class="${tone}">${gapLabel}</td><td>${escValue(statusLabelForActivity(a.status,delayedFlag))}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="muted center">لا توجد استثناءات تشغيلية تستدعي الإدراج؛ البنود المستقرة مدمجة في المؤشرات.</td></tr>`;
    const pageLabel = activityPageCount > 1 ? ` · صفحة ${pageIndex + 1} من ${activityPageCount}` : "";
    const title = pageIndex === 0 ? "الاستثناءات التشغيلية وأولوية المتابعة" : "استكمال الاستثناءات ذات الأثر";
    const attentionCount = priorityActivities.length;
    return `<section class="slide"><div class="slide-head"><div><div class="section-label">02 · جدول الاستثناءات${pageLabel}</div><h2>${title}</h2><p>لا تظهر البنود المستقرة تفصيلياً؛ الترتيب يبدأ بالتأخير الأعلى ثم فجوة الإنجاز.</p></div><div class="kicker">الاستثناءات ${attentionCount ? pageIndex * activityPageSize + 1 : 0}–${Math.min((pageIndex + 1) * activityPageSize, attentionCount)} من ${attentionCount}</div></div><div class="slide-inner"><div class="grid-4"><div class="panel metric"><div class="value risk">${delayed}</div><div class="label">متأخر فعلياً</div></div><div class="panel metric"><div class="value neutral">${Math.max(0, attentionCount - delayed)}</div><div class="label">فجوة أداء</div></div><div class="panel metric"><div class="value good">${stableActivities}</div><div class="label">مستقر ومدمج</div></div><div class="panel metric"><div class="value muted">${total}</div><div class="label">إجمالي البنود</div></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>البند ذو الأولوية</th><th>التأخير</th><th>فعلي / مخطط</th><th>الفارق</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div><div class="callout ${delayed > 0 ? "risk-callout" : attentionCount > 0 ? "risk-callout" : "good-callout"}">${delayed > 0 ? `تم إدراج جميع البنود المتأخرة (${delayed})، مع ترتيبها حسب أيام التأخير والفجوة المسجلة.` : attentionCount > 0 ? `توجد ${attentionCount} استثناءات أداء تحتاج متابعة؛ لا توجد بنود متأخرة زمنياً.` : "لا توجد استثناءات تشغيلية؛ البنود المستقرة مدمجة في المؤشرات."}</div></div><div class="footer"><span>الأولوية مبنية على التواريخ، أيام التأخير، وفجوة الفعلي عن المخطط</span><span>${String(3 + pageIndex).padStart(2, "0")} / ${String(deckTotal).padStart(2, "0")}</span></div></section>`;
  }).join("\n");
  const meta = [
    data.ownerEntity ? ["المالك", data.ownerEntity] : null,
    data.contractor ? ["المقاول", data.contractor] : null,
    data.supervisorEntity ? ["الإشراف", data.supervisorEntity] : null,
    data.location ? ["الموقع", data.location] : null,
  ].filter(Boolean) as string[][];
  const metaHtml = meta.length ? meta.map(([label, value]) => `<div><span>${escValue(label)}</span><b>${escValue(value)}</b></div>`).join("") : `<p class="muted">لا توجد بيانات تعريفية إضافية مسجلة.</p>`;
  const aiHeadline = ai?.headline?.trim() || "لا توجد قراءة تحليلية مولدة؛ يعتمد التقييم على المؤشرات الرقمية الموثقة.";
  const aiStatus = ai?.status?.trim() || statusText;
  const decisionNote = ai?.decisionNote?.trim() || "لا توجد ملاحظة قرار إضافية موثقة.";
  const scheduleOutlook = ai?.scheduleOutlook?.trim() || (!Number.isFinite(overrunDays) ? "تجاوز النهاية المجدولة غير متاح وفق البيانات الحالية." : overrunDays > 0 ? `يوجد تجاوز زمني مسجل قدره ${overrunDays} يوم.` : "لا يوجد تجاوز للنهاية المجدولة وفق اللقطة الحالية.");
  const title = escValue(data.projectName);
  const generatedAt = new Date().toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>العرض التنفيذي — ${title}</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap');@font-face{font-family:'Latin Digits';src:local('Arial'),local('Helvetica Neue'),local('sans-serif');unicode-range:U+0030-0039,U+002E,U+002C,U+0025,U+002B,U+002D}:root{--navy:#102a43;--blue:#1d4ed8;--ink:#16202a;--muted:#64748b;--line:#d9e2ec;--paper:#fff;--soft:#f6f8fb;--risk:#be123c;--good:#047857}
  *{box-sizing:border-box}body{margin:0;background:#e2e8f0;color:var(--ink);font-family:'Latin Digits','Noto Kufi Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:4;display:flex;justify-content:center;gap:10px;padding:12px;background:#102a43;color:#fff}.toolbar button{border:1px solid #486581;background:#1f466b;color:#fff;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer}.toolbar button:hover{background:#2f5f8c}.deck{display:grid;gap:20px;padding:24px}.slide{width:min(1280px,calc(100vw - 48px));aspect-ratio:16/9;min-height:540px;margin:0 auto;background:var(--paper);border:1px solid #cbd5e1;box-shadow:0 16px 36px rgba(15,23,42,.12);position:relative;display:flex;flex-direction:column;page-break-after:always}.slide.dark{background:var(--navy);color:#fff}.slide-inner{padding:42px 56px;flex:1;display:flex;flex-direction:column;gap:24px}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc;font-weight:700}.dark .eyebrow{color:#93c5fd}.title{font-size:clamp(28px,4vw,52px);line-height:1.15;margin:0;font-weight:800;max-width:900px}.subtitle{font-size:clamp(16px,1.7vw,23px);line-height:1.7;color:#cbd5e1;max-width:820px}.slide:not(.dark) .subtitle{color:var(--muted)}.slide-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:1px solid var(--line);padding:32px 56px 18px}.slide-head h2{font-size:clamp(22px,2.5vw,34px);margin:0 0 5px;font-weight:800}.slide-head p{margin:0;color:var(--muted);font-size:14px}.section-label{font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--blue);text-transform:uppercase}.status{display:inline-flex;align-items:center;gap:8px;border:1px solid currentColor;color:${statusColor};padding:7px 12px;font-size:14px;font-weight:800;white-space:nowrap}.status i{width:8px;height:8px;background:currentColor;display:inline-block;border-radius:50%}.grid-2{display:grid;grid-template-columns:1.15fr .85fr;gap:28px;min-height:0}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.panel{border:1px solid var(--line);padding:18px;background:#fff;min-width:0}.soft-panel{background:var(--soft);border:1px solid var(--line);padding:18px}.metric .value{font-size:34px;font-weight:800;line-height:1.1}.metric .label{font-size:12px;color:var(--muted);margin-top:6px}.metric .note{font-size:12px;color:var(--muted);margin-top:8px}.bar{height:10px;background:#e2e8f0;overflow:hidden}.bar span{display:block;height:100%}.compare{display:grid;grid-template-columns:100px 1fr 80px;align-items:center;gap:10px;font-size:13px}.compare+.compare{margin-top:14px}.compare strong{font-size:13px;text-align:left}.meta{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--line);border-right:1px solid var(--line)}.meta div{padding:12px;border-left:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:3px}.meta span{font-size:11px;color:var(--muted)}.meta b{font-size:14px}.kicker{font-size:12px;color:var(--muted);font-weight:700}.big-number{font-size:74px;line-height:1;font-weight:800;color:var(--blue)}.statement{font-size:22px;line-height:1.65;font-weight:700;margin:0}.muted{color:var(--muted)}.risk{color:var(--risk)}.good{color:var(--good)}.neutral{color:var(--blue)}.center{text-align:center}ul{margin:0;padding-right:20px;line-height:2;font-size:15px}li::marker{color:var(--blue)}.table-wrap{border:1px solid var(--line);overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th{background:var(--navy);color:#fff;text-align:right;padding:10px 12px;font-weight:700;white-space:nowrap}td{border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:middle}tr:last-child td{border-bottom:0}.callout{border-right:4px solid var(--blue);background:#eff6ff;padding:16px 18px;line-height:1.8}.callout.risk-callout{border-color:var(--risk);background:#fff1f2}.callout.good-callout{border-color:var(--good);background:#ecfdf5}.footer{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding:12px 56px;display:flex;justify-content:space-between;gap:12px}.dark .footer{border-color:#486581;color:#bcccdc}.dark .meta{border-color:#486581}.dark .meta div{border-color:#486581}.dark .meta span{color:#bcccdc}.dark .meta b{color:#fff}.source{font-size:11px;color:var(--muted);margin-top:auto}.dark .source{color:#bcccdc}@media(max-width:800px){.deck{padding:10px}.slide{width:100%;aspect-ratio:auto;min-height:680px}.slide-inner,.slide-head{padding:28px 24px}.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.meta{grid-template-columns:1fr}.footer{padding:12px 24px;flex-direction:column}.title{font-size:34px}.big-number{font-size:56px}}@media print{body{background:#fff}.toolbar{display:none}.deck{padding:0;display:block}.slide{width:297mm;height:210mm;min-height:0;aspect-ratio:auto;border:0;box-shadow:none;margin:0;page-break-after:always}.slide:last-child{page-break-after:auto}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div><main class="deck">
  <section class="slide dark"><div class="slide-inner"><div class="eyebrow">تقرير حالة المشروع · عرض تنفيذي</div><h1 class="title">${title}</h1><p class="subtitle">قراءة مركزة لحالة التنفيذ، مؤشرات الجدول الزمني، البنود ذات الأولوية، والمطلوب متابعته بناءً على السجلات الحالية في النظام.</p><div class="grid-2" style="margin-top:auto;align-items:end"><div class="meta">${metaHtml}</div><div><div class="kicker">الحالة المسجلة</div><div style="font-size:30px;font-weight:800;margin-top:8px">${escValue(statusLabel)}</div><div style="color:#bcccdc;margin-top:6px">${escValue(aiStatus)}</div></div></div><div class="source">تاريخ إنشاء العرض: ${generatedAt} · البيانات المعروضة من سجلات المشروع الحالية فقط</div></div><div class="footer"><span>ملخص حالة المشروع</span><span>01 / ${String(deckTotal).padStart(2, "0")}</span></div></section>
  <section class="slide">
    <div class="slide-head"><div><div class="section-label">01 · لوحة المؤشرات</div><h2>الوضع التنفيذي في لقطة واحدة</h2><p>تاريخ القياس ${escValue(data.asOfDate ?? 'غير متاح')} · المنحنى ${data.curve==='scurve'?'S':'الخطي'}</p></div><div class="status">${escValue(statusText)}</div></div>
    <div class="slide-inner"><div class="grid-4">
      <div class="panel metric"><div class="value">${actual.toFixed(2)}%</div><div class="label">الإنجاز الفعلي</div></div>
      <div class="panel metric"><div class="value">${Number.isFinite(planned)?`${planned.toFixed(2)}%`:'—'}</div><div class="label">الإنجاز المخطط</div></div>
      <div class="panel metric"><div class="value">${Number.isFinite(deviation)?`${deviation>0?'+':''}${deviation.toFixed(2)}`:'—'}</div><div class="label">الفارق بالنقاط المئوية</div></div>
      <div class="panel metric"><div class="value">${data.spi==null?'—':data.spi.toFixed(2)}</div><div class="label">SPI (الفعلي ÷ المخطط)</div></div>
    </div><div class="panel"><div class="kicker">مقارنة الإنجاز</div>
      <div class="compare"><span>فعلي</span>${progressBar(actual,"#1d4ed8")}<strong>${actual.toFixed(2)}%</strong></div>
      <div class="compare"><span>مخطط</span>${progressBar(planned,"#94a3b8")}<strong>${Number.isFinite(planned)?`${planned.toFixed(2)}%`:'—'}</strong></div>
    </div><div class="grid-3">
      <div class="soft-panel metric"><div class="value">${data.reportsCount}</div><div class="label">تقارير مسجلة</div></div>
      <div class="soft-panel metric"><div class="value">${data.suspensionDays??0}</div><div class="label">أيام توقف مسجلة، لا تُخصم تلقائيًا</div></div>
      <div class="soft-panel metric"><div class="value">${data.extensionDays??0}</div><div class="label">أيام التمديد المسجلة</div></div>
    </div></div><div class="footer"><span>المؤشرات الرقمية الموثقة</span><span>02 / ${String(deckTotal).padStart(2,"0")}</span></div>
  </section>
  ${activitySlides}
  <section class="slide"><div class="slide-head"><div><div class="section-label">03 · قراءة تنفيذية</div><h2>الاستنتاج التنفيذي</h2><p>الأرقام من الحساب الموثق، والأولويات منتقاة بتحليل الذكاء الاصطناعي.</p></div><div class="status">${escValue(aiStatus)}</div></div><div class="slide-inner"><div class="callout"><p class="statement">${escValue(aiHeadline)}</p></div><div class="grid-2"><div class="panel"><div class="section-label">قراءة التقدم</div><p>${escValue(ai?.progressNote || "التحليل غير متاح")}</p></div><div class="panel"><div class="section-label">الرؤية الزمنية</div><p>${escValue(scheduleOutlook)}</p></div></div><div class="panel"><div class="section-label">ملاحظة القرار</div><p>${escValue(decisionNote)}</p></div></div><div class="footer"><span>التحليل التنفيذي</span><span>${String(3 + activityPageCount).padStart(2,"0")} / ${deckTotal}</span></div></section>
  <section class="slide"><div class="slide-head"><div><div class="section-label">04 · المخاطر والإجراءات</div><h2>ما يحتاج إلى متابعة مباشرة</h2><p>قائمة مختصرة قابلة للتحويل إلى اجتماع متابعة أو محضر قرار.</p></div><div class="status"><i></i>${escValue(statusText)}</div></div><div class="slide-inner"><div class="grid-2"><div class="panel"><div class="section-label risk">المخاطر والقيود</div>${listItems(ai?.risks, delayed > 0 ? `تأخير مسجل في ${delayed} بند؛ يلزم الرجوع إلى تفاصيل البنود.` : "لا توجد مخاطر إضافية موثقة في الملخص الحالي.")}</div><div class="panel"><div class="section-label neutral">الإجراءات التالية</div>${listItems(ai?.nextActions, "لا توجد إجراءات إضافية مولدة؛ راجع البنود ذات الأولوية.")}</div></div><div class="grid-2"><div class="panel"><div class="section-label good">الإشارات الإيجابية</div>${listItems(ai?.highlights, completed > 0 ? `تم تسجيل ${completed} بند مكتمل.` : "لا توجد إشارات إيجابية إضافية موثقة.")}</div><div class="panel"><div class="section-label">محاور المتابعة</div>${listItems(ai?.managementFocus, "لا توجد محاور متابعة إضافية موثقة.")}</div></div><div class="callout ${!Number.isFinite(overrunDays)?'':overrunDays>0||delayed>0?'risk-callout':'good-callout'}">${!Number.isFinite(overrunDays)?"تجاوز النهاية المجدولة غير متاح؛ لا تكفي البيانات لإثبات حالة الموعد.":overrunDays>0?`تجاوز مسجل قدره ${overrunDays} يوم.`:delayed>0?`${delayed} بنود متأخرة وفق اللقطة الحالية.`:"لا يوجد تجاوز للنهاية المجدولة وفق اللقطة الحالية."}</div></div><div class="footer"><span>إجراءات مبنية على المؤشرات المتاحة</span><span>${String(4 + activityPageCount).padStart(2, "0")} / ${String(deckTotal).padStart(2, "0")}</span></div></section>
  <section class="slide dark"><div class="slide-head"><h2>موجز القرار</h2></div><div class="slide-inner"><div class="big-number" style="color:#7dd3fc">${actual.toFixed(2)}%</div><p class="subtitle">${escValue(ai?.decisionNote || "التحليل غير متاح")}</p><div class="meta">${metaHtml}</div><p>بنود متأخرة: ${delayed} · تقارير مسجلة: ${data.reportsCount}</p><p>لا يُحسب صافي تأخر سببي من نسب الإنجاز وحدها.</p></div><div class="footer"><span>نهاية العرض</span><span>${deckTotal} / ${deckTotal}</span></div></section>
  </main></body></html>`;
}

function statusLabelForActivity(status: string, delayed: boolean): string {
  if (delayed) return "متأخر";
  return ({ completed: "مكتمل", in_progress: "قيد التنفيذ", not_started: "لم يبدأ" } as Record<string, string>)[status] ?? status;
}

export function previewExecutiveSlides(data: ExecutiveSummaryData): void {
  const html = buildExecutiveSlidesHTML(data);
  const win = window.open("", "_blank", "width=1280,height=820,scrollbars=yes");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام العرض التقديمي");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export type AttendanceSessionStatus = "closed" | "open" | "auto_closed";

export interface AttendanceReportSession {
  checkInRecordId: number;
  checkOutRecordId: number | null;
  checkInAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  status: AttendanceSessionStatus;
}

export interface AttendanceReportDay {
  date: string;
  sessions: AttendanceReportSession[];
  totalMinutes: number;
  flags: { incomplete: boolean; longDay: boolean };
}

export interface AttendanceReportSummary {
  totalMinutes: number;
  workDays: number;
  averageDailyMinutes: number;
  incompleteDays: number;
  longDays: number;
}

export interface AttendanceReportData {
  projectName: string;
  ownerEntity?: string | null;
  contractor?: string | null;
  supervisorEntity?: string | null;
  location?: string | null;
  employeeName: string;
  employeeRole?: string | null;
  employeePhone?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  days: AttendanceReportDay[];
  summary: AttendanceReportSummary;
  autoCloseHours: number;
  longDayHours: number;
  companyLogos?: {
    owner?: CompanyLogo;
    contractor?: CompanyLogo;
    supervisor?: CompanyLogo;
  };
  apiBase?: string;
}

const ATTENDANCE_ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام",
  project_manager: "مدير المشروع",
  engineer: "مهندس",
  contractor: "مقاول",
  owner: "صاحب المشروع",
};

function fmtLibyaTimeForReport(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Tripoli",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function fmtDurationHHMM(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function fmtDurationHTML(mins: number | null | undefined): string {
  if (mins == null || !isFinite(mins)) return "—";
  return `${fmtDurationHHMM(mins)} <span class="stat-unit">س:د</span>`;
}

function buildAttendanceReportHTML(data: AttendanceReportData): string {
  const roleLbl = data.employeeRole ? (ATTENDANCE_ROLE_LABEL[data.employeeRole] ?? data.employeeRole) : "";

  const summary = data.summary;
  const totalMins = summary.totalMinutes;
  const workDays = summary.workDays;
  const incompleteDays = summary.incompleteDays;
  const longDays = summary.longDays;
  const avgMins = summary.averageDailyMinutes;

  const metaRows = [
    data.ownerEntity ? ["جهة المالك", data.ownerEntity] : null,
    data.contractor ? ["المقاول", data.contractor] : null,
    data.supervisorEntity ? ["جهة الإشراف", data.supervisorEntity] : null,
    data.location ? ["الموقع", data.location] : null,
  ].filter(Boolean) as string[][];

  const logosHTML = (() => {
    const logos = data.companyLogos;
    const base = data.apiBase || "";
    if (!logos || (!logos.owner?.logoUrl && !logos.contractor?.logoUrl && !logos.supervisor?.logoUrl)) return "";
    const entries: Array<{ role: string; name: string; src: string }> = [];
    if (logos.owner) entries.push({ role: "جهة المالك", name: logos.owner.name, src: logos.owner.logoUrl ? escAttr(reportAssetUrl(logos.owner.logoUrl, base)) : "" });
    if (logos.contractor) entries.push({ role: "المقاول", name: logos.contractor.name, src: logos.contractor.logoUrl ? escAttr(reportAssetUrl(logos.contractor.logoUrl, base)) : "" });
    if (logos.supervisor) entries.push({ role: "جهة الإشراف", name: logos.supervisor.name, src: logos.supervisor.logoUrl ? escAttr(reportAssetUrl(logos.supervisor.logoUrl, base)) : "" });
    const html = entries.map(e => `<div class="logo-item">
      <div class="logo-role">${e.role}</div>
      <div class="logo-img-box">${e.src ? `<img src="${e.src}" onerror="this.style.display='none'" />` : ""}</div>
      <div class="logo-name">${esc(e.name)}</div>
    </div>`).join("");
    return `<div class="logos-strip avoid-break">${html}</div>`;
  })();

  const rowsHTML = data.days.length === 0
    ? `<tr><td class="td tc" colspan="7" style="color:#94a3b8;padding:24px 10px">لا توجد سجلات لهذه الفترة.</td></tr>`
    : data.days.flatMap((d, di) => {
        const bg = di % 2 === 0 ? "#fff" : "#f8fafc";
        const sessions = d.sessions.length === 0 ? [null] : d.sessions;
        const flagsHTML = `
          ${d.flags.incomplete ? `<span class="badge badge-red">غير مكتمل</span>` : ""}
          ${d.flags.longDay ? `<span class="badge badge-amber">يوم طويل</span>` : ""}
          ${d.sessions.some(s => s?.status === "auto_closed") ? `<span class="badge badge-slate">إغلاق تلقائي</span>` : ""}
        `.trim();
        return sessions.map((s, idx) => {
          const isFirst = idx === 0;
          const rowSpan = sessions.length;
          let statusBadge = "";
          if (s?.status === "auto_closed") statusBadge = `<span class="badge badge-amber">إغلاق تلقائي</span>`;
          else if (s?.status === "open") statusBadge = `<span class="badge badge-red">مفتوحة</span>`;
          return `<tr style="background:${bg}">
            ${isFirst ? `<td class="td tc" rowspan="${rowSpan}" style="font-weight:700;vertical-align:middle">${esc(fmtDate(d.date))}</td>` : ""}
            <td class="td tc">${s ? `#${idx + 1}` : "—"}</td>
            <td class="td tc">${esc(fmtLibyaTimeForReport(s?.checkInAt ?? null))}</td>
            <td class="td tc">${esc(fmtLibyaTimeForReport(s?.checkOutAt ?? null))} ${statusBadge}</td>
            <td class="td tc">${s ? esc(fmtDurationHHMM(s.durationMinutes)) : "—"}</td>
            ${isFirst ? `<td class="td tc" rowspan="${rowSpan}" style="font-weight:700;vertical-align:middle">${esc(fmtDurationHHMM(d.totalMinutes))}</td>` : ""}
            ${isFirst ? `<td class="td tc" rowspan="${rowSpan}" style="vertical-align:middle">${flagsHTML || "—"}</td>` : ""}
          </tr>`;
        });
      }).join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>تقرير حضور — ${esc(data.employeeName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm 14mm 14mm; }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Latin Digits', 'Noto Kufi Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1e293b;
    direction: rtl;
    text-align: right;
    background: #fff;
    overflow-x: hidden;
    overflow-wrap: break-word;
    word-wrap: break-word;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .avoid-break { break-inside: avoid; page-break-inside: avoid; }

  .logos-strip {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 32px;
    flex-wrap: wrap;
    padding: 18px 24px;
    margin-bottom: 12px;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
  }
  .logo-item { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; min-width: 0; max-width: 200px; }
  .logo-img-box {
    width: 80px; height: 80px;
    border-radius: 12px;
    border: 1.5px solid #e2e8f0;
    background: #f8fafc;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; padding: 4px;
    flex-shrink: 0;
  }
  .logo-img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .logo-role { font-size: 10px; font-weight: 700; color: #64748b; }
  .logo-name { font-size: 12px; font-weight: 700; color: #1e293b; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .header {
    background: #1e293b;
    color: #fff;
    padding: 24px 28px 20px;
    border-radius: 10px;
    margin-bottom: 16px;
    position: relative;
    overflow: hidden;
  }
  .header::before {
    content: ''; position: absolute;
    top: -50px; left: -50px;
    width: 150px; height: 150px;
    background: rgba(255,255,255,0.04);
    border-radius: 50%;
  }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; position: relative; z-index: 1; }
  .header-info { flex: 1; min-width: 0; }
  .header-sys { font-size: 10px; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.45); margin-bottom: 6px; }
  .header-name { font-size: 22px; font-weight: 800; line-height: 1.3; margin-bottom: 12px; overflow-wrap: anywhere; }
  .header-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-block; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 12px; font-size: 11px; color: rgba(255,255,255,0.8); max-width: 100%; overflow-wrap: anywhere; }
  .header-badge { background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.25); border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 90px; flex-shrink: 0; }
  .badge-lbl { font-size: 9px; color: rgba(255,255,255,0.5); margin-bottom: 4px; }
  .badge-val { font-size: 16px; font-weight: 800; white-space: nowrap; }

  .info-strip { display: flex; flex-wrap: wrap; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .info-cell { flex: 1 1 25%; min-width: 0; text-align: center; padding: 12px 8px; border-left: 1px solid #e2e8f0; }
  .info-cell:first-child { border-left: none; }
  .info-lbl { font-size: 10px; color: #64748b; font-weight: 600; margin-bottom: 3px; }
  .info-val { font-size: 14px; font-weight: 800; color: #1e293b; overflow-wrap: anywhere; }

  .stats-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
  .stat { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; min-width: 0; }
  .stat-icon { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
  .stat > div:not(.stat-icon) { min-width: 0; flex: 1; }
  .stat-lbl { font-size: 11px; color: #64748b; font-weight: 600; }
  .stat-val { font-size: 16px; font-weight: 800; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .stat-unit { font-size: 11px; font-weight: 600; color: #94a3b8; }

  .section { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; background: #fafbfc; }
  .section-title { font-size: 15px; font-weight: 700; color: #334155; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
  .blue-title { color: #1e40af; border-bottom-color: #bfdbfe; }

  .tbl-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .th { background: #f1f5f9; padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; border-bottom: 2px solid #cbd5e1; text-align: center; }
  .tc { text-align: center !important; }
  .td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: middle; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; line-height: 1.4; }
  .badge-red { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
  .badge-amber { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .badge-slate { background: #e2e8f0; color: #475569; border: 1px solid #cbd5e1; }

  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 11px; color: #94a3b8; }

  .toolbar { position: sticky; top: 0; left: 0; right: 0; background: #1e293b; padding: 10px 16px; display: flex; justify-content: center; align-items: center; gap: 10px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .btn-print { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .btn-print:hover { background: #1d4ed8; }
  .btn-close { background: rgba(255,255,255,0.15); color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .btn-close:hover { background: rgba(255,255,255,0.25); }

  @media print { .toolbar { display: none !important; } }
  @media screen { body { max-width: 210mm; margin: 0 auto; padding-left: 16px; padding-right: 16px; } }

  /* Mobile / narrow screens — keep layout readable on phones without affecting print or desktop preview. */
  @media screen and (max-width: 640px) {
    body { padding-left: 10px; padding-right: 10px; font-size: 13px; }
    .toolbar { padding: 8px 10px; gap: 8px; }
    .btn-print { padding: 9px 14px; font-size: 13px; }
    .btn-close { padding: 9px 12px; font-size: 13px; }

    .logos-strip { gap: 18px; padding: 14px 12px; }
    .logo-item { max-width: 130px; }
    .logo-img-box { width: 64px; height: 64px; }
    .logo-name { font-size: 11px; white-space: normal; line-height: 1.3; }

    .header { padding: 16px 16px 14px; }
    .header-row { flex-direction: column; align-items: stretch; gap: 12px; }
    .header-name { font-size: 18px; margin-bottom: 10px; }
    .header-badge { align-self: flex-start; padding: 8px 14px; min-width: 0; }
    .badge-lbl { font-size: 9px; }
    .badge-val { font-size: 14px; }
    .pill { font-size: 10px; padding: 3px 10px; }

    .info-cell { flex: 1 1 50%; border-left: none; border-bottom: 1px solid #e2e8f0; }
    .info-cell:nth-child(2n) { border-left: 1px solid #e2e8f0; }
    .info-cell:nth-last-child(-n+2) { border-bottom: none; }
    .info-val { font-size: 13px; }

    .stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .stat { padding: 12px 12px; gap: 10px; }
    .stat-icon { width: 36px; height: 36px; }
    .stat-icon svg { width: 18px; height: 18px; }
    .stat-val { font-size: 15px; }

    .section { padding: 14px 12px; }
    .th, .td { padding: 8px 6px; font-size: 12px; }

    .footer { font-size: 10px; }
  }
</style>
</head>
<body>

<div class="toolbar">
  <button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <button class="btn-close" onclick="window.close()">✕ إغلاق</button>
</div>

${logosHTML}

<!-- HEADER -->
<div class="header avoid-break">
  <div class="header-row">
    <div class="header-info">
      <div class="header-sys">إدارة الإشراف والمتابعة</div>
      <div class="header-name">${esc(data.projectName)}</div>
      <div class="header-pills">
        ${metaRows.map(([l, v]) => `<span class="pill">${l}: ${esc(v)}</span>`).join("")}
      </div>
    </div>
    <div class="header-badge">
      <div class="badge-lbl">نوع التقرير</div>
      <div class="badge-val">حضور موظف</div>
    </div>
  </div>
</div>

<!-- INFO STRIP -->
<div class="info-strip avoid-break">
  <div class="info-cell"><div class="info-lbl">الموظف</div><div class="info-val">${esc(data.employeeName)}</div></div>
  ${roleLbl ? `<div class="info-cell"><div class="info-lbl">الدور</div><div class="info-val">${esc(roleLbl)}</div></div>` : ""}
  <div class="info-cell"><div class="info-lbl">من تاريخ</div><div class="info-val">${esc(fmtDate(data.dateFrom))}</div></div>
  <div class="info-cell"><div class="info-lbl">إلى تاريخ</div><div class="info-val">${esc(fmtDate(data.dateTo))}</div></div>
</div>

<!-- STATS -->
<div class="stats-row avoid-break">
  <div class="stat">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    </div>
    <div><div class="stat-lbl">إجمالي الساعات</div><div class="stat-val">${fmtDurationHTML(totalMins)}</div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
    </div>
    <div><div class="stat-lbl">عدد أيام العمل</div><div class="stat-val">${workDays} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 8"/></svg>
    </div>
    <div><div class="stat-lbl">متوسط اليوم</div><div class="stat-val">${fmtDurationHTML(avgMins)}</div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:${incompleteDays > 0 ? "#fef2f2" : "#f8fafc"};color:${incompleteDays > 0 ? "#dc2626" : "#94a3b8"}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <div><div class="stat-lbl">أيام غير مكتملة</div><div class="stat-val">${incompleteDays} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:${longDays > 0 ? "#fffbeb" : "#f8fafc"};color:${longDays > 0 ? "#b45309" : "#94a3b8"}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <div><div class="stat-lbl">أيام طويلة (≥ ${data.longDayHours} س)</div><div class="stat-val">${longDays} <span class="stat-unit">يوم</span></div></div>
  </div>
</div>

<!-- DETAILS TABLE -->
<div class="section avoid-break">
  <div class="section-title blue-title">سجل الحضور والانصراف اليومي</div>
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr>
          <th class="th" style="width:18%">التاريخ</th>
          <th class="th" style="width:8%">جلسة</th>
          <th class="th" style="width:14%">حضور</th>
          <th class="th" style="width:18%">انصراف</th>
          <th class="th" style="width:12%">المدة</th>
          <th class="th" style="width:12%">إجمالي اليوم</th>
          <th class="th" style="width:18%">حالة</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>
  </div>
</div>

<!-- FOOTER -->
<div class="footer avoid-break">
  <span></span>
  <span style="font-weight:700;color:#64748b">الملف التعريفي — ${esc(data.projectName)}</span>
</div>

</body>
</html>`;
}

export function previewAttendanceReport(data: AttendanceReportData): void {
  const html = buildAttendanceReportHTML(data);
  const win = window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

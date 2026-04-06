export interface ActivityForReport {
  name: string;
  plannedProgress: number;
  actualProgress: number;
  status: string;
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
  progressPercentage: number;
  workDescription: string;
  technicalNotes?: string | null;
  recommendations?: string | null;
  imageUrls?: string[];
  reportId: number;
  activities?: ActivityForReport[];
  contractValue?: number | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
  plannedProgress?: number | null;
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

function buildPrintHTML(data: ReportPdfData): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));
  const plannedPct = data.plannedProgress != null ? Math.min(100, Math.max(0, data.plannedProgress)) : null;
  const deviation = plannedPct != null ? pct - plannedPct : null;

  const metaItems = [
    data.ownerEntity ? ["جهة المالك", data.ownerEntity] : null,
    data.contractor ? ["المقاول", data.contractor] : null,
    data.supervisorEntity ? ["جهة الإشراف", data.supervisorEntity] : null,
    data.location ? ["الموقع", data.location] : null,
  ].filter(Boolean) as string[][];

  const infoItems = [
    ["تاريخ التقرير", fmtDate(data.reportDate)],
    ["بداية الفترة", fmtDate(data.periodStart)],
    ["نهاية الفترة", fmtDate(data.periodEnd)],
    ["رقم التقرير", `#${data.reportId}`],
  ];

  const totalDuration = daysBetween(data.startDate, data.expectedEndDate);
  const elapsed = daysBetween(data.startDate, data.reportDate);
  const remaining = daysBetween(data.reportDate, data.expectedEndDate);
  const elapsedPct = totalDuration && elapsed != null ? Math.round((elapsed / totalDuration) * 100) : null;

  const acts = data.activities ?? [];
  const completedCount = acts.filter(a => a.status === "completed").length;
  const inProgressCount = acts.filter(a => a.status === "in_progress").length;
  const delayedCount = acts.filter(a => a.status === "delayed").length;
  const notStartedCount = acts.filter(a => a.status === "not_started").length;

  const activitiesHTML = data.activities && data.activities.length > 0 ? `
    <div class="card avoid-break">
      <div class="card-hd card-hd-blue">
        <span class="card-icon">📋</span> حالة الأنشطة
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th class="tbl-th" style="text-align:right;width:40%">النشاط</th>
            <th class="tbl-th tbl-center" style="width:15%">مخطط %</th>
            <th class="tbl-th tbl-center" style="width:15%">فعلي %</th>
            <th class="tbl-th tbl-center" style="width:15%">الحالة</th>
            <th class="tbl-th" style="width:15%">الإنجاز</th>
          </tr>
        </thead>
        <tbody>
          ${data.activities.map((a, i) => {
            const barW = Math.min(100, Math.max(0, a.actualProgress));
            return `<tr class="${i % 2 === 0 ? "row-w" : "row-g"}">
              <td class="tbl-td">${esc(a.name)}</td>
              <td class="tbl-td tbl-center">${a.plannedProgress}%</td>
              <td class="tbl-td tbl-center" style="font-weight:700">${a.actualProgress}%</td>
              <td class="tbl-td tbl-center">
                <span class="badge" style="background:${statusBg(a.status)};color:${statusColor(a.status)};border-color:${statusColor(a.status)}">
                  ${statusLabel(a.status)}
                </span>
              </td>
              <td class="tbl-td">
                <div class="bar-track"><div class="bar-fill" style="width:${barW}%;background:${statusColor(a.status)}"></div></div>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>` : "";

  const notesHTML = data.technicalNotes ? `
    <div class="card avoid-break card-warn">
      <div class="card-hd card-hd-warn">
        <span class="card-icon">⚠️</span> الملاحظات الفنية
      </div>
      <p class="card-text">${esc(data.technicalNotes)}</p>
    </div>` : "";

  const recsHTML = data.recommendations ? `
    <div class="card avoid-break card-success">
      <div class="card-hd card-hd-success">
        <span class="card-icon">✅</span> التوصيات
      </div>
      <p class="card-text">${esc(data.recommendations)}</p>
    </div>` : "";

  const images = data.imageUrls ?? [];
  const imagesHTML = images.length > 0 ? `
    <div class="images-section">
      <h3 class="images-title avoid-break">
        <span class="card-icon">📷</span> صور الموقع (${images.length} صورة)
      </h3>
      <div class="img-grid">
        ${images.map((url, i) => { const safe = escAttr(url); return safe ? `
          <div class="img-card avoid-break">
            <img src="${safe}" class="img-photo" onerror="this.parentNode.style.display='none'" />
            <div class="img-label">صورة ${i + 1} من ${images.length}</div>
          </div>` : ""; }).join("")}
      </div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width"/>
<title>تقرير ${typeLbl} — ${esc(data.projectName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page {
    size: A4 portrait;
    margin: 15mm 18mm 18mm 18mm;
  }

  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1e293b;
    direction: rtl;
    text-align: right;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* ═══════ HEADER ═══════ */
  .report-header {
    background: linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%);
    color: #fff;
    padding: 20pt 24pt 16pt;
    border-radius: 8pt;
    margin-bottom: 14pt;
    break-inside: avoid;
    page-break-inside: avoid;
    position: relative;
    overflow: hidden;
  }
  .report-header::before {
    content: '';
    position: absolute;
    top: -40pt;
    left: -40pt;
    width: 120pt;
    height: 120pt;
    background: rgba(255,255,255,0.04);
    border-radius: 50%;
  }
  .report-header::after {
    content: '';
    position: absolute;
    bottom: -30pt;
    right: -30pt;
    width: 100pt;
    height: 100pt;
    background: rgba(255,255,255,0.03);
    border-radius: 50%;
  }
  .hdr-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    position: relative;
    z-index: 1;
  }
  .hdr-info { flex: 1; }
  .hdr-sys {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 2pt;
    color: rgba(255,255,255,0.5);
    margin-bottom: 6pt;
  }
  .hdr-title {
    font-size: 18pt;
    font-weight: 800;
    line-height: 1.3;
    margin-bottom: 10pt;
  }
  .hdr-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt;
  }
  .hdr-pill {
    display: inline-block;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 20pt;
    padding: 2pt 10pt;
    font-size: 8pt;
    color: rgba(255,255,255,0.8);
  }
  .hdr-badge {
    background: rgba(255,255,255,0.12);
    border: 1.5pt solid rgba(255,255,255,0.25);
    border-radius: 10pt;
    padding: 10pt 16pt;
    text-align: center;
    min-width: 80pt;
  }
  .hdr-badge-label { font-size: 7pt; color: rgba(255,255,255,0.5); margin-bottom: 3pt; }
  .hdr-badge-value { font-size: 16pt; font-weight: 800; }

  /* ═══════ INFO STRIP ═══════ */
  .info-strip {
    display: flex;
    background: #f1f5f9;
    border: 1pt solid #e2e8f0;
    border-radius: 6pt;
    margin-bottom: 14pt;
    overflow: hidden;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .info-cell {
    flex: 1;
    text-align: center;
    padding: 10pt 6pt;
    border-right: 1pt solid #e2e8f0;
  }
  .info-cell:last-child { border-right: none; }
  .info-lbl { font-size: 7pt; color: #64748b; font-weight: 600; margin-bottom: 2pt; text-transform: uppercase; letter-spacing: 0.5pt; }
  .info-val { font-size: 12pt; font-weight: 800; color: #1e293b; }

  /* ═══════ PROGRESS ═══════ */
  .progress-box {
    margin-bottom: 14pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .progress-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5pt;
  }
  .progress-lbl { font-size: 10pt; font-weight: 600; color: #475569; }
  .progress-num { font-size: 22pt; font-weight: 800; color: #2563eb; }
  .progress-track {
    height: 10pt;
    background: #e2e8f0;
    border-radius: 5pt;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    width: ${pct}%;
    background: linear-gradient(90deg, #2563eb, #60a5fa);
    border-radius: 5pt;
    transition: width 0.3s;
  }

  /* ═══════ CARDS ═══════ */
  .card {
    border: 1pt solid #e2e8f0;
    border-radius: 8pt;
    padding: 14pt 16pt;
    margin-bottom: 12pt;
    background: #fafbfc;
  }
  .card-warn { background: #fffbeb; border-color: #fcd34d; }
  .card-success { background: #f0fdf4; border-color: #86efac; }
  .card-hd {
    font-size: 11pt;
    font-weight: 700;
    color: #334155;
    margin-bottom: 8pt;
    padding-bottom: 6pt;
    border-bottom: 1.5pt solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 6pt;
  }
  .card-hd-blue { color: #1e40af; border-bottom-color: #bfdbfe; }
  .card-hd-warn { color: #b45309; border-bottom-color: #fcd34d; }
  .card-hd-success { color: #166534; border-bottom-color: #86efac; }
  .card-icon { font-size: 12pt; }
  .card-text {
    font-size: 10.5pt;
    color: #475569;
    line-height: 2;
    white-space: pre-wrap;
  }

  /* ═══════ TABLE ═══════ */
  .tbl { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .tbl-th {
    background: #f1f5f9;
    padding: 6pt 8pt;
    font-size: 8pt;
    font-weight: 700;
    color: #475569;
    border-bottom: 2pt solid #cbd5e1;
    text-align: right;
  }
  .tbl-center { text-align: center !important; }
  .tbl-td {
    padding: 7pt 8pt;
    border-bottom: 1pt solid #f1f5f9;
    color: #334155;
    vertical-align: middle;
  }
  .row-w { background: #fff; }
  .row-g { background: #f8fafc; }
  .badge {
    display: inline-block;
    padding: 1pt 8pt;
    border-radius: 10pt;
    font-size: 8pt;
    font-weight: 700;
    border: 1pt solid;
  }
  .bar-track { height: 6pt; background: #e2e8f0; border-radius: 3pt; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3pt; }

  /* ═══════ DUAL PROGRESS ═══════ */
  .dual-progress {
    border: 1pt solid #e2e8f0;
    border-radius: 8pt;
    padding: 12pt 16pt;
    margin-bottom: 14pt;
    background: #fafbfc;
  }
  .dp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10pt;
  }
  .dp-title { font-size: 11pt; font-weight: 700; color: #334155; }
  .dp-dev {
    font-size: 9pt;
    font-weight: 700;
    padding: 2pt 10pt;
    border-radius: 12pt;
  }
  .dp-dev-ok { background: #f0fdf4; color: #16a34a; border: 1pt solid #86efac; }
  .dp-dev-warn { background: #fef2f2; color: #dc2626; border: 1pt solid #fca5a5; }
  .dp-bars { display: flex; flex-direction: column; gap: 6pt; }
  .dp-row { display: flex; align-items: center; gap: 8pt; }
  .dp-lbl { font-size: 8pt; font-weight: 600; color: #64748b; width: 35pt; }
  .dp-track { flex: 1; height: 12pt; background: #e2e8f0; border-radius: 6pt; overflow: hidden; }
  .dp-fill { height: 100%; border-radius: 6pt; }
  .dp-fill-actual { background: linear-gradient(90deg, #2563eb, #60a5fa); }
  .dp-fill-planned { background: linear-gradient(90deg, #94a3b8, #cbd5e1); }
  .dp-val { font-size: 11pt; font-weight: 800; color: #475569; width: 35pt; text-align: left; }
  .dp-val-actual { color: #2563eb; }

  /* ═══════ STATS GRID ═══════ */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8pt;
    margin-bottom: 14pt;
  }
  .stat-card {
    display: flex;
    align-items: center;
    gap: 8pt;
    padding: 10pt;
    border: 1pt solid #e2e8f0;
    border-radius: 8pt;
    background: #fff;
  }
  .stat-icon {
    width: 32pt;
    height: 32pt;
    border-radius: 8pt;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14pt;
    flex-shrink: 0;
  }
  .stat-body { flex: 1; min-width: 0; }
  .stat-lbl { font-size: 7pt; color: #64748b; font-weight: 600; }
  .stat-val { font-size: 11pt; font-weight: 800; color: #1e293b; }
  .stat-unit { font-size: 8pt; font-weight: 600; color: #94a3b8; }

  /* ═══════ TIMELINE ═══════ */
  .timeline-box {
    border: 1pt solid #e2e8f0;
    border-radius: 8pt;
    padding: 12pt 16pt;
    margin-bottom: 14pt;
    background: #fafbfc;
  }
  .tl-header { font-size: 10pt; font-weight: 700; color: #334155; margin-bottom: 8pt; }
  .tl-dates { display: flex; justify-content: space-between; font-size: 9pt; color: #475569; margin-bottom: 6pt; }
  .tl-track { height: 10pt; background: #e2e8f0; border-radius: 5pt; position: relative; overflow: visible; margin-bottom: 6pt; }
  .tl-elapsed { height: 100%; background: linear-gradient(90deg, #1e40af, #3b82f6); border-radius: 5pt 0 0 5pt; }
  .tl-marker { position: absolute; top: -3pt; transform: translateX(50%); }
  .tl-dot { width: 8pt; height: 16pt; background: #1e40af; border: 2pt solid #fff; border-radius: 4pt; box-shadow: 0 1pt 3pt rgba(0,0,0,0.3); }
  .tl-legend { display: flex; gap: 16pt; font-size: 7.5pt; color: #64748b; }

  /* ═══════ ACTIVITY SUMMARY ═══════ */
  .act-summary {
    border: 1pt solid #e2e8f0;
    border-radius: 8pt;
    padding: 12pt 16pt;
    margin-bottom: 14pt;
    background: #fafbfc;
  }
  .acts-header { font-size: 10pt; font-weight: 700; color: #334155; margin-bottom: 10pt; }
  .acts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8pt; margin-bottom: 10pt; }
  .acts-item { text-align: center; }
  .acts-count { font-size: 18pt; font-weight: 800; line-height: 1.2; }
  .acts-dot { width: 8pt; height: 8pt; border-radius: 50%; margin: 3pt auto; }
  .acts-lbl { font-size: 7.5pt; color: #64748b; font-weight: 600; }
  .acts-bar-row { display: flex; height: 8pt; border-radius: 4pt; overflow: hidden; gap: 1pt; }
  .acts-bar-seg { border-radius: 2pt; }

  /* ═══════ IMAGES ═══════ */
  .images-section {
    break-before: page;
    page-break-before: always;
  }
  .images-title {
    font-size: 12pt;
    font-weight: 700;
    color: #1e40af;
    margin-bottom: 12pt;
    padding-bottom: 8pt;
    border-bottom: 2pt solid #bfdbfe;
    display: flex;
    align-items: center;
    gap: 6pt;
  }
  .img-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12pt;
  }
  .img-card {
    border: 1pt solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    background: #f8fafc;
  }
  .img-photo {
    width: 100%;
    height: 140pt;
    object-fit: cover;
    display: block;
  }
  .img-label {
    font-size: 8pt;
    color: #64748b;
    text-align: center;
    padding: 4pt;
    background: #f1f5f9;
  }

  /* ═══════ FOOTER ═══════ */
  .report-footer {
    margin-top: 18pt;
    padding-top: 8pt;
    border-top: 1pt solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #94a3b8;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* ═══════ PRINT BUTTON ═══════ */
  .print-toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(135deg, #1e293b, #334155);
    padding: 10pt 20pt;
    display: flex;
    justify-content: center;
    gap: 12pt;
    z-index: 9999;
    box-shadow: 0 4pt 12pt rgba(0,0,0,0.3);
  }
  .btn-print {
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 6pt;
    padding: 8pt 28pt;
    font-size: 11pt;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
  }
  .btn-print:hover { background: #1d4ed8; }
  .btn-close {
    background: #64748b;
    color: #fff;
    border: none;
    border-radius: 6pt;
    padding: 8pt 20pt;
    font-size: 11pt;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }
  .btn-close:hover { background: #475569; }

  @media print {
    .print-toolbar { display: none !important; }
    body { padding-top: 0 !important; }
  }
  @media screen {
    body { padding-top: 50pt; max-width: 210mm; margin: 0 auto; }
  }
</style>
</head>
<body>

<!-- PRINT TOOLBAR (screen only) -->
<div class="print-toolbar">
  <button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <button class="btn-close" onclick="window.close()">✕ إغلاق</button>
</div>

<!-- HEADER -->
<div class="report-header">
  <div class="hdr-row">
    <div class="hdr-info">
      <div class="hdr-sys">نظام الإشراف الهندسي</div>
      <div class="hdr-title">${esc(data.projectName)}</div>
      <div class="hdr-meta">
        ${metaItems.map(([l, v]) => `<span class="hdr-pill">${l}: ${esc(v)}</span>`).join("")}
      </div>
    </div>
    <div class="hdr-badge">
      <div class="hdr-badge-label">نوع التقرير</div>
      <div class="hdr-badge-value">${typeLbl}</div>
    </div>
  </div>
</div>

<!-- INFO STRIP -->
<div class="info-strip">
  ${infoItems.map(([l, v]) => `
    <div class="info-cell">
      <div class="info-lbl">${l}</div>
      <div class="info-val">${v}</div>
    </div>`).join("")}
</div>

<!-- PROGRESS COMPARISON -->
<div class="dual-progress avoid-break">
  <div class="dp-header">
    <span class="dp-title">مقارنة الإنجاز</span>
    ${deviation != null ? `<span class="dp-dev ${deviation >= 0 ? "dp-dev-ok" : "dp-dev-warn"}">${deviation >= 0 ? "+" : ""}${deviation}% ${deviation >= 0 ? "متقدم" : "متأخر"}</span>` : ""}
  </div>
  <div class="dp-bars">
    <div class="dp-row">
      <span class="dp-lbl">الفعلي</span>
      <div class="dp-track"><div class="dp-fill dp-fill-actual" style="width:${pct}%"></div></div>
      <span class="dp-val dp-val-actual">${pct}%</span>
    </div>
    ${plannedPct != null ? `<div class="dp-row">
      <span class="dp-lbl">المخطط</span>
      <div class="dp-track"><div class="dp-fill dp-fill-planned" style="width:${plannedPct}%"></div></div>
      <span class="dp-val">${plannedPct}%</span>
    </div>` : ""}
  </div>
</div>

<!-- QUICK STATS -->
<div class="stats-grid avoid-break">
  ${data.contractValue ? `<div class="stat-card">
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">💰</div>
    <div class="stat-body">
      <div class="stat-lbl">قيمة العقد</div>
      <div class="stat-val">${fmtMoney(data.contractValue)} <span class="stat-unit">د.ل</span></div>
    </div>
  </div>` : ""}
  ${totalDuration != null ? `<div class="stat-card">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">📅</div>
    <div class="stat-body">
      <div class="stat-lbl">مدة المشروع</div>
      <div class="stat-val">${totalDuration} <span class="stat-unit">يوم</span></div>
    </div>
  </div>` : ""}
  ${elapsed != null ? `<div class="stat-card">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">⏱️</div>
    <div class="stat-body">
      <div class="stat-lbl">المنقضي</div>
      <div class="stat-val">${elapsed} <span class="stat-unit">يوم${elapsedPct != null ? ` (${elapsedPct}%)` : ""}</span></div>
    </div>
  </div>` : ""}
  ${remaining != null ? `<div class="stat-card">
    <div class="stat-icon" style="background:${remaining < 180 ? "#fef2f2" : "#f0f9ff"};color:${remaining < 180 ? "#dc2626" : "#0284c7"}">⏳</div>
    <div class="stat-body">
      <div class="stat-lbl">المتبقي</div>
      <div class="stat-val">${remaining} <span class="stat-unit">يوم</span></div>
    </div>
  </div>` : ""}
</div>

<!-- TIMELINE -->
${data.startDate && data.expectedEndDate ? `<div class="timeline-box avoid-break">
  <div class="tl-header">الجدول الزمني</div>
  <div class="tl-dates">
    <span>بداية: <strong>${fmtDate(data.startDate)}</strong></span>
    <span>نهاية: <strong>${fmtDate(data.expectedEndDate)}</strong></span>
  </div>
  <div class="tl-track">
    <div class="tl-elapsed" style="width:${elapsedPct ?? 0}%"></div>
    <div class="tl-marker" style="right:${elapsedPct ?? 0}%"><div class="tl-dot"></div></div>
  </div>
  <div class="tl-legend">
    <span>🟦 الزمن المنقضي (${elapsedPct ?? 0}%)</span>
    <span>⬜ الزمن المتبقي (${100 - (elapsedPct ?? 0)}%)</span>
  </div>
</div>` : ""}

<!-- ACTIVITY SUMMARY -->
${acts.length > 0 ? `<div class="act-summary avoid-break">
  <div class="acts-header">ملخص حالة الأنشطة (${acts.length} نشاط)</div>
  <div class="acts-grid">
    <div class="acts-item">
      <div class="acts-count" style="color:#16a34a">${completedCount}</div>
      <div class="acts-dot" style="background:#16a34a"></div>
      <div class="acts-lbl">مكتمل</div>
    </div>
    <div class="acts-item">
      <div class="acts-count" style="color:#2563eb">${inProgressCount}</div>
      <div class="acts-dot" style="background:#2563eb"></div>
      <div class="acts-lbl">قيد التنفيذ</div>
    </div>
    <div class="acts-item">
      <div class="acts-count" style="color:#dc2626">${delayedCount}</div>
      <div class="acts-dot" style="background:#dc2626"></div>
      <div class="acts-lbl">متأخر</div>
    </div>
    <div class="acts-item">
      <div class="acts-count" style="color:#6b7280">${notStartedCount}</div>
      <div class="acts-dot" style="background:#6b7280"></div>
      <div class="acts-lbl">لم يبدأ</div>
    </div>
  </div>
  <div class="acts-bar-row">
    ${completedCount > 0 ? `<div class="acts-bar-seg" style="flex:${completedCount};background:#16a34a" title="مكتمل: ${completedCount}"></div>` : ""}
    ${inProgressCount > 0 ? `<div class="acts-bar-seg" style="flex:${inProgressCount};background:#2563eb" title="قيد التنفيذ: ${inProgressCount}"></div>` : ""}
    ${delayedCount > 0 ? `<div class="acts-bar-seg" style="flex:${delayedCount};background:#dc2626" title="متأخر: ${delayedCount}"></div>` : ""}
    ${notStartedCount > 0 ? `<div class="acts-bar-seg" style="flex:${notStartedCount};background:#d1d5db" title="لم يبدأ: ${notStartedCount}"></div>` : ""}
  </div>
</div>` : ""}

<!-- ACTIVITIES TABLE -->
${activitiesHTML}

<!-- WORK DESCRIPTION -->
<div class="card avoid-break">
  <div class="card-hd">
    <span class="card-icon">📝</span> وصف الأعمال المنجزة خلال الفترة
  </div>
  <p class="card-text">${esc(data.workDescription)}</p>
</div>

<!-- NOTES -->
${notesHTML}

<!-- RECOMMENDATIONS -->
${recsHTML}

<!-- IMAGES -->
${imagesHTML}

<!-- FOOTER -->
<div class="report-footer">
  <span>تم إنشاؤه آلياً بواسطة نظام الإشراف الهندسي — ${fmtDate(new Date().toISOString())}</span>
  <span style="font-weight:700;color:#64748b">تقرير ${typeLbl} #${data.reportId}</span>
</div>

</body>
</html>`;
}

export function previewReport(data: ReportPdfData): void {
  const html = buildPrintHTML(data);
  const win = window.open("", "_blank", "width=900,height=780,scrollbars=yes");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

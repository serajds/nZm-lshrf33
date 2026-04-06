import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusLabel(s: string): string {
  return ({ completed: "مكتمل", in_progress: "جارٍ", delayed: "متأخر", not_started: "لم يبدأ" } as Record<string, string>)[s] ?? s;
}

function statusColor(s: string): string {
  return ({ completed: "#16a34a", in_progress: "#2563eb", delayed: "#dc2626", not_started: "#9ca3af" } as Record<string, string>)[s] ?? "#9ca3af";
}

function statusBg(s: string): string {
  return ({ completed: "#f0fdf4", in_progress: "#eff6ff", delayed: "#fef2f2", not_started: "#f9fafb" } as Record<string, string>)[s] ?? "#f9fafb";
}

function buildReportHTML(data: ReportPdfData, forPrint = false): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));

  const metaPills = [
    data.ownerEntity ? `<span class="meta-pill">${escapeHtml(data.ownerEntity)}</span>` : "",
    data.contractor ? `<span class="meta-pill">${escapeHtml(data.contractor)}</span>` : "",
    data.supervisorEntity ? `<span class="meta-pill">${escapeHtml(data.supervisorEntity)}</span>` : "",
    data.location ? `<span class="meta-pill">${escapeHtml(data.location)}</span>` : "",
  ].filter(Boolean).join("");

  // ── Activities table ──
  const activitiesSection = data.activities && data.activities.length > 0
    ? `<div class="section-box activities-box">
        <div class="section-title activities-title">حالة الأنشطة</div>
        <table class="acts-table">
          <thead>
            <tr>
              <th class="act-th act-name-col">النشاط</th>
              <th class="act-th act-num-col">مخطط</th>
              <th class="act-th act-num-col">فعلي</th>
              <th class="act-th act-status-col">الحالة</th>
              <th class="act-th act-bar-col">شريط الإنجاز</th>
            </tr>
          </thead>
          <tbody>
            ${data.activities.map((a, i) => `
              <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
                <td class="act-td act-name-col">${escapeHtml(a.name)}</td>
                <td class="act-td act-num-col">${a.plannedProgress}%</td>
                <td class="act-td act-num-col" style="font-weight:700">${a.actualProgress}%</td>
                <td class="act-td act-status-col">
                  <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:${statusBg(a.status)};color:${statusColor(a.status)};border:1px solid ${statusColor(a.status)}33">
                    ${statusLabel(a.status)}
                  </span>
                </td>
                <td class="act-td act-bar-col">
                  <div style="position:relative;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden">
                    <div style="position:absolute;top:0;right:0;height:100%;width:${a.plannedProgress}%;background:#d1d5db;border-radius:5px"></div>
                    <div style="position:absolute;top:0;right:0;height:100%;width:${a.actualProgress}%;background:${statusColor(a.status)};border-radius:5px"></div>
                  </div>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  // ── Notes & Recommendations ──
  const notesSection = data.technicalNotes
    ? `<div class="section-box warning">
        <div class="section-title warning-title">الملاحظات الفنية</div>
        <div class="section-text">${escapeHtml(data.technicalNotes)}</div>
      </div>`
    : "";

  const recsSection = data.recommendations
    ? `<div class="section-box success">
        <div class="section-title success-title">التوصيات</div>
        <div class="section-text">${escapeHtml(data.recommendations)}</div>
      </div>`
    : "";

  // ── Images: full-page per image ──
  const images = data.imageUrls ?? [];
  const imagesPages = images.length > 0
    ? images.map((url, i) => `
        <div class="image-page">
          <div class="image-page-header">
            <span class="image-page-title">صور الموقع</span>
            <span class="image-page-counter">${i + 1} / ${images.length}</span>
          </div>
          <div class="image-page-body">
            <img src="${url}" class="full-page-img" onerror="this.style.display='none'" />
          </div>
          <div class="image-page-footer">
            ${escapeHtml(data.projectName)} — تقرير ${typeLbl} — ${fmtDate(data.reportDate)}
          </div>
        </div>`).join("")
    : "";

  const printExtra = forPrint
    ? `@media print {
        @page { size: A4; margin: 0; }
        .no-print { display: none !important; }
        .image-page { page-break-before: always; break-before: always; }
        .main-page { page-break-after: ${images.length > 0 ? "always" : "auto"}; break-after: ${images.length > 0 ? "always" : "auto"}; }
        .section-box {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .acts-table { break-inside: avoid; page-break-inside: avoid; }
        .acts-table tr { break-inside: avoid; page-break-inside: avoid; }
        .info-bar { break-inside: avoid; page-break-inside: avoid; }
        .progress-section { break-inside: avoid; page-break-inside: avoid; }
        .header { break-inside: avoid; page-break-inside: avoid; }
        .footer { break-inside: avoid; page-break-inside: avoid; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }`
    : "";

  return `<!DOCTYPE html>
<html lang="ar">
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Kufi Arabic', Arial, sans-serif;
    background: #ffffff;
    color: #1a1a2e;
    direction: rtl;
    text-align: right;
    width: 794px;
    font-size: 13px;
    line-height: 1.7;
  }

  /* ── Header ── */
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
    color: #fff;
    padding: 32px 40px 28px;
  }
  .header-inner { display: table; width: 100%; table-layout: fixed; }
  .header-main { display: table-cell; vertical-align: top; text-align: right; }
  .header-badge-cell { display: table-cell; vertical-align: middle; width: 130px; text-align: center; padding-right: 20px; }
  .system-name { font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 6px; font-weight: 500; }
  .project-name { font-size: 22px; font-weight: 800; line-height: 1.3; color: #fff; margin-bottom: 12px; }
  .meta-pills { margin-top: 4px; }
  .meta-pill {
    display: inline-block;
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 3px 12px;
    font-size: 11px;
    color: rgba(255,255,255,0.85);
    margin-left: 6px;
    margin-bottom: 4px;
  }
  .report-badge {
    background: rgba(255,255,255,0.15);
    border: 2px solid rgba(255,255,255,0.3);
    border-radius: 12px;
    padding: 12px 16px;
    text-align: center;
  }
  .report-type-label { font-size: 10px; color: rgba(255,255,255,0.7); margin-bottom: 4px; }
  .report-type-value { font-size: 18px; font-weight: 800; color: #fff; }

  /* ── Info Bar ── */
  .info-bar { background: #f0f4ff; border-bottom: 3px solid #1a1a2e; }
  .info-bar table { width: 100%; border-collapse: collapse; }
  .info-bar td { width: 25%; padding: 16px 10px; text-align: center; border-left: 1px solid #d0d9f0; }
  .info-bar td:last-child { border-left: none; }
  .info-label { font-size: 10px; color: #6b7280; font-weight: 600; margin-bottom: 4px; }
  .info-value { font-size: 15px; font-weight: 700; color: #1a1a2e; }

  /* ── Progress ── */
  .progress-section { padding: 20px 40px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .progress-header { display: table; width: 100%; margin-bottom: 10px; }
  .progress-label { display: table-cell; font-size: 12px; font-weight: 600; color: #374151; text-align: right; }
  .progress-pct { display: table-cell; font-size: 20px; font-weight: 800; color: #1a1a2e; text-align: left; width: 60px; }
  .progress-track { height: 14px; background: #e5e7eb; border-radius: 7px; overflow: hidden; }
  .progress-fill-wrap { height: 100%; display: flex; justify-content: flex-start; }
  .progress-fill { height: 100%; border-radius: 7px; background: linear-gradient(90deg, #1d4ed8, #3b82f6); width: ${pct}%; }
  .progress-milestones { width: 100%; margin-top: 4px; }
  .progress-milestones td { font-size: 9px; color: #9ca3af; text-align: center; width: 25%; }
  .progress-milestones td:first-child { text-align: right; }
  .progress-milestones td:last-child { text-align: left; }

  /* ── Body ── */
  .body { padding: 24px 40px 40px; }

  .section-box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 22px; margin-bottom: 16px; background: #fafafa; break-inside: avoid; page-break-inside: avoid; }
  .section-box.warning { background: #fff7ed; border-color: #fed7aa; }
  .section-box.success { background: #f0fdf4; border-color: #bbf7d0; }
  .activities-box { background: #f8faff; border-color: #c7d7f0; }
  .section-title { font-size: 12px; font-weight: 700; color: #374151; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
  .warning-title { color: #c2410c; border-bottom-color: #fed7aa; }
  .success-title { color: #16a34a; border-bottom-color: #bbf7d0; }
  .activities-title { color: #1e40af; border-bottom-color: #bfdbfe; }
  .section-text { font-size: 13px; color: #4b5563; line-height: 1.9; white-space: pre-wrap; }

  /* ── Activities Table ── */
  .acts-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .act-th { padding: 8px 10px; text-align: right; font-size: 10px; font-weight: 700; color: #6b7280; background: #eff6ff; border-bottom: 2px solid #bfdbfe; }
  .act-td { padding: 9px 10px; text-align: right; border-bottom: 1px solid #f0f0f0; color: #374151; }
  .act-name-col { width: 35%; }
  .act-num-col { width: 10%; text-align: center; }
  .act-status-col { width: 15%; text-align: center; }
  .act-bar-col { width: 30%; padding-left: 6px; }

  /* ── Footer ── */
  .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 14px 40px; display: table; width: 100%; }
  .footer-text { display: table-cell; font-size: 10px; color: #9ca3af; text-align: right; }
  .footer-logo { display: table-cell; font-size: 11px; font-weight: 700; color: #1a1a2e; opacity: 0.5; text-align: left; width: 180px; }

  /* ── Image Pages ── */
  .image-page {
    width: 794px;
    height: 1122px;
    display: flex;
    flex-direction: column;
    background: #111827;
    padding: 0;
  }
  .image-page-header {
    background: #1a1a2e;
    padding: 16px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .image-page-title { color: #fff; font-size: 16px; font-weight: 700; }
  .image-page-counter { color: rgba(255,255,255,0.6); font-size: 13px; }
  .image-page-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: #0f172a;
  }
  .full-page-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .image-page-footer {
    background: #1a1a2e;
    padding: 14px 40px;
    color: rgba(255,255,255,0.5);
    font-size: 11px;
    text-align: center;
  }

  ${printExtra}
</style>
${forPrint ? `<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 1200);
  });
<\/script>` : ""}
</head>
<body>
<div class="main-page">
  <!-- HEADER -->
  <div class="header">
    <div class="header-inner">
      <div class="header-main">
        <div class="system-name">نظام الإشراف الهندسي &mdash; تقرير ${typeLbl}</div>
        <div class="project-name">${escapeHtml(data.projectName)}</div>
        <div class="meta-pills">${metaPills}</div>
      </div>
      <div class="header-badge-cell">
        <div class="report-badge">
          <div class="report-type-label">نوع التقرير</div>
          <div class="report-type-value">${typeLbl}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- INFO BAR -->
  <div class="info-bar">
    <table>
      <tr>
        <td>
          <div class="info-label">تاريخ التقرير</div>
          <div class="info-value">${fmtDate(data.reportDate)}</div>
        </td>
        <td>
          <div class="info-label">بداية الفترة</div>
          <div class="info-value">${fmtDate(data.periodStart)}</div>
        </td>
        <td>
          <div class="info-label">نهاية الفترة</div>
          <div class="info-value">${fmtDate(data.periodEnd)}</div>
        </td>
        <td>
          <div class="info-label">رقم التقرير</div>
          <div class="info-value">#${data.reportId}</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- PROGRESS -->
  <div class="progress-section">
    <div class="progress-header">
      <div class="progress-label">نسبة الإنجاز التراكمية</div>
      <div class="progress-pct">${pct}%</div>
    </div>
    <div class="progress-track">
      <div class="progress-fill-wrap">
        <div class="progress-fill"></div>
      </div>
    </div>
    <table class="progress-milestones">
      <tr>
        <td>100%</td><td>75%</td><td>50%</td><td>25%</td><td>0%</td>
      </tr>
    </table>
  </div>

  <!-- BODY -->
  <div class="body">
    ${activitiesSection}
    <div class="section-box">
      <div class="section-title">وصف الأعمال المنجزة خلال الفترة</div>
      <div class="section-text">${escapeHtml(data.workDescription)}</div>
    </div>
    ${notesSection}
    ${recsSection}
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-text">تم إنشاء هذا التقرير آلياً &mdash; ${fmtDate(new Date().toISOString())}</div>
    <div class="footer-logo">نظام الإشراف الهندسي</div>
  </div>
</div>

${imagesPages}

</body>
</html>`;
}

/** Build a clean, print-friendly HTML — fully separate from the html2canvas PDF path */
function buildPrintHTML(data: ReportPdfData): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));

  const metaRows = [
    ["جهة المالك", data.ownerEntity],
    ["المقاول", data.contractor],
    ["جهة الإشراف", data.supervisorEntity],
    ["الموقع", data.location],
  ].filter(([, v]) => !!v);

  const infoRows = [
    ["تاريخ التقرير", fmtDate(data.reportDate)],
    ["بداية الفترة", fmtDate(data.periodStart)],
    ["نهاية الفترة", fmtDate(data.periodEnd)],
    ["رقم التقرير", `#${data.reportId}`],
  ];

  const metaTable = metaRows.length ? `
    <table class="meta-tbl">
      <tbody>
        ${metaRows.map(([l, v]) => `<tr><td class="meta-lbl">${l}</td><td class="meta-val">${escapeHtml(v ?? "")}</td></tr>`).join("")}
      </tbody>
    </table>` : "";

  const activitiesSection = data.activities && data.activities.length > 0 ? `
    <div class="section avoid-break">
      <div class="section-hd blue-hd">حالة الأنشطة</div>
      <table class="acts-tbl">
        <thead>
          <tr>
            <th class="th">النشاط</th>
            <th class="th th-sm">مخطط %</th>
            <th class="th th-sm">فعلي %</th>
            <th class="th th-sm">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${data.activities.map((a, i) => `
            <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
              <td class="td">${escapeHtml(a.name)}</td>
              <td class="td td-c">${a.plannedProgress}%</td>
              <td class="td td-c td-bold">${a.actualProgress}%</td>
              <td class="td td-c">
                <span class="badge" style="background:${statusBg(a.status)};color:${statusColor(a.status)};border:1px solid ${statusColor(a.status)}55">
                  ${statusLabel(a.status)}
                </span>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : "";

  const notesSection = data.technicalNotes ? `
    <div class="section avoid-break warn-box">
      <div class="section-hd warn-hd">الملاحظات الفنية</div>
      <p class="sec-text">${escapeHtml(data.technicalNotes)}</p>
    </div>` : "";

  const recsSection = data.recommendations ? `
    <div class="section avoid-break success-box">
      <div class="section-hd success-hd">التوصيات</div>
      <p class="sec-text">${escapeHtml(data.recommendations)}</p>
    </div>` : "";

  const images = data.imageUrls ?? [];
  const imagesSection = images.length > 0 ? `
    <div class="page-break-before">
      <div class="section-hd blue-hd img-hd">صور الموقع (${images.length} صورة)</div>
      <div class="img-grid">
        ${images.map((url, i) => `
          <div class="img-wrap avoid-break">
            <img src="${url}" class="site-img" onerror="this.parentNode.style.display='none'" />
            <div class="img-caption">صورة ${i + 1} من ${images.length}</div>
          </div>`).join("")}
      </div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width"/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<title>تقرير ${typeLbl} — ${escapeHtml(data.projectName)}</title>
<style>
  @page {
    size: A4;
    margin: 18mm 20mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Kufi Arabic', Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.75;
    color: #1a1a2e;
    direction: rtl;
    text-align: right;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Report header ── */
  .rpt-header {
    background: #1a1a2e;
    color: #fff;
    padding: 18pt 20pt 14pt;
    margin-bottom: 0;
    border-radius: 6pt 6pt 0 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .rpt-sys { font-size: 9pt; color: rgba(255,255,255,0.55); margin-bottom: 4pt; }
  .rpt-title { font-size: 18pt; font-weight: 800; color: #fff; margin-bottom: 6pt; }
  .rpt-badge {
    display: inline-block;
    background: rgba(255,255,255,0.15);
    border: 1.5px solid rgba(255,255,255,0.3);
    border-radius: 20pt;
    padding: 2pt 14pt;
    font-size: 10pt;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
  }

  /* ── Info bar ── */
  .info-bar {
    background: #eef2ff;
    border-top: 2px solid #c7d2fe;
    border-bottom: 2px solid #1a1a2e;
    padding: 10pt 20pt;
    margin-bottom: 16pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .info-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 0; }
  .info-cell { text-align: center; border-right: 1px solid #c7d2fe; padding: 0 8pt; }
  .info-cell:last-child { border-right: none; }
  .info-lbl { font-size: 8pt; color: #6b7280; font-weight: 600; margin-bottom: 2pt; }
  .info-val { font-size: 13pt; font-weight: 800; color: #1a1a2e; }

  /* ── Meta table ── */
  .meta-tbl { width: 100%; border-collapse: collapse; margin-bottom: 14pt; font-size: 11pt; break-inside: avoid; page-break-inside: avoid; }
  .meta-lbl { font-weight: 700; color: #374151; width: 140pt; padding: 4pt 0; border-bottom: 1px solid #f0f0f0; }
  .meta-val { color: #4b5563; padding: 4pt 0; border-bottom: 1px solid #f0f0f0; }

  /* ── Progress ── */
  .progress-wrap {
    margin-bottom: 16pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .progress-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6pt; }
  .progress-lbl { font-size: 11pt; font-weight: 700; color: #374151; }
  .progress-pct { font-size: 20pt; font-weight: 800; color: #1d4ed8; }
  .track { height: 13pt; background: #e5e7eb; border-radius: 7pt; overflow: hidden; }
  .fill { height: 100%; width: ${pct}%; background: linear-gradient(90deg, #1d4ed8, #60a5fa); border-radius: 7pt; }

  /* ── Sections ── */
  .section {
    border: 1px solid #e5e7eb;
    border-radius: 6pt;
    padding: 12pt 16pt;
    margin-bottom: 14pt;
    background: #fafafa;
  }
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .section-hd {
    font-size: 11pt;
    font-weight: 700;
    margin-bottom: 8pt;
    padding-bottom: 6pt;
    border-bottom: 1.5px solid #e5e7eb;
    color: #374151;
  }
  .blue-hd { color: #1e40af; border-bottom-color: #bfdbfe; }
  .warn-hd { color: #c2410c; border-bottom-color: #fed7aa; }
  .success-hd { color: #15803d; border-bottom-color: #bbf7d0; }
  .warn-box { background: #fff7ed; border-color: #fed7aa; }
  .success-box { background: #f0fdf4; border-color: #bbf7d0; }
  .sec-text { font-size: 11.5pt; color: #374151; line-height: 1.9; white-space: pre-wrap; }

  /* ── Activities table ── */
  .acts-tbl { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  .th { background: #eff6ff; padding: 6pt 8pt; text-align: center; font-size: 9pt; font-weight: 700; color: #1e40af; border-bottom: 2px solid #bfdbfe; }
  .th:first-child { text-align: right; }
  .td { padding: 7pt 8pt; border-bottom: 1px solid #f0f0f0; color: #374151; }
  .th-sm { width: 70pt; }
  .td-c { text-align: center; }
  .td-bold { font-weight: 700; }
  .row-even { background: #fff; }
  .row-odd { background: #f9fafb; }
  .badge { display: inline-block; padding: 2pt 7pt; border-radius: 12pt; font-size: 9pt; font-weight: 700; }

  /* ── Images ── */
  .page-break-before { break-before: page; page-break-before: always; }
  .img-hd { margin-bottom: 14pt; }
  .img-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14pt; }
  .img-wrap { border: 1px solid #e5e7eb; border-radius: 6pt; overflow: hidden; background: #f9fafb; }
  .site-img { width: 100%; height: 160pt; object-fit: cover; display: block; }
  .img-caption { font-size: 9pt; color: #6b7280; text-align: center; padding: 5pt; }

  /* ── Footer ── */
  .rpt-footer {
    margin-top: 20pt;
    border-top: 1px solid #e5e7eb;
    padding-top: 8pt;
    font-size: 9pt;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @media print {
    body { font-size: 11pt; }
    .page-break-before { break-before: page; page-break-before: always; }
    .avoid-break { break-inside: avoid !important; page-break-inside: avoid !important; }
    .rpt-header { border-radius: 0; }
  }
</style>
<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.print(); }, 1400);
  });
<\/script>
</head>
<body>

<!-- HEADER -->
<div class="rpt-header avoid-break">
  <div class="rpt-sys">نظام الإشراف الهندسي</div>
  <div class="rpt-title">${escapeHtml(data.projectName)}</div>
  <span class="rpt-badge">تقرير ${typeLbl}</span>
</div>

<!-- INFO BAR -->
<div class="info-bar">
  <div class="info-grid">
    ${infoRows.map(([l, v]) => `
    <div class="info-cell">
      <div class="info-lbl">${l}</div>
      <div class="info-val">${v}</div>
    </div>`).join("")}
  </div>
</div>

<!-- META -->
${metaTable}

<!-- PROGRESS -->
<div class="progress-wrap">
  <div class="progress-row">
    <span class="progress-lbl">نسبة الإنجاز التراكمية</span>
    <span class="progress-pct">${pct}%</span>
  </div>
  <div class="track"><div class="fill"></div></div>
</div>

<!-- ACTIVITIES -->
${activitiesSection}

<!-- WORK DESCRIPTION -->
<div class="section avoid-break">
  <div class="section-hd">وصف الأعمال المنجزة خلال الفترة</div>
  <p class="sec-text">${escapeHtml(data.workDescription)}</p>
</div>

<!-- NOTES -->
${notesSection}

<!-- RECOMMENDATIONS -->
${recsSection}

<!-- IMAGES -->
${imagesSection}

<!-- FOOTER -->
<div class="rpt-footer">
  <span>تم إنشاؤه آلياً — ${fmtDate(new Date().toISOString())}</span>
  <span>نظام الإشراف الهندسي</span>
</div>

</body>
</html>`;
}

/** Open a browser print-preview window */
export function previewReport(data: ReportPdfData): void {
  const html = buildPrintHTML(data);
  const win = window.open("", "_blank", "width=860,height=760");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** Build PDF HTML with each section as a separate .block element for individual rendering */
function buildPdfBlocksHTML(data: ReportPdfData): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));

  const metaRows = [
    ["جهة المالك", data.ownerEntity],
    ["المقاول", data.contractor],
    ["جهة الإشراف", data.supervisorEntity],
    ["الموقع", data.location],
  ].filter(([, v]) => !!v);

  const infoItems = [
    ["تاريخ التقرير", fmtDate(data.reportDate)],
    ["بداية الفترة", fmtDate(data.periodStart)],
    ["نهاية الفترة", fmtDate(data.periodEnd)],
    ["رقم التقرير", `#${data.reportId}`],
  ];

  const blocks: string[] = [];

  blocks.push(`<div class="block hdr">
    <div class="hdr-sys">نظام الإشراف الهندسي</div>
    <div class="hdr-title">${escapeHtml(data.projectName)}</div>
    <span class="hdr-badge">تقرير ${typeLbl}</span>
  </div>`);

  blocks.push(`<div class="block ibar">
    ${infoItems.map(([l, v]) => `<div class="ic"><div class="il">${l}</div><div class="iv">${v}</div></div>`).join("")}
  </div>`);

  if (metaRows.length) {
    blocks.push(`<div class="block meta-wrap">
      <table class="meta-tbl">
        <tbody>
          ${metaRows.map(([l, v]) => `<tr><td class="ml">${l}</td><td class="mv">${escapeHtml(v ?? "")}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>`);
  }

  blocks.push(`<div class="block pw">
    <div class="pr"><span class="pl">نسبة الإنجاز التراكمية</span><span class="pp">${pct}%</span></div>
    <div class="track"><div class="fill"></div></div>
  </div>`);

  if (data.activities && data.activities.length > 0) {
    blocks.push(`<div class="block section acts-sec">
      <div class="sh blue-sh">حالة الأنشطة</div>
      <table class="at">
        <thead><tr>
          <th class="th">النشاط</th><th class="th thc">مخطط %</th>
          <th class="th thc">فعلي %</th><th class="th thc">الحالة</th>
        </tr></thead>
        <tbody>
          ${data.activities.map((a, i) => `
            <tr style="background:${i % 2 === 0 ? "#fff" : "#f9fafb"}">
              <td class="td">${escapeHtml(a.name)}</td>
              <td class="td tdc">${a.plannedProgress}%</td>
              <td class="td tdc" style="font-weight:700">${a.actualProgress}%</td>
              <td class="td tdc">
                <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${statusBg(a.status)};color:${statusColor(a.status)};border:1px solid ${statusColor(a.status)}44">
                  ${statusLabel(a.status)}
                </span>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`);
  }

  blocks.push(`<div class="block section">
    <div class="sh">وصف الأعمال المنجزة خلال الفترة</div>
    <p class="st">${escapeHtml(data.workDescription)}</p>
  </div>`);

  if (data.technicalNotes) {
    blocks.push(`<div class="block section warn-box">
      <div class="sh warn-sh">الملاحظات الفنية</div>
      <p class="st">${escapeHtml(data.technicalNotes)}</p>
    </div>`);
  }

  if (data.recommendations) {
    blocks.push(`<div class="block section succ-box">
      <div class="sh succ-sh">التوصيات</div>
      <p class="st">${escapeHtml(data.recommendations)}</p>
    </div>`);
  }

  blocks.push(`<div class="block ftr">
    <span>تم إنشاؤه آلياً — ${fmtDate(new Date().toISOString())}</span>
    <span>نظام الإشراف الهندسي</span>
  </div>`);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Noto Kufi Arabic', Arial, sans-serif;
    font-size: 13px; line-height: 1.75;
    color: #1a1a2e; direction: rtl; text-align: right;
    width: 794px; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .block { width: 794px; }
  .hdr { background:#1a1a2e; color:#fff; padding:24px 40px 20px; }
  .hdr-sys { font-size:10px; color:rgba(255,255,255,.55); margin-bottom:4px; }
  .hdr-title { font-size:20px; font-weight:800; margin-bottom:8px; }
  .hdr-badge { display:inline-block; background:rgba(255,255,255,.15); border:1.5px solid rgba(255,255,255,.3); border-radius:20px; padding:3px 14px; font-size:11px; font-weight:700; color:rgba(255,255,255,.9); }
  .ibar { background:#eef2ff; border-top:2px solid #c7d2fe; border-bottom:2px solid #1a1a2e; display:flex; }
  .ic { flex:1; text-align:center; padding:14px 8px; border-right:1px solid #c7d2fe; }
  .ic:last-child { border-right:none; }
  .il { font-size:9px; color:#6b7280; font-weight:600; margin-bottom:3px; }
  .iv { font-size:15px; font-weight:800; color:#1a1a2e; }
  .meta-wrap { padding:16px 40px 0; }
  .meta-tbl { width:100%; border-collapse:collapse; font-size:12px; }
  .ml { font-weight:700; color:#374151; width:130px; padding:5px 0; border-bottom:1px solid #f0f0f0; }
  .mv { color:#4b5563; padding:5px 0; border-bottom:1px solid #f0f0f0; }
  .pw { padding:14px 40px; }
  .pr { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
  .pl { font-size:12px; font-weight:700; color:#374151; }
  .pp { font-size:22px; font-weight:800; color:#1d4ed8; }
  .track { height:13px; background:#e5e7eb; border-radius:7px; overflow:hidden; }
  .fill { height:100%; width:${pct}%; background:linear-gradient(90deg,#1d4ed8,#60a5fa); border-radius:7px; }
  .section { border:1px solid #e5e7eb; border-radius:8px; padding:14px 18px; margin:0 40px 14px; background:#fafafa; }
  .sh { font-size:12px; font-weight:700; margin-bottom:8px; padding-bottom:6px; border-bottom:1.5px solid #e5e7eb; color:#374151; }
  .blue-sh { color:#1e40af; border-bottom-color:#bfdbfe; }
  .warn-sh { color:#c2410c; border-bottom-color:#fed7aa; }
  .succ-sh { color:#15803d; border-bottom-color:#bbf7d0; }
  .warn-box { background:#fff7ed; border-color:#fed7aa; }
  .succ-box { background:#f0fdf4; border-color:#bbf7d0; }
  .st { font-size:12.5px; color:#374151; line-height:1.9; white-space:pre-wrap; }
  .at { width:100%; border-collapse:collapse; font-size:11px; }
  .th { background:#eff6ff; padding:6px 8px; font-size:9px; font-weight:700; color:#1e40af; border-bottom:2px solid #bfdbfe; text-align:right; }
  .thc { width:70px; text-align:center; }
  .td { padding:7px 8px; border-bottom:1px solid #f0f0f0; color:#374151; }
  .tdc { text-align:center; }
  .ftr { border-top:1px solid #e5e7eb; padding:10px 40px; display:flex; justify-content:space-between; font-size:10px; color:#9ca3af; }
</style>
</head>
<body>
${blocks.join("\n")}
</body>
</html>`;
}

export async function generateReportPDF(data: ReportPdfData): Promise<void> {
  const html = buildPdfBlocksHTML(data);

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:794px;height:8000px;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const iframeWin = iframe.contentWindow!;
  const doc = iframe.contentDocument || iframeWin.document;
  if (!doc) { document.body.removeChild(iframe); throw new Error("iframe doc unavailable"); }

  doc.open(); doc.write(html); doc.close();

  await new Promise<void>((resolve) => {
    if (iframeWin.document.readyState === "complete") setTimeout(resolve, 1800);
    else iframe.addEventListener("load", () => setTimeout(resolve, 1800), { once: true });
  });
  try { await iframeWin.document.fonts.ready; } catch { /* ok */ }
  await new Promise<void>((r) => setTimeout(r, 400));

  const fullH = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
  iframe.style.height = `${fullH + 200}px`;
  await new Promise<void>((r) => setTimeout(r, 100));

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const SCALE = 2;
  const MARGIN_MM = 0;
  const usableW = pdfW - MARGIN_MM * 2;
  const usableH = pdfH - MARGIN_MM * 2;

  const allBlocks = Array.from(doc.querySelectorAll(".block")) as HTMLElement[];
  const blockCanvases: HTMLCanvasElement[] = [];

  for (const blockEl of allBlocks) {
    const c = await html2canvas(blockEl, {
      scale: SCALE,
      useCORS: true,
      allowTaint: true,
      backgroundColor: null,
      logging: false,
      windowWidth: 794,
      onclone: (clonedDoc) => {
        clonedDoc.documentElement.setAttribute("lang", "ar");
        clonedDoc.documentElement.setAttribute("dir", "rtl");
        clonedDoc.body.style.direction = "rtl";
      },
    });
    blockCanvases.push(c);
  }

  let curY = 0;
  let isFirst = true;

  function startNewPage() {
    pdf.addPage();
    curY = 0;
  }

  for (const blockCanvas of blockCanvases) {
    const blockHMM = (blockCanvas.height / blockCanvas.width) * usableW;

    if (!isFirst && curY + blockHMM > usableH) {
      startNewPage();
    }

    if (isFirst) {
      isFirst = false;
    }

    const imgData = blockCanvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM + curY, usableW, blockHMM);
    curY += blockHMM;
  }

  const images = data.imageUrls ?? [];
  for (const imgUrl of images) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        pdf.addPage();
        const margin = 10;
        const maxW = pdfW - margin * 2;
        const maxH = pdfH - margin * 2;
        const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
        const w = img.naturalWidth * ratio;
        const h = img.naturalHeight * ratio;
        const x = (pdfW - w) / 2;
        const y = (pdfH - h) / 2;
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = img.naturalWidth;
        tmpCanvas.height = img.naturalHeight;
        const ctx = tmpCanvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imgData = tmpCanvas.toDataURL("image/jpeg", 0.92);
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pdfW, pdfH, "F");
        pdf.addImage(imgData, "JPEG", x, y, w, h);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = imgUrl;
    });
  }

  document.body.removeChild(iframe);
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  pdf.save(`تقرير-${typeLbl}-${fmtDate(data.reportDate)}-${data.reportId}.pdf`);
}

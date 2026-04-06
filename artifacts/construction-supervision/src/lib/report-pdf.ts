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

/** Open a browser print-preview window */
export function previewReport(data: ReportPdfData): void {
  const html = buildReportHTML(data, true);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export async function generateReportPDF(data: ReportPdfData): Promise<void> {
  const html = buildReportHTML(data, false);

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:794px;height:2000px;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const iframeWin = iframe.contentWindow!;
  const doc = iframe.contentDocument || iframeWin.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Cannot create iframe document");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    const check = () => {
      if (iframeWin.document.readyState === "complete") {
        setTimeout(resolve, 1500);
      } else {
        iframe.addEventListener("load", () => setTimeout(resolve, 1500), { once: true });
      }
    };
    check();
  });

  try {
    await iframeWin.document.fonts.ready;
  } catch { /* ignore */ }

  await new Promise<void>((r) => setTimeout(r, 300));

  // ── Render main page ──
  const mainPage = doc.querySelector(".main-page") as HTMLElement;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();

  async function renderEl(el: HTMLElement, addPage = false) {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 794,
      onclone: (clonedDoc) => {
        clonedDoc.documentElement.setAttribute("lang", "ar");
        clonedDoc.body.style.direction = "rtl";
        clonedDoc.body.style.textAlign = "right";
      },
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.93);
    const canvasRatio = canvas.height / canvas.width;
    const imgH = pdfW * canvasRatio;

    if (imgH <= pdfH) {
      if (addPage) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, pdfW, imgH);
    } else {
      const pageHeightPx = Math.round((pdfH / pdfW) * canvas.width);
      let yOffset = 0;
      let firstSlice = true;
      while (yOffset < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceH;
        const ctx = sliceCanvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.93);
        if (!firstSlice || addPage) pdf.addPage();
        pdf.addImage(sliceData, "JPEG", 0, 0, pdfW, (sliceH / canvas.width) * pdfW);
        yOffset += sliceH;
        firstSlice = false;
      }
    }
  }

  await renderEl(mainPage, false);

  // ── Render each image page ──
  const imagePages = doc.querySelectorAll(".image-page");
  for (const imgPage of Array.from(imagePages)) {
    await renderEl(imgPage as HTMLElement, true);
  }

  document.body.removeChild(iframe);

  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  pdf.save(`تقرير-${typeLbl}-${fmtDate(data.reportDate)}-${data.reportId}.pdf`);
}

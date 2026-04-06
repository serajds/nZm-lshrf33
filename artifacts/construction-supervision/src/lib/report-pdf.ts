import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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

function buildReportHTML(data: ReportPdfData): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));

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

  const imagesSection =
    data.imageUrls && data.imageUrls.length > 0
      ? `<div class="section-box">
          <div class="section-title">صور الموقع</div>
          <div class="images-grid">
            ${data.imageUrls
              .map(
                (url) =>
                  `<img src="${url}" class="site-img" onerror="this.style.display='none'" />`
              )
              .join("")}
          </div>
        </div>`
      : "";

  const metaPills = [
    data.ownerEntity ? `<span class="meta-pill">${escapeHtml(data.ownerEntity)}</span>` : "",
    data.contractor ? `<span class="meta-pill">${escapeHtml(data.contractor)}</span>` : "",
    data.supervisorEntity ? `<span class="meta-pill">${escapeHtml(data.supervisorEntity)}</span>` : "",
    data.location ? `<span class="meta-pill">${escapeHtml(data.location)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

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

  .page { width: 794px; }

  /* ===== HEADER ===== */
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
    color: #fff;
    padding: 32px 40px 28px;
    overflow: hidden;
  }
  .header-inner {
    display: table;
    width: 100%;
    table-layout: fixed;
  }
  .header-main {
    display: table-cell;
    vertical-align: top;
    text-align: right;
  }
  .header-badge-cell {
    display: table-cell;
    vertical-align: middle;
    width: 130px;
    text-align: center;
    padding-right: 20px;
  }
  .system-name {
    font-size: 11px;
    color: rgba(255,255,255,0.6);
    margin-bottom: 6px;
    font-weight: 500;
  }
  .project-name {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.3;
    color: #fff;
    margin-bottom: 12px;
  }
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
  .report-type-label {
    font-size: 10px;
    color: rgba(255,255,255,0.7);
    margin-bottom: 4px;
  }
  .report-type-value {
    font-size: 18px;
    font-weight: 800;
    color: #fff;
  }

  /* ===== INFO BAR — table layout to avoid RTL flex issues ===== */
  .info-bar {
    background: #f0f4ff;
    border-bottom: 3px solid #1a1a2e;
    padding: 0;
  }
  .info-bar table {
    width: 100%;
    border-collapse: collapse;
  }
  .info-bar td {
    width: 25%;
    padding: 16px 10px;
    text-align: center;
    border-left: 1px solid #d0d9f0;
  }
  .info-bar td:last-child { border-left: none; }
  .info-label {
    font-size: 10px;
    color: #6b7280;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .info-value {
    font-size: 15px;
    font-weight: 700;
    color: #1a1a2e;
  }

  /* ===== PROGRESS ===== */
  .progress-section {
    padding: 20px 40px;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
  }
  .progress-header {
    display: table;
    width: 100%;
    margin-bottom: 10px;
  }
  .progress-label {
    display: table-cell;
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    text-align: right;
  }
  .progress-pct {
    display: table-cell;
    font-size: 20px;
    font-weight: 800;
    color: #1a1a2e;
    text-align: left;
    width: 60px;
  }
  .progress-track {
    height: 14px;
    background: #e5e7eb;
    border-radius: 7px;
    overflow: hidden;
    position: relative;
  }
  /* RTL: bar fills from right. Use margin-left: auto to push fill to right side */
  .progress-fill-wrap {
    height: 100%;
    display: flex;
    justify-content: flex-start;
  }
  .progress-fill {
    height: 100%;
    border-radius: 7px;
    background: linear-gradient(90deg, #1d4ed8, #3b82f6);
    width: ${pct}%;
  }
  .progress-milestones {
    display: table;
    width: 100%;
    margin-top: 4px;
  }
  .progress-milestones td {
    font-size: 9px;
    color: #9ca3af;
    text-align: center;
    width: 25%;
  }
  .progress-milestones td:first-child { text-align: right; }
  .progress-milestones td:last-child { text-align: left; }

  /* ===== BODY ===== */
  .body { padding: 24px 40px 40px; }

  .section-box {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 16px;
    background: #fafafa;
  }
  .section-box.warning { background: #fff7ed; border-color: #fed7aa; }
  .section-box.success { background: #f0fdf4; border-color: #bbf7d0; }
  .section-title {
    font-size: 12px;
    font-weight: 700;
    color: #374151;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e5e7eb;
  }
  .warning-title { color: #c2410c; border-bottom-color: #fed7aa; }
  .success-title { color: #16a34a; border-bottom-color: #bbf7d0; }
  .section-text {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.9;
    white-space: pre-wrap;
  }

  /* ===== IMAGES ===== */
  .images-grid { margin-top: 10px; overflow: hidden; }
  .site-img {
    display: inline-block;
    width: 158px;
    height: 120px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    margin-left: 8px;
    margin-bottom: 8px;
  }

  /* ===== FOOTER ===== */
  .footer {
    background: #f9fafb;
    border-top: 1px solid #e5e7eb;
    padding: 14px 40px;
    display: table;
    width: 100%;
  }
  .footer-text {
    display: table-cell;
    font-size: 10px;
    color: #9ca3af;
    text-align: right;
  }
  .footer-logo {
    display: table-cell;
    font-size: 11px;
    font-weight: 700;
    color: #1a1a2e;
    opacity: 0.5;
    text-align: left;
    width: 180px;
  }
</style>
</head>
<body>
<div class="page">

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
        <td>100%</td>
        <td>75%</td>
        <td>50%</td>
        <td>25%</td>
        <td>0%</td>
      </tr>
    </table>
  </div>

  <!-- BODY -->
  <div class="body">
    <div class="section-box">
      <div class="section-title">وصف الأعمال المنجزة خلال الفترة</div>
      <div class="section-text">${escapeHtml(data.workDescription)}</div>
    </div>
    ${notesSection}
    ${recsSection}
    ${imagesSection}
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-text">تم إنشاء هذا التقرير آلياً &mdash; ${fmtDate(new Date().toISOString())}</div>
    <div class="footer-logo">نظام الإشراف الهندسي</div>
  </div>

</div>
</body>
</html>`;
}

export async function generateReportPDF(data: ReportPdfData): Promise<void> {
  const html = buildReportHTML(data);

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

  // Wait for fonts + layout to settle
  await new Promise<void>((resolve) => {
    const check = () => {
      if (iframeWin.document.readyState === "complete") {
        // Extra time for Google Fonts to load inside iframe
        setTimeout(resolve, 1500);
      } else {
        iframe.addEventListener("load", () => setTimeout(resolve, 1500), { once: true });
      }
    };
    check();
  });

  // Try to wait for fonts inside iframe
  try {
    await iframeWin.document.fonts.ready;
  } catch {
    // ignore
  }

  // Small extra settle time
  await new Promise<void>((r) => setTimeout(r, 300));

  const el = doc.body.firstElementChild as HTMLElement;

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: 794,
    windowWidth: 794,
    // Force RTL text direction in canvas
    onclone: (clonedDoc) => {
      clonedDoc.documentElement.setAttribute("lang", "ar");
      clonedDoc.body.style.direction = "rtl";
      clonedDoc.body.style.textAlign = "right";
    },
  });

  document.body.removeChild(iframe);

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const canvasRatio = canvas.height / canvas.width;
  const imgH = pdfW * canvasRatio;

  if (imgH <= pdfH) {
    pdf.addImage(imgData, "JPEG", 0, 0, pdfW, imgH);
  } else {
    // Multi-page: slice canvas by A4 page height
    const pageHeightPx = Math.round((pdfH / pdfW) * canvas.width);
    let yOffset = 0;
    let firstPage = true;

    while (yOffset < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.95);
      if (!firstPage) pdf.addPage();
      pdf.addImage(sliceData, "JPEG", 0, 0, pdfW, (sliceH / canvas.width) * pdfW);
      yOffset += sliceH;
      firstPage = false;
    }
  }

  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  pdf.save(`تقرير-${typeLbl}-${fmtDate(data.reportDate)}-${data.reportId}.pdf`);
}

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

function buildReportHTML(data: ReportPdfData): string {
  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  const pct = Math.min(100, Math.max(0, data.progressPercentage));

  const notesSection = data.technicalNotes
    ? `<div class="section-box warning">
        <div class="section-title warning-title">⚠ الملاحظات الفنية</div>
        <div class="section-text">${escapeHtml(data.technicalNotes)}</div>
      </div>`
    : "";

  const recsSection = data.recommendations
    ? `<div class="section-box success">
        <div class="section-title success-title">✓ التوصيات</div>
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

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Kufi Arabic', 'Arial', sans-serif;
    background: #ffffff;
    color: #1a1a2e;
    direction: rtl;
    width: 794px;
    font-size: 13px;
    line-height: 1.7;
  }
  .page { width: 794px; padding: 0; }

  /* ===== HEADER ===== */
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
    color: #fff;
    padding: 32px 40px 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header-right { flex: 1; }
  .system-name {
    font-size: 11px;
    letter-spacing: 0.5px;
    color: rgba(255,255,255,0.6);
    margin-bottom: 6px;
    font-weight: 500;
  }
  .project-name {
    font-size: 22px;
    font-weight: 800;
    line-height: 1.3;
    color: #fff;
    margin-bottom: 10px;
  }
  .meta-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .meta-pill {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 3px 12px;
    font-size: 11px;
    color: rgba(255,255,255,0.85);
  }
  .header-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-right: 24px;
  }
  .report-badge {
    background: rgba(255,255,255,0.15);
    border: 2px solid rgba(255,255,255,0.3);
    border-radius: 12px;
    padding: 10px 20px;
    text-align: center;
  }
  .report-type-label {
    font-size: 10px;
    color: rgba(255,255,255,0.7);
    margin-bottom: 2px;
  }
  .report-type-value {
    font-size: 16px;
    font-weight: 700;
    color: #fff;
  }

  /* ===== INFO BAR ===== */
  .info-bar {
    background: #f0f4ff;
    border-bottom: 3px solid #1a1a2e;
    padding: 16px 40px;
    display: flex;
    gap: 0;
  }
  .info-item {
    flex: 1;
    padding: 0 16px;
    border-left: 1px solid #d0d9f0;
    text-align: center;
  }
  .info-item:last-child { border-left: none; }
  .info-label {
    font-size: 10px;
    color: #6b7280;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 3px;
  }
  .info-value {
    font-size: 14px;
    font-weight: 700;
    color: #1a1a2e;
    direction: ltr;
    unicode-bidi: embed;
    font-variant-numeric: tabular-nums;
  }

  /* ===== PROGRESS ===== */
  .progress-section {
    padding: 20px 40px;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
  }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .progress-label { font-size: 12px; font-weight: 600; color: #374151; }
  .progress-pct {
    font-size: 20px;
    font-weight: 800;
    color: #1a1a2e;
    direction: ltr;
  }
  .progress-track {
    height: 14px;
    background: #e5e7eb;
    border-radius: 7px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 7px;
    background: linear-gradient(90deg, #3b82f6, #1d4ed8);
    width: ${pct}%;
    transition: width 0s;
  }
  .progress-milestones {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
  }
  .progress-tick { font-size: 9px; color: #9ca3af; }

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
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .warning-title { color: #c2410c; border-bottom-color: #fed7aa; }
  .success-title { color: #16a34a; border-bottom-color: #bbf7d0; }
  .section-text {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.8;
    white-space: pre-wrap;
  }

  /* ===== IMAGES ===== */
  .images-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 10px;
  }
  .site-img {
    width: 160px;
    height: 120px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
  }

  /* ===== FOOTER ===== */
  .footer {
    background: #f9fafb;
    border-top: 1px solid #e5e7eb;
    padding: 14px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-text { font-size: 10px; color: #9ca3af; }
  .footer-logo {
    font-size: 11px;
    font-weight: 700;
    color: #1a1a2e;
    opacity: 0.5;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-right">
      <div class="system-name">نظام الإشراف الهندسي — تقرير ${typeLbl}</div>
      <div class="project-name">${escapeHtml(data.projectName)}</div>
      <div class="meta-pills">
        ${data.ownerEntity ? `<span class="meta-pill">🏛 ${escapeHtml(data.ownerEntity)}</span>` : ""}
        ${data.contractor ? `<span class="meta-pill">🏗 ${escapeHtml(data.contractor)}</span>` : ""}
        ${data.supervisorEntity ? `<span class="meta-pill">👷 ${escapeHtml(data.supervisorEntity)}</span>` : ""}
        ${data.location ? `<span class="meta-pill">📍 ${escapeHtml(data.location)}</span>` : ""}
      </div>
    </div>
    <div class="header-left">
      <div class="report-badge">
        <div class="report-type-label">نوع التقرير</div>
        <div class="report-type-value">${typeLbl}</div>
      </div>
    </div>
  </div>

  <div class="info-bar">
    <div class="info-item">
      <div class="info-label">تاريخ التقرير</div>
      <div class="info-value">${fmtDate(data.reportDate)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">بداية الفترة</div>
      <div class="info-value">${fmtDate(data.periodStart)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">نهاية الفترة</div>
      <div class="info-value">${fmtDate(data.periodEnd)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">رقم التقرير</div>
      <div class="info-value">#${data.reportId}</div>
    </div>
  </div>

  <div class="progress-section">
    <div class="progress-header">
      <div class="progress-label">نسبة الإنجاز التراكمية</div>
      <div class="progress-pct">${pct}%</div>
    </div>
    <div class="progress-track">
      <div class="progress-fill"></div>
    </div>
    <div class="progress-milestones">
      <span class="progress-tick">0%</span>
      <span class="progress-tick">25%</span>
      <span class="progress-tick">50%</span>
      <span class="progress-tick">75%</span>
      <span class="progress-tick">100%</span>
    </div>
  </div>

  <div class="body">
    <div class="section-box">
      <div class="section-title">وصف الأعمال المنجزة خلال الفترة</div>
      <div class="section-text">${escapeHtml(data.workDescription)}</div>
    </div>

    ${notesSection}
    ${recsSection}
    ${imagesSection}
  </div>

  <div class="footer">
    <div class="footer-text">تم إنشاء هذا التقرير آلياً بتاريخ ${fmtDate(new Date().toISOString())}</div>
    <div class="footer-logo">نظام الإشراف الهندسي</div>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function generateReportPDF(data: ReportPdfData): Promise<void> {
  const html = buildReportHTML(data);

  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:794px;height:1123px;border:none;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Cannot create iframe document");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    const onLoad = () => resolve();
    if (iframe.contentWindow?.document.readyState === "complete") {
      setTimeout(resolve, 800);
    } else {
      iframe.addEventListener("load", () => setTimeout(onLoad, 800));
    }
  });

  const el = doc.body.firstElementChild as HTMLElement;

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: 794,
  });

  document.body.removeChild(iframe);

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  const ratio = canvas.height / canvas.width;
  const imgH = pdfW * ratio;

  if (imgH <= pdfH) {
    pdf.addImage(imgData, "JPEG", 0, 0, pdfW, imgH);
  } else {
    let y = 0;
    let remaining = canvas.height;
    while (remaining > 0) {
      const sliceH = Math.min(canvas.height - y, Math.round((pdfH / pdfW) * canvas.width));
      const sliceCanvas = document.createElement("canvas");
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext("2d")!;
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.95);
      if (y > 0) pdf.addPage();
      pdf.addImage(sliceData, "JPEG", 0, 0, pdfW, (sliceH / canvas.width) * pdfW);
      y += sliceH;
      remaining -= sliceH;
    }
  }

  const typeLbl = data.reportType === "weekly" ? "أسبوعي" : "شهري";
  pdf.save(`تقرير-${typeLbl}-${fmtDate(data.reportDate)}-${data.reportId}.pdf`);
}

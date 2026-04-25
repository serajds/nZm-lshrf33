export interface ActivityForReport {
  name: string;
  plannedProgress: number;
  actualProgress: number;
  status: string;
}

export interface CompanyLogo {
  name: string;
  logoUrl: string | null;
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
  reportNumber?: number;
  activities?: ActivityForReport[];
  contractValue?: number | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
  plannedProgress?: number | null;
  companyLogos?: {
    owner?: CompanyLogo;
    contractor?: CompanyLogo;
    supervisor?: CompanyLogo;
  };
  apiBase?: string;
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

  const totalDuration = daysBetween(data.startDate, data.expectedEndDate);
  const elapsed = daysBetween(data.startDate, data.reportDate);
  const remainingRaw = daysBetween(data.reportDate, data.expectedEndDate);
  const overrunDays = remainingRaw != null && remainingRaw < 0 && pct < 100 ? -remainingRaw : 0;
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
    <div class="section avoid-break">
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
              <td class="td">${esc(a.name)}</td>
              <td class="td tc">${(a.plannedProgress ?? 0).toFixed(1)}%</td>
              <td class="td tc" style="font-weight:700">${(a.actualProgress ?? 0).toFixed(1)}%</td>
              <td class="td tc">
                <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${statusBg(a.status)};color:${statusColor(a.status)};border:1px solid ${statusColor(a.status)}">
                  ${statusLabel(a.status)}
                </span>
              </td>
              <td class="td">
                <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:${barW}%;background:${statusColor(a.status)};border-radius:4px"></div></div>
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

  const images = data.imageUrls ?? [];
  const imagesHTML = images.length > 0 ? `
    <div style="break-before:page;page-break-before:always">
      <div class="section-title blue-title avoid-break" style="border:none;padding:0 0 10px 0;margin-bottom:16px;border-bottom:2px solid #bfdbfe">📷 صور الموقع (${images.length} صورة)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${images.map((url, i) => { const safe = escAttr(url); return safe ? `
          <div class="avoid-break" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc">
            <img src="${safe}" style="width:100%;height:200px;object-fit:cover;display:block" onerror="this.parentNode.style.display='none'" />
            <div style="font-size:11px;color:#64748b;text-align:center;padding:6px;background:#f1f5f9">صورة ${i + 1} من ${images.length}</div>
          </div>` : ""; }).join("")}
      </div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>تقرير ${typeLbl} — ${esc(data.projectName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4 portrait; margin: 12mm 14mm 14mm 14mm; }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Noto Kufi Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
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
    background: linear-gradient(135deg, #1e293b, #334155, #475569);
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
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; position: relative; z-index: 1; }
  .header-info { flex: 1; }
  .header-sys { font-size: 10px; text-transform: uppercase; letter-spacing: 3px; color: rgba(255,255,255,0.45); margin-bottom: 6px; }
  .header-name { font-size: 22px; font-weight: 800; line-height: 1.3; margin-bottom: 12px; }
  .header-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-block; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 3px 12px; font-size: 11px; color: rgba(255,255,255,0.8); }
  .header-badge { background: rgba(255,255,255,0.12); border: 1.5px solid rgba(255,255,255,0.25); border-radius: 12px; padding: 12px 20px; text-align: center; min-width: 90px; }
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
  .dp-fill-blue { height: 100%; border-radius: 8px; background: linear-gradient(90deg, #2563eb, #60a5fa); }
  .dp-fill-gray { height: 100%; border-radius: 8px; background: linear-gradient(90deg, #94a3b8, #cbd5e1); }
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
  .tl-fill { height: 100%; background: linear-gradient(90deg, #1e40af, #3b82f6); border-radius: 6px; }
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
  .th { background: #f1f5f9; padding: 8px 10px; font-size: 12px; font-weight: 700; color: #475569; border-bottom: 2px solid #cbd5e1; text-align: right; }
  .tc { text-align: center !important; }
  .td { padding: 9px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: middle; }

  /* ── FOOTER ── */
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }

  /* ── TOOLBAR ── */
  .toolbar { position: sticky; top: 0; left: 0; right: 0; background: linear-gradient(135deg, #1e293b, #334155); padding: 10px 16px; display: flex; justify-content: center; align-items: center; gap: 10px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
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
    entries.push({ role: "جهة الإشراف", name: logos.supervisor.name, src: logos.supervisor.logoUrl ? escAttr(base + logos.supervisor.logoUrl) : "" });
  }
  if (logos.owner) {
    entries.push({ role: "الجهة المالكة", name: logos.owner.name, src: logos.owner.logoUrl ? escAttr(base + logos.owner.logoUrl) : "" });
  }
  if (logos.contractor) {
    entries.push({ role: "المقاول", name: logos.contractor.name, src: logos.contractor.logoUrl ? escAttr(base + logos.contractor.logoUrl) : "" });
  }
  const html = entries.map(e => `<div class="logo-item">
    <div class="logo-role">${e.role}</div>
    <div class="logo-img-box">${e.src ? `<img src="${e.src}" onerror="this.style.display='none'" />` : ""}</div>
    <div class="logo-name">${esc(e.name)}</div>
  </div>`).join("");
  return `<div class="logos-strip avoid-break">${html}</div>`;
})()}

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
      <div class="badge-val">${typeLbl}</div>
    </div>
  </div>
</div>

<!-- INFO STRIP -->
<div class="info-strip avoid-break">
  <div class="info-cell"><div class="info-lbl">تاريخ التقرير</div><div class="info-val">${fmtDate(data.reportDate)}</div></div>
  <div class="info-cell"><div class="info-lbl">بداية الفترة</div><div class="info-val">${fmtDate(data.periodStart)}</div></div>
  <div class="info-cell"><div class="info-lbl">نهاية الفترة</div><div class="info-val">${fmtDate(data.periodEnd)}</div></div>
  <div class="info-cell"><div class="info-lbl">رقم التقرير</div><div class="info-val">#${data.reportNumber ?? data.reportId}</div></div>
</div>

<!-- DUAL PROGRESS -->
<div class="dual-box avoid-break">
  <div class="dual-head">
    <span class="dual-title">مقارنة الإنجاز</span>
    ${deviation != null ? `<span class="dev-badge ${deviation >= 0 ? "dev-ok" : "dev-warn"}">${deviation >= 0 ? "+" : ""}${deviation}% ${deviation >= 0 ? "متقدم عن الخطة" : "خلف الخطة"}</span>` : ""}
    ${overrunDays > 0 ? `<span class="dev-badge dev-warn">تجاوز المدة: ${overrunDays} يوم</span>` : ""}
  </div>
  <div class="dp-row">
    <span class="dp-lbl">الفعلي</span>
    <div class="dp-track"><div class="dp-fill-blue" style="width:${pct}%"></div></div>
    <span class="dp-val" style="color:#2563eb">${pct}%</span>
  </div>
  ${plannedPct != null ? `<div class="dp-row">
    <span class="dp-lbl">المخطط</span>
    <div class="dp-track"><div class="dp-fill-gray" style="width:${plannedPct}%"></div></div>
    <span class="dp-val">${plannedPct}%</span>
  </div>` : ""}
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
${data.startDate && data.expectedEndDate ? `<div class="tl-box avoid-break">
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

<!-- FOOTER -->
<div class="footer avoid-break">
  <span>تم إنشاؤه آلياً بواسطة إدارة الإشراف والمتابعة — ${fmtDate(new Date().toISOString())}</span>
  <span style="font-weight:700;color:#64748b">تقرير ${typeLbl} #${data.reportNumber ?? data.reportId}</span>
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
  plannedProgress: number;
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
}

function buildExecutiveSummaryHTML(data: ExecutiveSummaryData): string {
  const deviation = data.overallProgress - data.plannedProgress;
  const totalDays = daysBetween(data.startDate, data.expectedEndDate);
  const elapsed = daysBetween(data.startDate, new Date().toISOString());
  const remaining = totalDays != null && elapsed != null ? Math.max(0, totalDays - elapsed) : null;
  const overrunDays = data.expectedEndDate && data.overallProgress < 100
    ? (() => {
        const t = new Date();
        const e = new Date(data.expectedEndDate);
        const tu = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
        const eu = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
        return Math.max(0, Math.floor((tu - eu) / 86400000));
      })()
    : 0;
  const scheduleDeviation = deviation < 0 ? Math.abs(deviation) : 0;

  const completed = data.activities.filter(a => a.status === "completed").length;
  const inProgress = data.activities.filter(a => a.status === "in_progress").length;
  const delayed = data.activities.filter(a => a.status === "delayed").length;
  const notStarted = data.activities.filter(a => a.status === "not_started").length;
  const total = data.activities.length;

  const statusLbl = ({ active: "نشط", completed: "مكتمل", delayed: "متأخر", suspended: "معلّق" } as Record<string, string>)[data.status ?? ""] ?? data.status ?? "—";

  const logosHtml = data.companyLogos ? (() => {
    const entries = [data.companyLogos.owner, data.companyLogos.supervisor, data.companyLogos.contractor].filter(l => l?.logoUrl);
    if (entries.length === 0) return "";
    return `<div style="display:flex;justify-content:center;gap:40px;margin-bottom:20px;padding:12px 0">
      ${entries.map(l => `<div style="text-align:center"><img src="${escAttr(l!.logoUrl!.startsWith("/") && data.apiBase ? data.apiBase + l!.logoUrl! : l!.logoUrl!)}" style="max-height:55px;max-width:120px;object-fit:contain" onerror="this.style.display='none'" /><div style="font-size:9px;color:#94a3b8;margin-top:4px">${esc(l!.name)}</div></div>`).join("")}
    </div>`;
  })() : "";

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<title>ملخص تنفيذي — ${esc(data.projectName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Noto Kufi Arabic',sans-serif;direction:rtl;background:#fff;color:#1e293b;font-size:13px;line-height:1.7}
@media print{@page{size:A4 portrait;margin:15mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none!important}}
.container{max-width:750px;margin:0 auto;padding:20px}
.toolbar{position:sticky;top:0;left:0;right:0;background:rgba(15,23,42,.95);backdrop-filter:blur(8px);padding:10px 16px;display:flex;gap:10px;z-index:999;justify-content:center;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.3)}
.toolbar button{color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;white-space:nowrap}
.toolbar button:first-child{background:#2563eb}
.toolbar button:first-child:hover{background:#1d4ed8}
.toolbar button:last-child{background:rgba(255,255,255,.15)}
.toolbar button:last-child:hover{background:rgba(255,255,255,.25)}
.header{text-align:center;margin-bottom:24px;padding:20px 0;border-bottom:3px solid #1e3a5f}
.header h1{font-size:22px;font-weight:800;color:#1e3a5f;margin-bottom:4px}
.header p{font-size:13px;color:#64748b}
.section{margin-bottom:20px}
.section-title{font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0;display:flex;align-items:center;gap:8px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.info-item{display:flex;justify-content:space-between;padding:6px 10px;background:#f8fafc;border-radius:6px;font-size:12px}
.info-item span:first-child{color:#64748b;font-weight:500}
.info-item span:last-child{font-weight:600}
.metric-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.metric{text-align:center;padding:16px 10px;border-radius:10px;border:1px solid #e2e8f0}
.metric .value{font-size:28px;font-weight:800;line-height:1.2}
.metric .label{font-size:11px;color:#64748b;margin-top:4px}
.progress-bar{height:14px;background:#f1f5f9;border-radius:8px;overflow:hidden;margin:6px 0;position:relative}
.progress-fill{height:100%;border-radius:8px;transition:width .3s}
.activity-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
.activity-table th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:right;font-weight:600}
.activity-table td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
.activity-table tr:nth-child(even){background:#f8fafc}
.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.footer{text-align:center;padding:16px 0;margin-top:24px;border-top:2px solid #e2e8f0;color:#94a3b8;font-size:10px}
</style></head><body>
<div class="toolbar no-print">
  <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
  <button onclick="window.close()">✕ إغلاق</button>
</div>
<div class="container">
  ${logosHtml}
  <div class="header">
    <h1>ملخص تنفيذي</h1>
    <p style="font-size:16px;font-weight:700;margin-top:6px">${esc(data.projectName)}</p>
    <p>تاريخ الإعداد: ${fmtDate(new Date().toISOString())}</p>
  </div>

  <div class="section">
    <div class="section-title">📋 معلومات المشروع</div>
    <div class="info-grid">
      <div class="info-item"><span>المالك</span><span>${esc(data.ownerEntity ?? "—")}</span></div>
      <div class="info-item"><span>المقاول</span><span>${esc(data.contractor ?? "—")}</span></div>
      <div class="info-item"><span>جهة الإشراف</span><span>${esc(data.supervisorEntity ?? "—")}</span></div>
      <div class="info-item"><span>الموقع</span><span>${esc(data.location ?? "—")}</span></div>
      <div class="info-item"><span>تاريخ البدء</span><span>${fmtDate(data.startDate)}</span></div>
      <div class="info-item"><span>تاريخ الانتهاء المتوقع</span><span>${fmtDate(data.expectedEndDate)}</span></div>
      <div class="info-item"><span>حالة المشروع</span><span>${esc(statusLbl)}</span></div>
      ${data.contractValue ? `<div class="info-item"><span>قيمة العقد</span><span>${fmtMoney(data.contractValue)} ر.س</span></div>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-title">📊 مؤشرات الأداء الرئيسية</div>
    <div class="metric-grid">
      <div class="metric" style="border-color:#10b981">
        <div class="value" style="color:#10b981">${data.overallProgress.toFixed(1)}%</div>
        <div class="label">الإنجاز الفعلي</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${data.overallProgress}%;background:#10b981"></div></div>
      </div>
      <div class="metric" style="border-color:#3b82f6">
        <div class="value" style="color:#3b82f6">${data.plannedProgress.toFixed(1)}%</div>
        <div class="label">الإنجاز المخطط</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${data.plannedProgress}%;background:#3b82f6"></div></div>
      </div>
      <div class="metric" style="border-color:${deviation >= 0 ? '#10b981' : '#ef4444'}">
        <div class="value" style="color:${deviation >= 0 ? '#10b981' : '#ef4444'}">${deviation > 0 ? '+' : ''}${deviation.toFixed(1)}%</div>
        <div class="label">${deviation >= 0 ? 'متقدم عن الخطة' : 'انحراف عن الخطة'}</div>
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric">
        <div class="value" style="color:#1e3a5f">${totalDays ?? "—"}</div>
        <div class="label">إجمالي أيام المشروع</div>
      </div>
      <div class="metric">
        <div class="value" style="color:${overrunDays > 0 ? '#ef4444' : '#3b82f6'}">${overrunDays > 0 ? overrunDays : (remaining ?? '—')}</div>
        <div class="label">${overrunDays > 0 ? 'تجاوز المدة التعاقدية (يوم)' : 'أيام متبقية'}</div>
      </div>
      <div class="metric">
        <div class="value" style="color:${scheduleDeviation > 0 ? '#ef4444' : '#10b981'}">${scheduleDeviation > 0 ? scheduleDeviation.toFixed(1) + '%' : '—'}</div>
        <div class="label">${scheduleDeviation > 0 ? 'فجوة الانحراف عن الخطة' : 'لا يوجد انحراف عن الخطة'}</div>
      </div>
      <div class="metric">
        <div class="value" style="color:#1e3a5f">${data.reportsCount}</div>
        <div class="label">عدد التقارير</div>
      </div>
    </div>
    ${data.suspensionDays ? `<div class="info-item" style="margin-top:8px"><span>أيام التوقف المعتمدة</span><span>${data.suspensionDays} يوم</span></div>` : ""}
    ${data.extensionDays ? `<div class="info-item" style="margin-top:4px"><span>أيام التمديد</span><span>${data.extensionDays} يوم</span></div>` : ""}
  </div>

  <div class="section">
    <div class="section-title">📈 ملخص بنود الأعمال (${total} بند)</div>
    <div class="metric-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="metric" style="border-color:#10b981;padding:10px">
        <div class="value" style="color:#10b981;font-size:22px">${completed}</div>
        <div class="label">مكتمل</div>
      </div>
      <div class="metric" style="border-color:#3b82f6;padding:10px">
        <div class="value" style="color:#3b82f6;font-size:22px">${inProgress}</div>
        <div class="label">قيد التنفيذ</div>
      </div>
      <div class="metric" style="border-color:#ef4444;padding:10px">
        <div class="value" style="color:#ef4444;font-size:22px">${delayed}</div>
        <div class="label">متأخر</div>
      </div>
      <div class="metric" style="border-color:#94a3b8;padding:10px">
        <div class="value" style="color:#94a3b8;font-size:22px">${notStarted}</div>
        <div class="label">لم يبدأ</div>
      </div>
    </div>

    ${total > 0 ? `<table class="activity-table">
      <thead><tr><th>#</th><th>اسم البند</th><th>المخطط</th><th>الفعلي</th><th>الفرق</th><th>الحالة</th></tr></thead>
      <tbody>${data.activities.map((a, i) => {
        const diff = a.actualProgress - a.plannedProgress;
        return `<tr>
          <td style="text-align:center;color:#94a3b8">${i + 1}</td>
          <td>${esc(a.name)}</td>
          <td style="text-align:center">${(a.plannedProgress ?? 0).toFixed(1)}%</td>
          <td style="text-align:center">${(a.actualProgress ?? 0).toFixed(1)}%</td>
          <td style="text-align:center;color:${diff >= 0 ? '#10b981' : '#ef4444'};font-weight:600">${diff > 0 ? '+' : ''}${diff.toFixed(1)}%</td>
          <td style="text-align:center"><span class="status-badge" style="color:${statusColor(a.status)};background:${statusBg(a.status)}">${statusLabel(a.status)}</span></td>
        </tr>`;
      }).join("")}</tbody>
    </table>` : ""}
  </div>

  <div class="footer">
    <span>تم إنشاؤه آلياً بواسطة إدارة الإشراف والمتابعة — ${fmtDate(new Date().toISOString())}</span>
  </div>
</div>
</body></html>`;
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

/* ────────────────── Attendance employee report ────────────────── */

export interface AttendanceReportDay {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
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

function diffMinutes(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (!isFinite(a) || !isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 60000);
}

function fmtDuration(mins: number | null): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} د`;
  if (m === 0) return `${h} س`;
  return `${h} س ${m} د`;
}

function fmtDurationHTML(mins: number | null): string {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} <span class="stat-unit">د</span>`;
  if (m === 0) return `${h} <span class="stat-unit">س</span>`;
  return `${h} <span class="stat-unit">س</span> ${m} <span class="stat-unit">د</span>`;
}

function buildAttendanceReportHTML(data: AttendanceReportData): string {
  const roleLbl = data.employeeRole ? (ATTENDANCE_ROLE_LABEL[data.employeeRole] ?? data.employeeRole) : "";

  const totalMins = data.days.reduce((s, d) => s + (diffMinutes(d.checkIn, d.checkOut) ?? 0), 0);
  const presentDays = data.days.filter(d => d.checkIn).length;
  const completeDays = data.days.filter(d => d.checkIn && d.checkOut).length;
  const incompleteDays = data.days.filter(d => d.checkIn && !d.checkOut).length;

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
    if (logos.owner) entries.push({ role: "جهة المالك", name: logos.owner.name, src: logos.owner.logoUrl ? escAttr(base + logos.owner.logoUrl) : "" });
    if (logos.contractor) entries.push({ role: "المقاول", name: logos.contractor.name, src: logos.contractor.logoUrl ? escAttr(base + logos.contractor.logoUrl) : "" });
    if (logos.supervisor) entries.push({ role: "جهة الإشراف", name: logos.supervisor.name, src: logos.supervisor.logoUrl ? escAttr(base + logos.supervisor.logoUrl) : "" });
    const html = entries.map(e => `<div class="logo-item">
      <div class="logo-role">${e.role}</div>
      <div class="logo-img-box">${e.src ? `<img src="${e.src}" onerror="this.style.display='none'" />` : ""}</div>
      <div class="logo-name">${esc(e.name)}</div>
    </div>`).join("");
    return `<div class="logos-strip avoid-break">${html}</div>`;
  })();

  const rowsHTML = data.days.length === 0
    ? `<tr><td class="td tc" colspan="4" style="color:#94a3b8;padding:24px 10px">لا توجد سجلات لهذه الفترة.</td></tr>`
    : data.days.map((d, i) => {
        const mins = diffMinutes(d.checkIn, d.checkOut);
        const incomplete = d.checkIn && !d.checkOut;
        return `<tr style="background:${i % 2 === 0 ? "#fff" : "#f8fafc"}">
          <td class="td tc" style="font-weight:600">${esc(fmtDate(d.date))}</td>
          <td class="td tc">${esc(fmtLibyaTimeForReport(d.checkIn))}</td>
          <td class="td tc">${esc(fmtLibyaTimeForReport(d.checkOut))}</td>
          <td class="td tc" style="font-weight:600;color:${incomplete ? "#dc2626" : "#1e293b"}">${incomplete ? "بدون انصراف" : esc(fmtDuration(mins))}</td>
        </tr>`;
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
    font-family: 'Noto Kufi Arabic', 'Segoe UI', Tahoma, Arial, sans-serif;
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
    background: linear-gradient(135deg, #1e293b, #334155, #475569);
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

  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 11px; color: #94a3b8; }

  .toolbar { position: sticky; top: 0; left: 0; right: 0; background: linear-gradient(135deg, #1e293b, #334155); padding: 10px 16px; display: flex; justify-content: center; align-items: center; gap: 10px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
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
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
    </div>
    <div><div class="stat-lbl">أيام الحضور</div><div class="stat-val">${presentDays} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 8"/></svg>
    </div>
    <div><div class="stat-lbl">أيام مكتملة</div><div class="stat-val">${completeDays} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:${incompleteDays > 0 ? "#fef2f2" : "#f8fafc"};color:${incompleteDays > 0 ? "#dc2626" : "#94a3b8"}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <div><div class="stat-lbl">أيام بدون انصراف</div><div class="stat-val">${incompleteDays} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    </div>
    <div><div class="stat-lbl">إجمالي الساعات</div><div class="stat-val">${fmtDurationHTML(totalMins)}</div></div>
  </div>
</div>

<!-- DETAILS TABLE -->
<div class="section avoid-break">
  <div class="section-title blue-title">سجل الحضور والانصراف اليومي</div>
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr>
          <th class="th" style="width:30%">التاريخ</th>
          <th class="th" style="width:22%">وقت الحضور</th>
          <th class="th" style="width:22%">وقت الانصراف</th>
          <th class="th" style="width:26%">المدة</th>
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
  <span>تم إنشاؤه آلياً بواسطة إدارة الإشراف والمتابعة — ${fmtDate(new Date().toISOString())}</span>
  <span style="font-weight:700;color:#64748b">توقيت ليبيا (GMT+2)</span>
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

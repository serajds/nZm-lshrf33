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
  const remaining = daysBetween(data.reportDate, data.expectedEndDate);
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
      <div class="section-title blue-title">📋 حالة الأنشطة</div>
      <table class="tbl">
        <thead>
          <tr>
            <th class="th" style="text-align:right;width:40%">النشاط</th>
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
              <td class="td tc">${a.plannedProgress}%</td>
              <td class="td tc" style="font-weight:700">${a.actualProgress}%</td>
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
  .toolbar { position: fixed; top: 0; left: 0; right: 0; background: linear-gradient(135deg, #1e293b, #334155); padding: 12px 24px; display: flex; justify-content: center; gap: 14px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
  .btn-print { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 10px 32px; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; }
  .btn-print:hover { background: #1d4ed8; }
  .btn-close { background: #64748b; color: #fff; border: none; border-radius: 8px; padding: 10px 24px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; }
  .btn-close:hover { background: #475569; }

  @media print {
    .toolbar { display: none !important; }
    body { padding-top: 0 !important; }
  }
  @media screen {
    body { padding-top: 56px; max-width: 210mm; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
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
      <div class="header-sys">نظام الإشراف الهندسي</div>
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
    ${deviation != null ? `<span class="dev-badge ${deviation >= 0 ? "dev-ok" : "dev-warn"}">${deviation >= 0 ? "+" : ""}${deviation}% ${deviation >= 0 ? "متقدم" : "متأخر"}</span>` : ""}
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
  ${remaining != null ? `<div class="stat">
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
  <div class="act-title">ملخص حالة الأنشطة (${acts.length} نشاط)</div>
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
  <span>تم إنشاؤه آلياً بواسطة نظام الإشراف الهندسي — ${fmtDate(new Date().toISOString())}</span>
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

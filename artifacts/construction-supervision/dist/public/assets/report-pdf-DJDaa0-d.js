import{_ as fe}from"./index-CRPRZlmN.js";import"./vendor-react-pqhRnJof.js";import"./vendor-rq-BqpHnL6l.js";import"./vendor-toast-Budz4uce.js";import"./vendor-radix-DHXN4MQg.js";import"./vendor-charts-BsgifKwD.js";import"./vendor-api-BqwIArrJ.js";import"./vendor-icons-CPqVqA0P.js";function L(e){if(!e)return"—";const s=new Date(e);return isNaN(s.getTime())?"—":`${s.getFullYear()}/${String(s.getMonth()+1).padStart(2,"0")}/${String(s.getDate()).padStart(2,"0")}`}function r(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function B(e){const s=e.replace(/["'<>]/g,"");return/^(https?:\/\/|\/)/i.test(s)?r(s):""}function be(e){return{completed:"مكتمل",in_progress:"جارٍ",delayed:"متأخر",not_started:"لم يبدأ"}[e]??e}function oe(e){return{completed:"#16a34a",in_progress:"#2563eb",delayed:"#dc2626",not_started:"#6b7280"}[e]??"#6b7280"}function xe(e){return{completed:"#f0fdf4",in_progress:"#eff6ff",delayed:"#fef2f2",not_started:"#f9fafb"}[e]??"#f9fafb"}function de(e){return e==null?"—":e.toLocaleString("ar-u-nu-latn",{maximumFractionDigits:0})}function _(e,s){if(!e||!s)return null;const t=new Date(e),n=new Date(s);return isNaN(t.getTime())||isNaN(n.getTime())?null:Math.round((n.getTime()-t.getTime())/864e5)}function ce(e){const s=e.reportType==="weekly"?"أسبوعي":"شهري",t=Math.min(100,Math.max(0,e.progressPercentage)),n=e.plannedProgress!=null?Math.min(100,Math.max(0,e.plannedProgress)):null,d=n!=null?t-n:null,b=_(e.startDate,e.expectedEndDate),u=_(e.startDate,e.reportDate),p=_(e.reportDate,e.expectedEndDate),c=p!=null&&p<0&&t<100?-p:0,w=p!=null?Math.max(0,p):null,$=b&&u!=null?Math.min(100,Math.round(u/b*100)):null,a=e.activities??[],y=a.filter(i=>i.status==="completed").length,m=a.filter(i=>i.status==="in_progress").length,g=a.filter(i=>i.status==="delayed").length,A=a.filter(i=>i.status==="not_started").length,z=[e.ownerEntity?["جهة المالك",e.ownerEntity]:null,e.contractor?["المقاول",e.contractor]:null,e.supervisorEntity?["جهة الإشراف",e.supervisorEntity]:null,e.location?["الموقع",e.location]:null].filter(Boolean),j=a.length>0?`
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
          ${a.map((i,v)=>{const S=Math.min(100,Math.max(0,i.actualProgress));return`<tr style="background:${v%2===0?"#fff":"#f8fafc"}">
              <td class="td">${r(i.name)}</td>
              <td class="td tc">${(i.plannedProgress??0).toFixed(1)}%</td>
              <td class="td tc" style="font-weight:700">${(i.actualProgress??0).toFixed(1)}%</td>
              <td class="td tc">
                <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${xe(i.status)};color:${oe(i.status)};border:1px solid ${oe(i.status)}">
                  ${be(i.status)}
                </span>
              </td>
              <td class="td">
                <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden"><div style="height:100%;width:${S}%;background:${oe(i.status)};border-radius:4px"></div></div>
              </td>
            </tr>`}).join("")}
        </tbody>
      </table>
    </div>`:"",P=e.technicalNotes?`
    <div class="section avoid-break" style="background:#fffbeb;border-color:#fcd34d">
      <div class="section-title" style="color:#92400e;border-color:#fcd34d">⚠️ الملاحظات الفنية</div>
      <p class="body-text">${r(e.technicalNotes)}</p>
    </div>`:"",R=e.recommendations?`
    <div class="section avoid-break" style="background:#f0fdf4;border-color:#86efac">
      <div class="section-title" style="color:#166534;border-color:#86efac">✅ التوصيات</div>
      <p class="body-text">${r(e.recommendations)}</p>
    </div>`:"",k=(i,v,S)=>`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      ${i.map((N,h)=>{const F=B(N);return F?`
        <div class="avoid-break" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc">
          <img src="${F}" style="width:100%;height:200px;object-fit:cover;display:block" onerror="this.parentNode.style.display='none'" />
          <div style="font-size:11px;color:#64748b;text-align:center;padding:6px;background:#f1f5f9">صورة ${S+h+1} من ${v}</div>
        </div>`:""}).join("")}
    </div>`,x=(e.imageGroups??[]).filter(i=>i&&Array.isArray(i.urls)&&i.urls.length>0);let G="";if(x.length>0){let i=0;const v=x.reduce((N,h)=>N+h.urls.length,0);G=`<div style="break-before:page;page-break-before:always">${x.map((N,h)=>{const F=`
        <div class="avoid-break" style="${h>0?"margin-top:18px;":""}break-after:avoid;page-break-after:avoid">
          <div class="section-title blue-title" style="border:none;padding:0 0 10px 0;margin-bottom:14px;border-bottom:2px solid #bfdbfe">📷 ${r(N.category)} (${N.urls.length} صورة)</div>
        </div>
        ${k(N.urls,v,i)}`;return i+=N.urls.length,F}).join("")}</div>`}else{const i=e.imageUrls??[];i.length>0&&(G=`
        <div style="break-before:page;page-break-before:always">
          <div class="section-title blue-title avoid-break" style="border:none;padding:0 0 10px 0;margin-bottom:16px;border-bottom:2px solid #bfdbfe">📷 صور الموقع (${i.length} صورة)</div>
          ${k(i,i.length,0)}
        </div>`)}return`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>تقرير ${s} — ${r(e.projectName)}</title>
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

${(()=>{const i=e.companyLogos,v=e.apiBase||"";if(!i||!i.owner?.logoUrl&&!i.contractor?.logoUrl&&!i.supervisor?.logoUrl)return"";const S=[];return i.supervisor&&S.push({role:"جهة الإشراف",name:i.supervisor.name,src:i.supervisor.logoUrl?B(v+i.supervisor.logoUrl):""}),i.owner&&S.push({role:"الجهة المالكة",name:i.owner.name,src:i.owner.logoUrl?B(v+i.owner.logoUrl):""}),i.contractor&&S.push({role:"المقاول",name:i.contractor.name,src:i.contractor.logoUrl?B(v+i.contractor.logoUrl):""}),`<div class="logos-strip avoid-break">${S.map(h=>`<div class="logo-item">
    <div class="logo-role">${h.role}</div>
    <div class="logo-img-box">${h.src?`<img src="${h.src}" onerror="this.style.display='none'" />`:""}</div>
    <div class="logo-name">${r(h.name)}</div>
  </div>`).join("")}</div>`})()}

<!-- HEADER -->
<div class="header avoid-break">
  <div class="header-row">
    <div class="header-info">
      <div class="header-sys">إدارة الإشراف والمتابعة</div>
      <div class="header-name">${r(e.projectName)}</div>
      <div class="header-pills">
        ${z.map(([i,v])=>`<span class="pill">${i}: ${r(v)}</span>`).join("")}
      </div>
    </div>
    <div class="header-badge">
      <div class="badge-lbl">نوع التقرير</div>
      <div class="badge-val">${s}</div>
    </div>
  </div>
</div>

<!-- INFO STRIP -->
<div class="info-strip avoid-break">
  <div class="info-cell"><div class="info-lbl">تاريخ التقرير</div><div class="info-val">${L(e.reportDate)}</div></div>
  <div class="info-cell"><div class="info-lbl">بداية الفترة</div><div class="info-val">${L(e.periodStart)}</div></div>
  <div class="info-cell"><div class="info-lbl">نهاية الفترة</div><div class="info-val">${L(e.periodEnd)}</div></div>
  <div class="info-cell"><div class="info-lbl">رقم التقرير</div><div class="info-val">#${e.reportNumber??e.reportId}</div></div>
</div>

<!-- DUAL PROGRESS -->
<div class="dual-box avoid-break">
  <div class="dual-head">
    <span class="dual-title">مقارنة الإنجاز</span>
    ${d!=null?`<span class="dev-badge ${d>=0?"dev-ok":"dev-warn"}">${d>=0?"+":""}${d}% ${d>=0?"متقدم عن الخطة":"خلف الخطة"}</span>`:""}
    ${c>0?`<span class="dev-badge dev-warn">تجاوز المدة: ${c} يوم</span>`:""}
  </div>
  <div class="dp-row">
    <span class="dp-lbl">الفعلي</span>
    <div class="dp-track"><div class="dp-fill-blue" style="width:${t}%"></div></div>
    <span class="dp-val" style="color:#2563eb">${t}%</span>
  </div>
  ${n!=null?`<div class="dp-row">
    <span class="dp-lbl">المخطط</span>
    <div class="dp-track"><div class="dp-fill-gray" style="width:${n}%"></div></div>
    <span class="dp-val">${n}%</span>
  </div>`:""}
</div>

<!-- STATS -->
<div class="stats-row avoid-break">
  ${e.contractValue?`<div class="stat">
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">💰</div>
    <div><div class="stat-lbl">قيمة العقد</div><div class="stat-val">${de(e.contractValue)} <span class="stat-unit">د.ل</span></div></div>
  </div>`:""}
  ${b!=null?`<div class="stat">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">📅</div>
    <div><div class="stat-lbl">مدة المشروع</div><div class="stat-val">${b} <span class="stat-unit">يوم</span></div></div>
  </div>`:""}
  ${u!=null?`<div class="stat">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">⏱️</div>
    <div><div class="stat-lbl">الأيام المنقضية</div><div class="stat-val">${u} <span class="stat-unit">يوم (${$??0}%)</span></div></div>
  </div>`:""}
  ${c>0?`<div class="stat">
    <div class="stat-icon" style="background:#fef2f2;color:#dc2626">⚠️</div>
    <div><div class="stat-lbl">تجاوز المدة التعاقدية</div><div class="stat-val">${c} <span class="stat-unit">يوم</span></div></div>
  </div>`:w!=null?`<div class="stat">
    <div class="stat-icon" style="background:${w<180?"#fef2f2":"#f0f9ff"};color:${w<180?"#dc2626":"#0284c7"}">⏳</div>
    <div><div class="stat-lbl">الأيام المتبقية</div><div class="stat-val">${w} <span class="stat-unit">يوم</span></div></div>
  </div>`:""}
</div>

<!-- TIMELINE -->
${e.startDate&&e.expectedEndDate?`<div class="tl-box avoid-break">
  <div class="tl-title">الجدول الزمني للمشروع</div>
  <div class="tl-dates">
    <span>بداية: <strong>${L(e.startDate)}</strong></span>
    <span>نهاية: <strong>${L(e.expectedEndDate)}</strong></span>
  </div>
  <div class="tl-track"><div class="tl-fill" style="width:${$??0}%"></div></div>
  <div class="tl-legend">
    <span>🟦 الزمن المنقضي (${$??0}%)</span>
    <span>⬜ المتبقي (${100-($??0)}%)</span>
  </div>
</div>`:""}

<!-- ACTIVITY SUMMARY -->
${a.length>0?`<div class="act-box avoid-break">
  <div class="act-title">ملخص حالة بنود الأعمال (${a.length} بند)</div>
  <div class="act-grid">
    <div class="act-item">
      <div class="act-num" style="color:#16a34a">${y}</div>
      <div class="act-dot" style="background:#16a34a"></div>
      <div class="act-lbl">مكتمل</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#2563eb">${m}</div>
      <div class="act-dot" style="background:#2563eb"></div>
      <div class="act-lbl">قيد التنفيذ</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#dc2626">${g}</div>
      <div class="act-dot" style="background:#dc2626"></div>
      <div class="act-lbl">متأخر</div>
    </div>
    <div class="act-item">
      <div class="act-num" style="color:#6b7280">${A}</div>
      <div class="act-dot" style="background:#6b7280"></div>
      <div class="act-lbl">لم يبدأ</div>
    </div>
  </div>
  <div class="act-bar">
    ${y>0?`<div class="act-seg" style="flex:${y};background:#16a34a"></div>`:""}
    ${m>0?`<div class="act-seg" style="flex:${m};background:#2563eb"></div>`:""}
    ${g>0?`<div class="act-seg" style="flex:${g};background:#dc2626"></div>`:""}
    ${A>0?`<div class="act-seg" style="flex:${A};background:#d1d5db"></div>`:""}
  </div>
</div>`:""}

<!-- ACTIVITIES TABLE -->
${j}

<!-- WORK DESCRIPTION -->
<div class="section avoid-break">
  <div class="section-title">📝 وصف الأعمال المنجزة خلال الفترة</div>
  <p class="body-text">${r(e.workDescription)}</p>
</div>

<!-- NOTES -->
${P}

<!-- RECOMMENDATIONS -->
${R}

<!-- IMAGES -->
${G}

<!-- SIGNATURES -->
${(()=>{let i=[{title:"المقاول المنفذ",name:e.contractor},{title:"الجهة المشرفة",name:e.supervisorEntity},{title:"الجهة المالكة",name:e.ownerEntity}];return e.reportSignatures&&Array.isArray(e.reportSignatures)&&(i=e.reportSignatures.map(v=>({title:v.title||v.role,name:v.name||"—"}))),i.length===0?"":`
  <div class="section avoid-break">
    <div class="section-title">التوقيعات والاعتماد</div>
    <div style="display: flex; gap: 10px; margin-top: 10px;">
      ${i.map(v=>`
        <div style="flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; height: 100px; display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${r(v.title)}</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 4px;">${r(v.name||"—")}</div>
          </div>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 4px; font-size: 10px; color: #94a3b8;">التوقيع والختم</div>
        </div>
      `).join("")}
    </div>
  </div>`})()}

<!-- FOOTER -->
<div class="footer avoid-break">
  <span></span>
  <span style="font-weight:700;color:#64748b">تقرير ${s} #${e.reportNumber??e.reportId}</span>
</div>

</body>
</html>`}function Ne(e){const s=ce(e),t=window.open("","_blank","width=900,height=780,scrollbars=yes");if(!t){alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");return}t.document.open(),t.document.write(s),t.document.close()}async function Me(e){const{default:s}=await fe(async()=>{const{default:n}=await import("./html2pdf.bundle.min-D5WWICpv.js");return{default:n}},[]),t=document.createElement("iframe");t.setAttribute("aria-hidden","true"),t.style.cssText="position:fixed;left:-10000px;top:0;width:900px;height:1000px;border:0",document.body.appendChild(t);try{const n=t.contentDocument;n.open(),n.write(ce(e)),n.close(),n.querySelector(".toolbar")?.remove(),await n.fonts.ready,await Promise.all(Array.from(n.images).map(async c=>{await c.decode()})),await new Promise((c,w)=>{const $=n.createElement("script");$.src=new URL(s,window.location.href).href,$.onload=()=>c(),$.onerror=()=>w(new Error("تعذّر تحميل أداة PDF")),n.head.appendChild($)});const d=t.contentWindow,b=await d.html2pdf().set(d.JSON.parse(JSON.stringify({filename:`report-${e.reportNumber??e.reportId}.pdf`,margin:[10,10,10,10],image:{type:"jpeg",quality:.95},html2canvas:{scale:1.5,useCORS:!0,backgroundColor:"#ffffff",windowWidth:900},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"},pagebreak:{mode:["css","legacy"],avoid:["tr",".avoid-break"]}}))).from(n.body).outputPdf("blob"),u=URL.createObjectURL(b),p=document.createElement("a");p.href=u,p.download=`report-${e.reportNumber??e.reportId}.pdf`,document.body.appendChild(p),p.click(),p.remove(),setTimeout(()=>URL.revokeObjectURL(u),6e4)}finally{t.remove()}}function H(e){if(!e)return null;const s=e instanceof Date?new Date(e):new Date(e);return Number.isNaN(s.getTime())?null:(s.setHours(0,0,0,0),s)}function J(e,s=!1,t=new Date){if(s)return 0;const n=H(e.plannedStartDate),d=H(e.plannedEndDate),b=H(e.actualEndDate),u=H(t),p=(c,w)=>Math.max(0,Math.ceil((w.getTime()-c.getTime())/864e5));return e.status==="completed"||e.actualProgress>=100?d?p(d,b??u):0:e.status==="not_started"&&e.actualProgress<=0?n?p(n,u):0:d?p(d,u):0}function se(e,s=!1,t=new Date){return J(e,s,t)>0}function q(e,s=!1){const t=J(e,s),n=Math.max(0,(e.plannedProgress??0)-(e.actualProgress??0)),d=e.status==="in_progress"?20:e.status==="not_started"?10:e.status==="completed"?5:0;return t*100+n*2+d}function ue(e){const s=o=>Math.min(100,Math.max(0,Number.isFinite(o)?o:0)),t=s(e.overallProgress),n=s(e.plannedProgress),d=t-n,b=_(e.startDate,e.expectedEndDate),u=_(e.startDate,new Date().toISOString()),p=_(new Date().toISOString(),e.expectedEndDate),c=p==null?null:Math.max(0,p),w=p!=null&&p<0&&t<100?Math.abs(p):0,$=b&&u!=null?s(u/b*100):null,a=e.activities??[],y=o=>se(o,e.noSchedule);a.filter(o=>o.status==="completed").length,a.filter(o=>o.status==="in_progress").length;const m=a.filter(y).length;a.filter(o=>o.status==="not_started").length;const g=a.length,A={active:"نشط",completed:"مكتمل",delayed:"متأخر",suspended:"معلّق",on_hold:"معلّق"}[e.status??""]??e.status??"غير محددة",z=e.status==="completed"||t>=100?"good":w>0||m>0||d<-5?"risk":"neutral",j=z==="good"?"#047857":z==="risk"?"#b91c1c":"#1d4ed8",P=z==="good"?"#ecfdf5":z==="risk"?"#fef2f2":"#eff6ff",R=o=>r(String(o??"")),k=[e.ownerEntity?["المالك",e.ownerEntity]:null,e.contractor?["المقاول",e.contractor]:null,e.supervisorEntity?["جهة الإشراف",e.supervisorEntity]:null,e.location?["الموقع",e.location]:null,e.startDate?["تاريخ البدء",L(e.startDate)]:null,e.expectedEndDate?["النهاية المعتمدة",L(e.expectedEndDate)]:null,e.contractValue!=null?["قيمة العقد",`${de(e.contractValue)} ر.س`]:null].filter(Boolean),x=[e.companyLogos?.owner,e.companyLogos?.supervisor,e.companyLogos?.contractor].filter(o=>!!o?.logoUrl),G=x.length>0?`<div class="logos-strip no-print-break">${x.map(o=>{const f=o.logoUrl.startsWith("/")&&e.apiBase?e.apiBase+o.logoUrl:o.logoUrl;return`<div class="logo-item"><img src="${B(f)}" alt="${R(o.name)}"/><span>${R(o.name)}</span></div>`}).join("")}</div>`:"",i=(o,f=4)=>(o??[]).filter(D=>typeof D=="string"&&D.trim()).slice(0,f),v=(o,f=4)=>i(o,f).map(D=>`<li>${r(D)}</li>`).join(""),S=o=>i(o).length>0,h=[...a].sort((o,f)=>{const D=q(f,e.noSchedule)-q(o,e.noSchedule);if(D!==0)return D;const M=H(o.plannedEndDate)?.getTime()??Number.MAX_SAFE_INTEGER,Y=H(f.plannedEndDate)?.getTime()??Number.MAX_SAFE_INTEGER;return M-Y}).filter(o=>{const f=y(o),D=(o.plannedProgress??0)-(o.actualProgress??0);return f||D>=5}),F=Math.max(0,g-h.length),I=h.length>0?`<div class="activity-table-wrap"><table class="activity-table">
    <thead><tr><th>#</th><th>البند ذو الأولوية</th><th>التأخير</th><th>الإنجاز فعلي/مخطط</th><th>الفارق</th><th>الحالة</th></tr></thead>
    <tbody>${h.map((o,f)=>{const D=(o.actualProgress??0)-(o.plannedProgress??0),M=y(o),Y=J(o,e.noSchedule),l=M||D<0?"#b91c1c":"#047857";return`<tr><td style="font-weight:800;color:#64748b">${f+1}</td><td>${r(o.name)}</td><td style="color:${M?"#b91c1c":"#64748b"};font-weight:800">${M?`${Y} يوم`:"فجوة أداء"}</td><td>${(o.actualProgress??0).toFixed(1)}% / ${(o.plannedProgress??0).toFixed(1)}%</td><td style="color:${l};font-weight:800">${D>0?"+":""}${D.toFixed(1)}%</td><td><span class="status-pill" style="color:${O(o.status,M)};background:${Q(o.status,M)}">${r(Z(o.status,M))}</span></td></tr>`}).join("")}</tbody>
  </table></div>`:'<div class="empty-note">لا توجد استثناءات تشغيلية تستدعي الإدراج؛ البنود المستقرة مدمجة في المؤشرات أعلاه.</div>';function Z(o,f){return f?"متأخر":{completed:"مكتمل",in_progress:"قيد التنفيذ",not_started:"لم يبدأ",suspended:"معلّق"}[o]??o}function O(o,f){return f?"#b91c1c":{completed:"#047857",in_progress:"#1d4ed8",not_started:"#64748b",suspended:"#b45309"}[o]??"#475569"}function Q(o,f){return f?"#fef2f2":{completed:"#ecfdf5",in_progress:"#eff6ff",not_started:"#f8fafc",suspended:"#fffbeb"}[o]??"#f8fafc"}const E=e.aiSummary,X=E?`<section class="decision-section avoid-break">
    <div class="section-kicker">القراءة التنفيذية</div>
    <div class="decision-head"><div><h2>${r(E.headline)}</h2><p class="source-note">تحليل مولّد من سجل المشروع ومؤشرات التقدم الحالية فقط</p></div><span class="status-badge" style="color:${j};background:${P};border-color:${j}">${r(E.status)}</span></div>
    <div class="decision-grid">
      <div class="decision-card primary"><div class="card-label">قراءة الأداء</div><p>${r(E.progressNote||"لا توجد قراءة كمية إضافية موثقة.")}</p></div>
      <div class="decision-card"><div class="card-label">القرار / المتابعة المطلوبة</div><p>${r(E.decisionNote||"لا توجد ملاحظة قرار إضافية؛ يعتمد التقييم على المؤشرات الرقمية.")}</p></div>
      <div class="decision-card schedule"><div class="card-label">المسار الزمني</div><p>${r(E.scheduleOutlook||"لا يتوفر توقع زمني موثق.")}</p></div>
    </div>
  </section>`:"",K=(o,f,D,M=4)=>S(D)?`<div class="list-card ${f} avoid-break"><div class="card-label">${o}</div><ul>${v(D,M)}</ul></div>`:"";return`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>ملخص حالة المشروع — ${r(e.projectName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Latin Digits','Noto Kufi Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;background:#e5e7eb;color:#172033;font-size:10.5px;line-height:1.75;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:11mm 12mm 10mm}.no-print{position:sticky;top:0;z-index:10;display:flex;justify-content:center;gap:8px;padding:10px;background:#172033}.no-print button{font:600 12px inherit;color:#fff;border:1px solid #334155;background:#24344d;border-radius:4px;padding:7px 16px;cursor:pointer}.no-print button:first-child{background:#1d4ed8;border-color:#1d4ed8}.brand-bar{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #1d4ed8;padding-bottom:9px;margin-bottom:9px}.brand-title{font-size:8px;letter-spacing:1.5px;color:#64748b;font-weight:800}.report-code{font-size:9px;color:#64748b}.hero{display:grid;grid-template-columns:1fr 118px;gap:14px;align-items:stretch;background:#172033;color:#fff;padding:16px 18px;border-radius:5px;margin-bottom:9px}.hero h1{font-size:20px;line-height:1.45;font-weight:800;margin-bottom:4px}.hero p{font-size:10px;color:#cbd5e1}.hero-side{border-right:1px solid #475569;padding-right:14px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:5px}.hero-side .label{font-size:8px;color:#94a3b8}.hero-side .status{font-size:13px;font-weight:800;border:1px solid #93c5fd;padding:4px 11px;border-radius:4px;color:#dbeafe;background:#263a5e}.logos-strip{display:flex;justify-content:center;gap:22px;align-items:center;margin-bottom:8px}.logo-item{display:flex;align-items:center;gap:5px;color:#64748b;font-size:8px}.logo-item img{max-width:55px;max-height:28px;object-fit:contain}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:9px}.meta-item{border:1px solid #dbe2ea;padding:5px 7px;border-radius:3px;min-width:0}.meta-item .key{display:block;font-size:7.5px;color:#64748b;margin-bottom:1px}.meta-item .value{display:block;font-size:9px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.section{margin-top:9px}.section-title{font-size:11px;font-weight:800;color:#172033;border-right:3px solid #1d4ed8;padding-right:7px;margin-bottom:6px}.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.kpi{border:1px solid #dbe2ea;border-top:3px solid #1d4ed8;border-radius:3px;padding:7px 6px;text-align:center;min-height:58px}.kpi.good{border-top-color:#059669}.kpi.risk{border-top-color:#dc2626}.kpi .value{font-size:18px;font-weight:800;line-height:1.25;color:#172033}.kpi .label{font-size:7.5px;color:#64748b;line-height:1.45;margin-top:2px}.meter{height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;margin-top:5px}.meter span{height:100%;display:block}.progress-compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}.compare-row{display:flex;align-items:center;gap:6px;font-size:8px;color:#475569}.compare-row b{width:42px;color:#172033}.compare-line{height:6px;flex:1;background:#e5e7eb;overflow:hidden;border-radius:2px}.compare-line span{height:100%;display:block}.decision-section{margin-top:10px;border:1px solid #cbd5e1;border-radius:4px;padding:10px;background:#f8fafc}.section-kicker{font-size:8px;color:#1d4ed8;font-weight:800;letter-spacing:.5px;margin-bottom:3px}.decision-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid #dbe2ea;padding-bottom:7px}.decision-head h2{font-size:13px;line-height:1.65;color:#172033}.source-note{font-size:7.5px;color:#64748b;margin-top:2px}.status-badge{font-size:9px;font-weight:800;border:1px solid;padding:3px 8px;border-radius:3px;white-space:nowrap}.decision-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:6px;margin-top:7px}.decision-card{background:#fff;border:1px solid #dbe2ea;border-right:3px solid #64748b;padding:7px 8px;border-radius:3px;min-height:76px}.decision-card.primary{border-right-color:#1d4ed8}.decision-card.schedule{border-right-color:#047857}.card-label{font-size:8.5px;font-weight:800;color:#334155;margin-bottom:3px}.decision-card p{font-size:8.5px;line-height:1.8;color:#475569}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.list-card{background:#fff;border:1px solid #dbe2ea;border-top:3px solid #64748b;border-radius:3px;padding:7px 8px}.list-card ul{padding:0 15px 0 0;margin:0;color:#475569;font-size:8.5px;line-height:1.75}.list-card li{margin:1px 0}.list-card.risk{border-top-color:#dc2626}.list-card.action{border-top-color:#1d4ed8}.list-card.success{border-top-color:#059669}.list-card.focus{border-top-color:#7c3aed}.activities-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:6px}.activity-count{border:1px solid #dbe2ea;border-radius:3px;padding:5px;text-align:center}.activity-count b{display:block;font-size:15px;line-height:1.2}.activity-count span{font-size:7.5px;color:#64748b}.activity-table-wrap{border:1px solid #dbe2ea;border-radius:3px;overflow:visible}.activity-table{width:100%;border-collapse:collapse;font-size:8px;break-inside:auto;page-break-inside:auto}.activity-table th{background:#172033;color:#fff;padding:5px 6px;text-align:right;font-weight:700}.activity-table td{padding:5px 6px;border-bottom:1px solid #e5e7eb;vertical-align:middle}.activity-table tr:nth-child(even){background:#f8fafc}.activity-table td:not(:first-child),.activity-table th:not(:first-child){text-align:center}.activity-table td:first-child{font-weight:600;max-width:245px}.status-pill{display:inline-block;border-radius:3px;padding:1px 5px;font-size:7px;font-weight:700;white-space:nowrap}.empty-note{border:1px dashed #cbd5e1;padding:10px;text-align:center;color:#64748b;font-size:9px}.coverage{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #dbe2ea;margin-top:8px;padding-top:5px;color:#64748b;font-size:7.5px}.footer{border-top:1px solid #cbd5e1;margin-top:9px;padding-top:5px;display:flex;justify-content:space-between;color:#64748b;font-size:7px}@media print{body{background:#fff}.page{margin:0;width:auto;min-height:0;padding:0}.no-print{display:none!important}.avoid-break{break-inside:avoid;page-break-inside:avoid}.activity-table-wrap{break-inside:auto;page-break-inside:auto}.activity-table thead{display:table-header-group}.activity-table tr{break-inside:avoid;page-break-inside:avoid}}@media(max-width:800px){body{background:#fff}.page{width:100%;padding:16px}.meta-grid{grid-template-columns:repeat(2,1fr)}.kpi-grid{grid-template-columns:repeat(2,1fr)}.decision-grid,.two-col{grid-template-columns:1fr}.hero{grid-template-columns:1fr}.hero-side{border-right:0;border-top:1px solid #475569;padding:7px 0 0;align-items:flex-start}.activities-summary{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="no-print"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>
<main class="page">
  <div class="brand-bar"><span class="brand-title">CONSTRUCTION SUPERVISION · PROJECT STATUS REPORT</span><span class="report-code">تقرير حالة تنفيذي · ${L(new Date().toISOString())}</span></div>
  ${G}
  <section class="hero"><div><h1>${r(e.projectName)}</h1><p>${r(e.location??"الموقع غير مسجل")} · ملخص تنفيذي مبني على السجل التشغيلي الحالي</p></div><div class="hero-side"><span class="label">الحالة الحالية</span><span class="status">${r(A)}</span></div></section>
  ${k.length>0?`<section class="meta-grid">${k.map(([o,f])=>`<div class="meta-item"><span class="key">${r(o)}</span><span class="value">${r(f)}</span></div>`).join("")}</section>`:""}

  <section class="section avoid-break"><div class="section-title">لوحة المؤشرات الأساسية</div><div class="kpi-grid">
    <div class="kpi good"><div class="value">${t.toFixed(1)}%</div><div class="label">الإنجاز الفعلي</div><div class="meter"><span style="width:${t}%;background:#059669"></span></div></div>
    <div class="kpi"><div class="value">${n.toFixed(1)}%</div><div class="label">الإنجاز المخطط</div><div class="meter"><span style="width:${n}%;background:#2563eb"></span></div></div>
    <div class="kpi ${d<0?"risk":"good"}"><div class="value" style="color:${d<0?"#b91c1c":"#047857"}">${d>0?"+":""}${d.toFixed(1)}%</div><div class="label">الانحراف عن الخطة</div></div>
    <div class="kpi ${m>0?"risk":"good"}"><div class="value" style="color:${m>0?"#b91c1c":"#047857"}">${m}</div><div class="label">بنود متأخرة فعلياً</div></div>
    <div class="kpi ${w>0?"risk":""}"><div class="value" style="color:${w>0?"#b91c1c":"#172033"}">${w>0?w:c??"—"}</div><div class="label">${w>0?"تجاوز النهاية بالأيام":"أيام متبقية"}</div></div>
  </div><div class="progress-compare"><div class="compare-row"><b>فعلي</b><div class="compare-line"><span style="width:${t}%;background:#059669"></span></div><strong>${t.toFixed(1)}%</strong></div><div class="compare-row"><b>مخطط</b><div class="compare-line"><span style="width:${n}%;background:#2563eb"></span></div><strong>${n.toFixed(1)}%</strong></div></div></section>

  ${X}

  <section class="section avoid-break"><div class="section-title">المدة والضبط الزمني</div><div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi"><div class="value">${b??"—"}</div><div class="label">إجمالي المدة بالأيام</div></div>
    <div class="kpi"><div class="value">${u!=null?Math.max(0,u):"—"}</div><div class="label">الأيام المنقضية</div></div>
    <div class="kpi"><div class="value">${e.suspensionDays??0}</div><div class="label">توقفات مسجلة بالأيام</div></div>
    <div class="kpi"><div class="value">${e.extensionDays??0}</div><div class="label">تمديدات مسجلة بالأيام</div></div>
  </div>${$!=null?`<div class="compare-row" style="margin-top:6px"><b>استهلاك الزمن</b><div class="compare-line"><span style="width:${$}%;background:#475569"></span></div><strong>${$.toFixed(0)}%</strong></div>`:""}</section>

  ${S(E?.highlights)||S(E?.risks)||S(E?.nextActions)||S(E?.managementFocus)?`<section class="two-col">${K("إشارات إيجابية موثقة","success",E?.highlights)}${K("المخاطر والقيود الموثقة","risk",E?.risks)}${K("الإجراءات المطلوبة","action",E?.nextActions)}${K("محاور المتابعة","focus",E?.managementFocus,3)}</section>`:""}

  <section class="section"><div class="section-title avoid-break">الاستثناءات التشغيلية وأولوية المتابعة</div><div class="activities-summary avoid-break"><div class="activity-count"><b style="color:#b91c1c">${m}</b><span>متأخر فعلياً</span></div><div class="activity-count"><b style="color:#b45309">${Math.max(0,h.length-m)}</b><span>فجوة أداء</span></div><div class="activity-count"><b style="color:#047857">${F}</b><span>مستقر ومدمج</span></div><div class="activity-count"><b style="color:#64748b">${g}</b><span>إجمالي البنود</span></div></div>${I}<div class="coverage avoid-break"><span>إجمالي البنود المسجلة: ${g}</span><span>المعروض تفصيلياً: ${h.length} استثناء؛ البنود المستقرة مدمجة في الرقم الإجمالي</span></div></section>

  <footer class="footer"><span>هذا الملخص يعرض البيانات المسجلة في النظام دون إضافة معلومات غير موثقة.</span><span>التقارير المسجلة: ${e.reportsCount}</span></footer>
</main></body></html>`}function je(e){const s=ue(e),t=window.open("","_blank","width=900,height=780,scrollbars=yes");if(!t){alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");return}t.document.open(),t.document.write(s),t.document.close()}function me(e){const s=l=>Math.min(100,Math.max(0,Number.isFinite(l)?l:0)),t=s(e.overallProgress),n=s(e.plannedProgress),d=t-n,b=e.activities??[],u=l=>se(l,e.noSchedule),p=b.filter(l=>l.status==="completed").length;b.filter(l=>l.status==="in_progress").length;const c=b.filter(u).length;b.filter(l=>l.status==="not_started").length;const w=b.length,$=_(e.startDate,e.expectedEndDate),a=_(e.startDate,new Date().toISOString()),y=_(new Date().toISOString(),e.expectedEndDate),m=y==null?null:Math.max(0,y),g=y!=null&&y<0&&t<100?Math.abs(y):0,A=$&&a!=null?s(a/$*100):null,z={active:"نشط",completed:"مكتمل",delayed:"متأخر",suspended:"متوقف",on_hold:"متوقف"}[e.status??""]??"غير محددة",j=e.status==="completed"||t>=100?"good":g>0||c>0||d<-5?"risk":"neutral",P=j==="good"?"مستقر":j==="risk"?"يتطلب تدخلاً":"تحت المتابعة",R=j==="good"?"#047857":j==="risk"?"#be123c":"#1d4ed8",k=e.aiSummary??null,x=l=>r(String(l??"")),G=(l,T)=>Array.isArray(l)?l.filter(U=>typeof U=="string"&&U.trim().length>0).slice(0,T):[],i=(l,T="لا توجد بيانات موثقة لهذا القسم.")=>{const U=G(l,4);return U.length?`<ul>${U.map(W=>`<li>${x(W)}</li>`).join("")}</ul>`:`<p class="muted">${T}</p>`},v=(l,T)=>`<div class="bar"><span style="width:${s(l)}%;background:${T}"></span></div>`,S=l=>se(l,e.noSchedule),N=[...b].sort((l,T)=>{const U=q(T,e.noSchedule)-q(l,e.noSchedule);if(U!==0)return U;const W=H(l.plannedEndDate)?.getTime()??Number.MAX_SAFE_INTEGER,ee=H(T.plannedEndDate)?.getTime()??Number.MAX_SAFE_INTEGER;return W-ee}).filter(l=>S(l)||(l.plannedProgress??0)-(l.actualProgress??0)>=5),h=8,F=[];for(let l=0;l<N.length;l+=h)F.push(N.slice(l,l+h));F.length===0&&F.push([]);const I=F.length,Z=Math.max(0,w-N.length),O=5+I,Q=F.map((l,T)=>{const U=l.length?l.map((C,pe)=>{const ge=T*h+pe+1,te=(C.actualProgress??0)-(C.plannedProgress??0),ie=S(C),ve=J(C,e.noSchedule),re=ie||te<0?"risk":"neutral";return`<tr><td><b>${ge}</b></td><td>${x(C.name)}</td><td>${ie?`${ve} يوم`:"فجوة أداء"}</td><td>${(C.actualProgress??0).toFixed(1)}% / ${(C.plannedProgress??0).toFixed(1)}%</td><td class="${re}">${te>0?"+":""}${te.toFixed(1)}%</td><td class="${re}">${x(he(C.status,ie))}</td></tr>`}).join(""):'<tr><td colspan="6" class="muted center">لا توجد استثناءات تشغيلية تستدعي الإدراج؛ البنود المستقرة مدمجة في المؤشرات.</td></tr>',W=I>1?` · صفحة ${T+1} من ${I}`:"",ee=T===0?"الاستثناءات التشغيلية وأولوية المتابعة":"استكمال الاستثناءات ذات الأثر",V=N.length;return`<section class="slide"><div class="slide-head"><div><div class="section-label">02 · جدول الاستثناءات${W}</div><h2>${ee}</h2><p>لا تظهر البنود المستقرة تفصيلياً؛ الترتيب يبدأ بالتأخير الأعلى ثم فجوة الإنجاز.</p></div><div class="kicker">الاستثناءات ${V?T*h+1:0}–${Math.min((T+1)*h,V)} من ${V}</div></div><div class="slide-inner"><div class="grid-4"><div class="panel metric"><div class="value risk">${c}</div><div class="label">متأخر فعلياً</div></div><div class="panel metric"><div class="value neutral">${Math.max(0,V-c)}</div><div class="label">فجوة أداء</div></div><div class="panel metric"><div class="value good">${Z}</div><div class="label">مستقر ومدمج</div></div><div class="panel metric"><div class="value muted">${w}</div><div class="label">إجمالي البنود</div></div></div><div class="table-wrap"><table><thead><tr><th>#</th><th>البند ذو الأولوية</th><th>التأخير</th><th>فعلي / مخطط</th><th>الفارق</th><th>الحالة</th></tr></thead><tbody>${U}</tbody></table></div><div class="callout ${c>0||V>0?"risk-callout":"good-callout"}">${c>0?`تم إدراج جميع البنود المتأخرة (${c})، مع ترتيبها حسب أيام التأخير والفجوة المسجلة.`:V>0?`توجد ${V} استثناءات أداء تحتاج متابعة؛ لا توجد بنود متأخرة زمنياً.`:"لا توجد استثناءات تشغيلية؛ البنود المستقرة مدمجة في المؤشرات."}</div></div><div class="footer"><span>الأولوية مبنية على التواريخ، أيام التأخير، وفجوة الفعلي عن المخطط</span><span>${String(3+T).padStart(2,"0")} / ${String(O).padStart(2,"0")}</span></div></section>`}).join(`
`),E=[e.ownerEntity?["المالك",e.ownerEntity]:null,e.contractor?["المقاول",e.contractor]:null,e.supervisorEntity?["الإشراف",e.supervisorEntity]:null,e.location?["الموقع",e.location]:null].filter(Boolean),X=E.length?E.map(([l,T])=>`<div><span>${x(l)}</span><b>${x(T)}</b></div>`).join(""):'<p class="muted">لا توجد بيانات تعريفية إضافية مسجلة.</p>',K=k?.headline?.trim()||"لا توجد قراءة تحليلية مولدة؛ يعتمد التقييم على المؤشرات الرقمية الموثقة.",o=k?.status?.trim()||P,f=k?.decisionNote?.trim()||"لا توجد ملاحظة قرار إضافية موثقة.",D=k?.scheduleOutlook?.trim()||(m==null?"لا يتوفر توقع زمني مسجل.":g>0?`يوجد تجاوز زمني مسجل قدره ${g} يوم.`:`المتبقي وفق التاريخ المتوقع ${m} يوم.`),M=x(e.projectName),Y=new Date().toLocaleDateString("ar-SA-u-nu-latn",{year:"numeric",month:"2-digit",day:"2-digit"});return`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>العرض التنفيذي — ${M}</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700;800&display=swap');@font-face{font-family:'Latin Digits';src:local('Arial'),local('Helvetica Neue'),local('sans-serif');unicode-range:U+0030-0039,U+002E,U+002C,U+0025,U+002B,U+002D}:root{--navy:#102a43;--blue:#1d4ed8;--ink:#16202a;--muted:#64748b;--line:#d9e2ec;--paper:#fff;--soft:#f6f8fb;--risk:#be123c;--good:#047857}
  *{box-sizing:border-box}body{margin:0;background:#e2e8f0;color:var(--ink);font-family:'Latin Digits','Noto Kufi Arabic','Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:4;display:flex;justify-content:center;gap:10px;padding:12px;background:#102a43;color:#fff}.toolbar button{border:1px solid #486581;background:#1f466b;color:#fff;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer}.toolbar button:hover{background:#2f5f8c}.deck{display:grid;gap:20px;padding:24px}.slide{width:min(1280px,calc(100vw - 48px));aspect-ratio:16/9;min-height:540px;margin:0 auto;background:var(--paper);border:1px solid #cbd5e1;box-shadow:0 16px 36px rgba(15,23,42,.12);position:relative;display:flex;flex-direction:column;page-break-after:always}.slide.dark{background:var(--navy);color:#fff}.slide-inner{padding:42px 56px;flex:1;display:flex;flex-direction:column;gap:24px}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc;font-weight:700}.dark .eyebrow{color:#93c5fd}.title{font-size:clamp(28px,4vw,52px);line-height:1.15;margin:0;font-weight:800;max-width:900px}.subtitle{font-size:clamp(16px,1.7vw,23px);line-height:1.7;color:#cbd5e1;max-width:820px}.slide:not(.dark) .subtitle{color:var(--muted)}.slide-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:1px solid var(--line);padding:32px 56px 18px}.slide-head h2{font-size:clamp(22px,2.5vw,34px);margin:0 0 5px;font-weight:800}.slide-head p{margin:0;color:var(--muted);font-size:14px}.section-label{font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--blue);text-transform:uppercase}.status{display:inline-flex;align-items:center;gap:8px;border:1px solid currentColor;color:${R};padding:7px 12px;font-size:14px;font-weight:800;white-space:nowrap}.status i{width:8px;height:8px;background:currentColor;display:inline-block;border-radius:50%}.grid-2{display:grid;grid-template-columns:1.15fr .85fr;gap:28px;min-height:0}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.panel{border:1px solid var(--line);padding:18px;background:#fff;min-width:0}.soft-panel{background:var(--soft);border:1px solid var(--line);padding:18px}.metric .value{font-size:34px;font-weight:800;line-height:1.1}.metric .label{font-size:12px;color:var(--muted);margin-top:6px}.metric .note{font-size:12px;color:var(--muted);margin-top:8px}.bar{height:10px;background:#e2e8f0;overflow:hidden}.bar span{display:block;height:100%}.compare{display:grid;grid-template-columns:100px 1fr 80px;align-items:center;gap:10px;font-size:13px}.compare+.compare{margin-top:14px}.compare strong{font-size:13px;text-align:left}.meta{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--line);border-right:1px solid var(--line)}.meta div{padding:12px;border-left:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:3px}.meta span{font-size:11px;color:var(--muted)}.meta b{font-size:14px}.kicker{font-size:12px;color:var(--muted);font-weight:700}.big-number{font-size:74px;line-height:1;font-weight:800;color:var(--blue)}.statement{font-size:22px;line-height:1.65;font-weight:700;margin:0}.muted{color:var(--muted)}.risk{color:var(--risk)}.good{color:var(--good)}.neutral{color:var(--blue)}.center{text-align:center}ul{margin:0;padding-right:20px;line-height:2;font-size:15px}li::marker{color:var(--blue)}.table-wrap{border:1px solid var(--line);overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th{background:var(--navy);color:#fff;text-align:right;padding:10px 12px;font-weight:700;white-space:nowrap}td{border-bottom:1px solid var(--line);padding:10px 12px;vertical-align:middle}tr:last-child td{border-bottom:0}.callout{border-right:4px solid var(--blue);background:#eff6ff;padding:16px 18px;line-height:1.8}.callout.risk-callout{border-color:var(--risk);background:#fff1f2}.callout.good-callout{border-color:var(--good);background:#ecfdf5}.footer{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding:12px 56px;display:flex;justify-content:space-between;gap:12px}.dark .footer{border-color:#486581;color:#bcccdc}.dark .meta{border-color:#486581}.dark .meta div{border-color:#486581}.dark .meta span{color:#bcccdc}.dark .meta b{color:#fff}.source{font-size:11px;color:var(--muted);margin-top:auto}.dark .source{color:#bcccdc}@media(max-width:800px){.deck{padding:10px}.slide{width:100%;aspect-ratio:auto;min-height:680px}.slide-inner,.slide-head{padding:28px 24px}.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.meta{grid-template-columns:1fr}.footer{padding:12px 24px;flex-direction:column}.title{font-size:34px}.big-number{font-size:56px}}@media print{body{background:#fff}.toolbar{display:none}.deck{padding:0;display:block}.slide{width:297mm;height:210mm;min-height:0;aspect-ratio:auto;border:0;box-shadow:none;margin:0;page-break-after:always}.slide:last-child{page-break-after:auto}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div><main class="deck">
  <section class="slide dark"><div class="slide-inner"><div class="eyebrow">تقرير حالة المشروع · عرض تنفيذي</div><h1 class="title">${M}</h1><p class="subtitle">قراءة مركزة لحالة التنفيذ، مؤشرات الجدول الزمني، البنود ذات الأولوية، والمطلوب متابعته بناءً على السجلات الحالية في النظام.</p><div class="grid-2" style="margin-top:auto;align-items:end"><div class="meta">${X}</div><div><div class="kicker">الحالة المسجلة</div><div style="font-size:30px;font-weight:800;margin-top:8px">${x(z)}</div><div style="color:#bcccdc;margin-top:6px">${x(o)}</div></div></div><div class="source">تاريخ إنشاء العرض: ${Y} · البيانات المعروضة من سجلات المشروع الحالية فقط</div></div><div class="footer"><span>ملخص حالة المشروع</span><span>01 / ${String(O).padStart(2,"0")}</span></div></section>
  <section class="slide"><div class="slide-head"><div><div class="section-label">01 · لوحة المؤشرات</div><h2>الوضع التنفيذي في لقطة واحدة</h2><p>مقارنة الإنجاز الفعلي بالمخطط، مع قراءة زمنية مباشرة.</p></div><div class="status"><i></i>${x(P)}</div></div><div class="slide-inner"><div class="grid-4"><div class="panel metric"><div class="value">${t.toFixed(1)}%</div><div class="label">الإنجاز الفعلي</div><div class="note">${t>=100?"اكتمل التنفيذ المسجل":"آخر نسبة إنجاز مسجلة"}</div></div><div class="panel metric"><div class="value">${n.toFixed(1)}%</div><div class="label">الإنجاز المخطط</div><div class="note">${d>=0?"متقدم عن الخطة":"أقل من الخطة"}</div></div><div class="panel metric"><div class="value ${d<0?"risk":"good"}">${d>0?"+":""}${d.toFixed(1)}%</div><div class="label">الانحراف عن الخطة</div><div class="note">فرق الفعلي عن المخطط</div></div><div class="panel metric"><div class="value ${g>0?"risk":"neutral"}">${m??"—"}</div><div class="label">الأيام المتبقية</div><div class="note">${g>0?`تجاوز ${g} يوم`:"وفق التاريخ المتوقع"}</div></div></div><div class="panel"><div class="kicker">مقارنة الإنجاز</div><div class="compare" style="margin-top:18px"><span>فعلي</span>${v(t,"#1d4ed8")}<strong>${t.toFixed(1)}%</strong></div><div class="compare"><span>مخطط</span>${v(n,"#94a3b8")}<strong>${n.toFixed(1)}%</strong></div>${A==null?"":`<div class="compare"><span>استهلاك الزمن</span>${v(A,"#475569")}<strong>${A.toFixed(0)}%</strong></div>`}</div><div class="grid-3"><div class="soft-panel"><div class="kicker">التقارير</div><div class="metric"><div class="value">${e.reportsCount}</div><div class="label">تقارير مسجلة</div></div></div><div class="soft-panel"><div class="kicker">التوقفات</div><div class="metric"><div class="value">${e.suspensionDays??0}</div><div class="label">يوم مسجل</div></div></div><div class="soft-panel"><div class="kicker">التمديدات</div><div class="metric"><div class="value">${e.extensionDays??0}</div><div class="label">يوم مضاف</div></div></div></div></div><div class="footer"><span>المؤشرات الرقمية الموثقة</span><span>02 / ${String(O).padStart(2,"0")}</span></div></section>
  ${Q}
  <section class="slide"><div class="slide-head"><div><div class="section-label">03 · قراءة تنفيذية</div><h2>الاستنتاج التنفيذي</h2><p>صياغة الذكاء الاصطناعي مقيدة بالبيانات المرسلة من النظام.</p></div><div class="status"><i></i>${x(o)}</div></div><div class="slide-inner"><div class="callout"><p class="kicker">الخلاصة</p><p class="statement">${x(K)}</p></div><div class="grid-2"><div class="panel"><div class="section-label">قراءة التقدم</div><p style="line-height:1.9;margin:12px 0 0">${x(k?.progressNote||`الإنجاز الفعلي ${t.toFixed(1)}% مقابل مخطط ${n.toFixed(1)}%، بفارق ${d>0?"+":""}${d.toFixed(1)} نقطة مئوية.`)}</p></div><div class="panel"><div class="section-label">الرؤية الزمنية</div><p style="line-height:1.9;margin:12px 0 0">${x(D)}</p></div></div><div class="panel"><div class="section-label">ملاحظة القرار</div><p style="line-height:1.9;margin:12px 0 0">${x(f)}</p></div><div class="source">لا تُعد العبارات التحليلية بديلاً عن مراجعة السجلات والمستندات الأصلية.</div></div><div class="footer"><span>التحليل التنفيذي</span><span>${String(3+I).padStart(2,"0")} / ${String(O).padStart(2,"0")}</span></div></section>
  <section class="slide"><div class="slide-head"><div><div class="section-label">04 · المخاطر والإجراءات</div><h2>ما يحتاج إلى متابعة مباشرة</h2><p>قائمة مختصرة قابلة للتحويل إلى اجتماع متابعة أو محضر قرار.</p></div><div class="status"><i></i>${x(P)}</div></div><div class="slide-inner"><div class="grid-2"><div class="panel"><div class="section-label risk">المخاطر والقيود</div>${i(k?.risks,c>0?`تأخير مسجل في ${c} بند؛ يلزم الرجوع إلى تفاصيل البنود.`:"لا توجد مخاطر إضافية موثقة في الملخص الحالي.")}</div><div class="panel"><div class="section-label neutral">الإجراءات التالية</div>${i(k?.nextActions,"لا توجد إجراءات إضافية مولدة؛ راجع البنود ذات الأولوية.")}</div></div><div class="grid-2"><div class="panel"><div class="section-label good">الإشارات الإيجابية</div>${i(k?.highlights,p>0?`تم تسجيل ${p} بند مكتمل.`:"لا توجد إشارات إيجابية إضافية موثقة.")}</div><div class="panel"><div class="section-label">محاور المتابعة</div>${i(k?.managementFocus,"لا توجد محاور متابعة إضافية موثقة.")}</div></div><div class="callout ${g>0||c>0?"risk-callout":"good-callout"}">${g>0?`المؤشر الزمني الأبرز: تجاوز مسجل قدره ${g} يوم.`:c>0?`المؤشر التشغيلي الأبرز: ${c} بنود متأخرة.`:"لا يظهر في البيانات الحالية مؤشر تأخير صريح."}</div></div><div class="footer"><span>إجراءات مبنية على المؤشرات المتاحة</span><span>${String(4+I).padStart(2,"0")} / ${String(O).padStart(2,"0")}</span></div></section>
  <section class="slide dark"><div class="slide-head" style="border-color:#486581"><div><div class="eyebrow">05 · موجز القرار</div><h2>ملخص قابل للعرض على الإدارة</h2><p style="color:#bcccdc">المؤشرات الأساسية في صفحة واحدة، دون بيانات غير مسجلة.</p></div></div><div class="slide-inner"><div class="grid-2"><div><div class="big-number" style="color:#7dd3fc">${t.toFixed(1)}%</div><div style="font-size:20px;font-weight:700;margin-top:10px">الإنجاز الفعلي</div><p class="subtitle" style="font-size:16px;margin-top:16px">${x(k?.decisionNote||`الفارق عن الخطة ${d>0?"+":""}${d.toFixed(1)} نقطة مئوية.`)}</p></div><div class="meta">${X}</div></div><div class="grid-3" style="margin-top:auto"><div><div class="kicker" style="color:#bcccdc">بنود متأخرة</div><div style="font-size:28px;font-weight:800;color:${c>0?"#fda4af":"#86efac"};margin-top:6px">${c}</div></div><div><div class="kicker" style="color:#bcccdc">صافي المؤشر الزمني</div><div style="font-size:28px;font-weight:800;color:${g>0?"#fda4af":"#86efac"};margin-top:6px">${g>0?`+${g}`:"0"} يوم</div></div><div><div class="kicker" style="color:#bcccdc">التقارير المسجلة</div><div style="font-size:28px;font-weight:800;color:#fff;margin-top:6px">${e.reportsCount}</div></div></div><div class="source">إعداد العرض: ${Y} · للمراجعة التنفيذية والرجوع إلى تفاصيل المشروع الأصلية</div></div><div class="footer"><span>نهاية العرض</span><span>${String(5+I).padStart(2,"0")} / ${String(O).padStart(2,"0")}</span></div></section>
  </main></body></html>`}function he(e,s){return s?"متأخر":{completed:"مكتمل",in_progress:"قيد التنفيذ",not_started:"لم يبدأ"}[e]??e}function Fe(e){const s=me(e),t=window.open("","_blank","width=1280,height=820,scrollbars=yes");if(!t){alert("يرجى السماح بالنوافذ المنبثقة لاستخدام العرض التقديمي");return}t.document.open(),t.document.write(s),t.document.close()}const ye={admin:"مدير النظام",project_manager:"مدير المشروع",engineer:"مهندس",contractor:"مقاول",owner:"صاحب المشروع"};function ne(e){if(!e)return"—";const s=new Date(e);return isNaN(s.getTime())?"—":new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Tripoli",hour:"2-digit",minute:"2-digit",hour12:!1}).format(s)}function ae(e){if(e==null||!isFinite(e))return"—";const s=Math.max(0,Math.round(e)),t=Math.floor(s/60),n=s%60;return`${String(t).padStart(2,"0")}:${String(n).padStart(2,"0")}`}function le(e){return e==null||!isFinite(e)?"—":`${ae(e)} <span class="stat-unit">س:د</span>`}function we(e){const s=e.employeeRole?ye[e.employeeRole]??e.employeeRole:"",t=e.summary,n=t.totalMinutes,d=t.workDays,b=t.incompleteDays,u=t.longDays,p=t.averageDailyMinutes,c=[e.ownerEntity?["جهة المالك",e.ownerEntity]:null,e.contractor?["المقاول",e.contractor]:null,e.supervisorEntity?["جهة الإشراف",e.supervisorEntity]:null,e.location?["الموقع",e.location]:null].filter(Boolean),w=(()=>{const a=e.companyLogos,y=e.apiBase||"";if(!a||!a.owner?.logoUrl&&!a.contractor?.logoUrl&&!a.supervisor?.logoUrl)return"";const m=[];return a.owner&&m.push({role:"جهة المالك",name:a.owner.name,src:a.owner.logoUrl?B(y+a.owner.logoUrl):""}),a.contractor&&m.push({role:"المقاول",name:a.contractor.name,src:a.contractor.logoUrl?B(y+a.contractor.logoUrl):""}),a.supervisor&&m.push({role:"جهة الإشراف",name:a.supervisor.name,src:a.supervisor.logoUrl?B(y+a.supervisor.logoUrl):""}),`<div class="logos-strip avoid-break">${m.map(A=>`<div class="logo-item">
      <div class="logo-role">${A.role}</div>
      <div class="logo-img-box">${A.src?`<img src="${A.src}" onerror="this.style.display='none'" />`:""}</div>
      <div class="logo-name">${r(A.name)}</div>
    </div>`).join("")}</div>`})(),$=e.days.length===0?'<tr><td class="td tc" colspan="7" style="color:#94a3b8;padding:24px 10px">لا توجد سجلات لهذه الفترة.</td></tr>':e.days.flatMap((a,y)=>{const m=y%2===0?"#fff":"#f8fafc",g=a.sessions.length===0?[null]:a.sessions,A=`
          ${a.flags.incomplete?'<span class="badge badge-red">غير مكتمل</span>':""}
          ${a.flags.longDay?'<span class="badge badge-amber">يوم طويل</span>':""}
          ${a.sessions.some(z=>z?.status==="auto_closed")?'<span class="badge badge-slate">إغلاق تلقائي</span>':""}
        `.trim();return g.map((z,j)=>{const P=j===0,R=g.length;let k="";return z?.status==="auto_closed"?k='<span class="badge badge-amber">إغلاق تلقائي</span>':z?.status==="open"&&(k='<span class="badge badge-red">مفتوحة</span>'),`<tr style="background:${m}">
            ${P?`<td class="td tc" rowspan="${R}" style="font-weight:700;vertical-align:middle">${r(L(a.date))}</td>`:""}
            <td class="td tc">${z?`#${j+1}`:"—"}</td>
            <td class="td tc">${r(ne(z?.checkInAt??null))}</td>
            <td class="td tc">${r(ne(z?.checkOutAt??null))} ${k}</td>
            <td class="td tc">${z?r(ae(z.durationMinutes)):"—"}</td>
            ${P?`<td class="td tc" rowspan="${R}" style="font-weight:700;vertical-align:middle">${r(ae(a.totalMinutes))}</td>`:""}
            ${P?`<td class="td tc" rowspan="${R}" style="vertical-align:middle">${A||"—"}</td>`:""}
          </tr>`})}).join("");return`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>تقرير حضور — ${r(e.employeeName)}</title>
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

${w}

<!-- HEADER -->
<div class="header avoid-break">
  <div class="header-row">
    <div class="header-info">
      <div class="header-sys">إدارة الإشراف والمتابعة</div>
      <div class="header-name">${r(e.projectName)}</div>
      <div class="header-pills">
        ${c.map(([a,y])=>`<span class="pill">${a}: ${r(y)}</span>`).join("")}
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
  <div class="info-cell"><div class="info-lbl">الموظف</div><div class="info-val">${r(e.employeeName)}</div></div>
  ${s?`<div class="info-cell"><div class="info-lbl">الدور</div><div class="info-val">${r(s)}</div></div>`:""}
  <div class="info-cell"><div class="info-lbl">من تاريخ</div><div class="info-val">${r(L(e.dateFrom))}</div></div>
  <div class="info-cell"><div class="info-lbl">إلى تاريخ</div><div class="info-val">${r(L(e.dateTo))}</div></div>
</div>

<!-- STATS -->
<div class="stats-row avoid-break">
  <div class="stat">
    <div class="stat-icon" style="background:#fefce8;color:#ca8a04">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    </div>
    <div><div class="stat-lbl">إجمالي الساعات</div><div class="stat-val">${le(n)}</div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#eff6ff;color:#2563eb">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
    </div>
    <div><div class="stat-lbl">عدد أيام العمل</div><div class="stat-val">${d} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:#f0fdf4;color:#16a34a">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 8"/></svg>
    </div>
    <div><div class="stat-lbl">متوسط اليوم</div><div class="stat-val">${le(p)}</div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:${b>0?"#fef2f2":"#f8fafc"};color:${b>0?"#dc2626":"#94a3b8"}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </div>
    <div><div class="stat-lbl">أيام غير مكتملة</div><div class="stat-val">${b} <span class="stat-unit">يوم</span></div></div>
  </div>
  <div class="stat">
    <div class="stat-icon" style="background:${u>0?"#fffbeb":"#f8fafc"};color:${u>0?"#b45309":"#94a3b8"}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/></svg>
    </div>
    <div><div class="stat-lbl">أيام طويلة (≥ ${e.longDayHours} س)</div><div class="stat-val">${u} <span class="stat-unit">يوم</span></div></div>
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
        ${$}
      </tbody>
    </table>
  </div>
</div>

<!-- FOOTER -->
<div class="footer avoid-break">
  <span></span>
  <span style="font-weight:700;color:#64748b">الملف التعريفي — ${r(e.projectName)}</span>
</div>

</body>
</html>`}function Pe(e){const s=we(e),t=window.open("","_blank","width=900,height=780,scrollbars=yes");if(!t){alert("يرجى السماح بالنوافذ المنبثقة لاستخدام خاصية المعاينة");return}t.document.open(),t.document.write(s),t.document.close()}export{Me as downloadReportPdf,Pe as previewAttendanceReport,Fe as previewExecutiveSlides,je as previewExecutiveSummary,Ne as previewReport};

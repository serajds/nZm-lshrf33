/**
 * Standalone RTL waiting/error screen for the report preview popup.
 * No external requests. Existing updater targets #preview-status.
 * Optional hooks: #preview-progress (<progress> 0..100), #preview-count (text).
 * Add class "is-error" to <body> to switch to the error presentation.
 */
export function reportPreviewScreenHtml(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تجهيز معاينة التقرير</title>
<style>
:root{--bg:#eef1ec;--paper:#fbfaf6;--ink:#1d2a33;--muted:#5d6b72;--line:#d6dad2;--accent:#c4622d;--accent-soft:#f3e2d6;--steel:#2f4a5c;--err:#a8322a;--err-soft:#f6e1de}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--ink);font-family:"Segoe UI",Tahoma,"Noto Naskh Arabic","Geeza Pro",sans-serif;line-height:1.7}
.card{width:100%;max-width:520px;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 40px -24px rgba(29,42,51,.45);overflow:hidden}
.band{height:6px;background:var(--steel);position:relative;overflow:hidden}
.band::after{content:"";position:absolute;inset:0;width:30%;background:var(--accent);animation:slide 1.6s ease-in-out infinite}
.head{display:flex;align-items:center;gap:16px;padding:28px 28px 8px}
.icon{flex:none;width:64px;height:64px;border-radius:12px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;position:relative}
.icon svg{width:34px;height:34px}
.sheet{animation:feed 1.8s ease-in-out infinite;transform-origin:center}
.kicker{margin:0;font-size:12px;letter-spacing:.06em;color:var(--muted);font-weight:600}
h1{margin:2px 0 0;font-size:21px;font-weight:700}
.body{padding:12px 28px 28px}
#preview-status{margin:0 0 18px;font-size:15px;color:var(--ink);min-height:1.7em}
.meter{display:flex;align-items:center;gap:12px}
progress{flex:1;height:8px;appearance:none;-webkit-appearance:none;border:0;border-radius:99px;background:var(--line);overflow:hidden;direction:rtl}
progress::-webkit-progress-bar{background:var(--line);border-radius:99px}
progress::-webkit-progress-value{background:var(--accent);border-radius:99px;transition:width .3s}
progress::-moz-progress-bar{background:var(--accent);border-radius:99px}
progress:not([value])::-webkit-progress-bar{background:var(--line)}
#preview-count{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);min-width:3.5em;text-align:left;direction:ltr}
.steps{list-style:none;margin:22px 0 0;padding:16px 0 0;border-top:1px dashed var(--line);display:grid;gap:8px;font-size:13px;color:var(--muted)}
.steps li{display:flex;align-items:center;gap:10px}
.steps li::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--steel);opacity:.35}
.steps li:first-child::before{opacity:1;background:var(--accent)}
.note{margin:18px 0 0;font-size:12.5px;color:var(--muted)}
body.is-error .band{background:var(--err)}
body.is-error .band::after{display:none}
body.is-error .icon{background:var(--err-soft);color:var(--err)}
body.is-error .sheet{animation:none}
body.is-error #preview-status{color:var(--err);font-weight:600}
body.is-error .meter,body.is-error .steps{display:none}
@keyframes slide{0%{transform:translateX(120%)}100%{transform:translateX(-360%)}}
@keyframes feed{0%,100%{transform:translateY(0)}50%{transform:translateY(2px)}}
@media (max-width:480px){body{padding:14px}.head{padding:22px 20px 6px;gap:12px}.icon{width:52px;height:52px}.body{padding:10px 20px 22px}h1{font-size:18px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main class="card" aria-labelledby="preview-title">
<div class="band" aria-hidden="true"></div>
<div class="head">
<div class="icon" aria-hidden="true">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><g class="sheet"><path d="M7 14h10v7H7z" fill="#fbfaf6"/><path d="M9.5 17h5M9.5 19h3"/></g><circle cx="17.5" cy="12" r=".6" fill="currentColor"/>
</svg>
</div>
<div>
<p class="kicker">معاينة التقرير الرسمي</p>
<h1 id="preview-title">جارٍ تجهيز معاينة التقرير</h1>
</div>
</div>
<div class="body">
<p id="preview-status" role="status" aria-live="polite">جارٍ تحميل بيانات التقرير والصور والشعارات…</p>
<div class="meter">
<progress id="preview-progress" max="100" aria-label="تقدم تجهيز المعاينة"></progress>
<span id="preview-count" aria-hidden="true"></span>
</div>
<ul class="steps" aria-hidden="true">
<li>بيانات التقرير</li>
<li>صور الموقع</li>
<li>شعارات الجهات</li>
</ul>
<p class="note">ستظهر المعاينة في هذه النافذة تلقائيًا فور اكتمال التحميل. يُرجى عدم إغلاقها.</p>
</div>
</main>
</body>
</html>`;
}

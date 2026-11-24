import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { output, summarizeMixedRequests, save } from "./common.mjs";

const processing = JSON.parse(await readFile(path.join(output, "processing-baseline.json"), "utf8"));
const transport = JSON.parse(await readFile(path.join(output, "transport-baseline.json"), "utf8"));
const browser = JSON.parse(await readFile(path.join(output, "browser-baseline.json"), "utf8"));
const storage = JSON.parse(await readFile(path.join(output, "storage-baseline.json"), "utf8"));
const mixed = JSON.parse(await readFile(path.join(output, "mixed-180-replicate-07.json"), "utf8"));
const firstPostUnification = JSON.parse(await readFile(path.join(output, "mixed-180-post-unification.json"), "utf8"));
const postUnification = JSON.parse(await readFile(path.join(output, "mixed-180-post-optimization.json"), "utf8"));
const migrationEvidence = JSON.parse(await readFile(path.join(output, "legacy-sample-validation.json"), "utf8"));
const browserFlow = JSON.parse(await readFile(path.join(output, "signed-browser-flow.json"), "utf8"));
const previewMeasurement = JSON.parse(await readFile(path.join(output, "preview-measurement-final.json"), "utf8"));
const browserBatches = browserFlow.batches ?? [];
const browserLastBatch = browserBatches.at(-1);
const mixedReplicates = await Promise.all([
  "mixed-180-replicate-06.json",
  "mixed-180-replicate-07.json",
].map(async name => ({ name, data: JSON.parse(await readFile(path.join(output, name), "utf8")) })));
const repeatedLoadRuns = await Promise.all([1, 2, 3].map(async index => ({
  name: `mixed-repeat-0${index}.json`,
  data: JSON.parse(await readFile(path.join(output, `mixed-repeat-0${index}.json`), "utf8")),
  cleanup: JSON.parse(await readFile(path.join(output, `mixed-repeat-0${index}-cleanup.json`), "utf8")),
})));
const mixedHistory = await Promise.all(Array.from({ length: 7 }, (_, index) =>
  `mixed-180-replicate-${String(index + 1).padStart(2, "0")}.json`).map(async name => ({
  name, data: JSON.parse(await readFile(path.join(output, name), "utf8")),
})));
const preVerificationRun = mixedHistory.find(item => item.name === "mixed-180-replicate-05.json");
// Re-summarize existing raw observations without rerunning or changing them.
mixed.summary = summarizeMixedRequests(mixed.requests);
mixed.summaryVersion = 2;
await save("mixed-baseline.json", mixed);
const storageTransport = JSON.parse(await readFile(path.join(output, "storage-transport-baseline.json"), "utf8"));
const storageCleanup = JSON.parse(await readFile(path.join(output, "storage-transport-cleanup.json"), "utf8"));
const largeSource = JSON.parse(await readFile(path.join(output, "large-source-upload.json"), "utf8"));
const escape = value => String(value ?? "غير مقاس").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "غير مقاس";
const p95Failures = mixedReplicates.flatMap(({ name, data }) =>
  data.performanceAcceptance.filter(row => row.state === "FAIL").map(row => `${name}: ${row.phase}/${row.operation} ${number(row.p95Ms)}>${number(row.thresholdMs)} ms`));
const postOptimizationFailures = postUnification.performanceAcceptance.filter(row => row.state === "FAIL");
const browserFlowRows = [
  ["الجرد الجاف", migrationEvidence.dryRun.status, `${migrationEvidence.dryRun.candidates} عنصر اصطناعي؛ بلا تغييرات`, number(migrationEvidence.dryRun.elapsedMs), migrationEvidence.cleanup.status],
  ["ترحيل العينة والاستئناف", migrationEvidence.sample.status, `${migrationEvidence.sample.durableObjectsVerified} مشتق دائم؛ الاستئناف ${migrationEvidence.recovery.resumedAs}؛ الرابط الأصلي محفوظ`, number(migrationEvidence.sample.elapsedMs), `${migrationEvidence.cleanup.verifiedAbsent}/${migrationEvidence.cleanup.attempted}`],
  ["رفع واجهة التقارير", browserFlow.upload.status, `${browserFlow.upload.requestCount ?? browserFlow.upload.requests.length} صورة ناجحة عبر 1/10/20/50`, number(browserBatches.reduce((sum, batch) => sum + batch.upload.queueElapsedMs, 0)), browserFlow.cleanup?.status ?? "غير مسجل"],
  ["عرض وتكبير وطباعة 50 صورة", browserLastBatch?.preview?.status ?? "BLOCKED", `نص أولًا؛ ${browserLastBatch?.preview?.readyThumbnails ?? 0}/50 مصغرًا؛ طباعة ${browserLastBatch?.preview?.printPrepared ? "مجهزة" : "غير مكتملة"}`, number(browserLastBatch?.preview?.elapsedMs), `${browserFlow.cleanup?.verifiedAbsent ?? 0}/${browserFlow.cleanup?.attempted ?? 0}`],
  ["تعديل التقرير مع حفظ ترتيب الصور", browserFlow.reportEditRetention?.status ?? "BLOCKED", `${browserFlow.reportEditRetention?.imageReferences ?? 0} مرجع صورة محفوظ`, "—", browserFlow.cleanup?.status ?? "غير مسجل"],
];
const browserBatchRows = browserBatches.map(batch => [
  batch.batchSize,
  number(batch.sourceBytesTotal / 1048576),
  `${number(batch.upload.p50Ms)} / ${number(batch.upload.maxMs)}`,
  `${number(batch.localPreparation.p50Ms)} / ${number(batch.localPreparation.maxMs)}`,
  number(batch.upload.queueElapsedMs),
  number(batch.upload.bytesSent / 1048576),
  `${batch.preview.readyThumbnails}/${batch.preview.imageCount}; ${number(batch.preview.elapsedMs)}`,
  `${number(batch.browserResponsiveness.heartbeatMaxGapMs)} / ${number(Math.max(0, ...batch.browserResponsiveness.longTasks))}`,
]);
const browserMaxLongTask = Math.max(0, ...browserBatches.flatMap(batch => batch.browserResponsiveness.longTasks));
const browserMaxHeartbeatGap = Math.max(0, ...browserBatches.map(batch => batch.browserResponsiveness.heartbeatMaxGapMs));
const browserPreviewRows = [
  ["أول صورة في معاينة 50", "غير مسجل", "BLOCKED", "لم يُحفظ زمن منفصل"],
  ["إتاحة واجهة التقرير", "غير مسجل", "BLOCKED", "لم يُحفظ زمن منفصل"],
  ["اكتمال 50 مصغرًا", `${number(browserLastBatch?.preview?.elapsedMs)} ms`, "PASS بقياس تسلسلي", "انتقل الاختبار صورةً صورة وانتظر كل واحدة"],
  ["حجم المصغرات والبيانات المنقولة", "غير مقاس", "BLOCKED", "لم تحفظ القياسات الحجمية"],
  ["التحميل الكسول والتزامن", "مؤكد من المسار", "PASS ساكن", "مراقبة تقاطع؛ مصغر واحد نشط وحد أقصى كلي 2"],
  ["إعادة استخدام المصغرات", "داخل نافذة المعاينة", "BLOCKED قياسًا", "الخريطة داخل الذاكرة؛ لم يكتمل تحقق إعادة الزيارة"],
  ["الصورة الرئيسية قبل التكبير", "طلب مصغر واحد و0 صور رئيسية لعينة صورة واحدة", "PASS للعينة فقط", "لم يكتمل القياس على 50 صورة"],
];
const repeatedLoadSummaryRows = repeatedLoadRuns.map(({ name, data, cleanup }) => {
  const upload50 = data.summary.find(row => row.phase === "upload-50" && row.operation === "upload");
  const transient = data.requests.filter(row => row.status === 429).length;
  return [
    name.replace(".json", ""), data.status, `${data.successfulUploads}/${data.targetUploadCount}`,
    `${transient} (تمت الاستعادة)`,
    `${number(upload50?.latencyMs.p50)} / ${number(upload50?.latencyMs.p95)}`,
    number(data.memorySamples.peakRss / 1048576), number(data.memorySamples.peakPss / 1048576),
    `${number(data.result.snapshot.eventLoop.p95Ms)} / ${number(data.result.snapshot.eventLoop.maxMs)}`,
    `${data.performanceAcceptance.filter(row => row.state === "FAIL").length}`,
    `${cleanup.verifiedAbsent}/${cleanup.attempted}`,
  ];
});
const repeatedUploadRows = repeatedLoadRuns.flatMap(({ name, data }) =>
  data.summary.filter(row => row.operation === "upload" && row.phase.startsWith("upload-")).map(row => [
    name.replace(".json", ""), row.phase.replace("upload-", ""),
    row.latencyMs.n, number(row.latencyMs.p50), number(row.latencyMs.p95),
    row.httpErrors, row.recoveredRetries, row.errors,
  ]));
const repeatedAcceptanceRows = repeatedLoadRuns.flatMap(({ name, data }) =>
  data.performanceAcceptance.map(row => {
    const latency = data.summary.find(item => item.phase === row.phase && item.operation === row.operation)?.latencyMs;
    return [
      name.replace(".json", ""), row.phase, row.operation, row.sampleCount,
      number(latency?.p50), number(row.p95Ms), number(row.thresholdMs), row.state,
    ];
  }));
const mixedResourceRows = [
  ...mixedReplicates.map(({ name, data }) => [
    name.replace(".json", ""), data.status, `${data.successfulUploads}/${data.targetUploadCount}`,
    number(data.memorySamples.peakRss / 1048576), number(data.memorySamples.peakPss / 1048576),
    number(data.memorySamples.apiPeakRss / 1048576),
    `${number(data.result.snapshot.eventLoop.p95Ms)} / ${number(data.result.snapshot.eventLoop.maxMs)}`,
    data.clientEventLoop ? `${number(data.clientEventLoop.p95Ms)} / ${number(data.clientEventLoop.maxMs)}` : "لم يقس",
    `${data.cleanupResult.verifiedAbsent}/${data.cleanupResult.attempted} أزيل وتأكد غيابه`,
  ]),
  [
    "بعد الإصلاح السببي", postUnification.status, `${postUnification.successfulUploads}/${postUnification.targetUploadCount}`,
    number(postUnification.result.peakRss / 1048576), number(postUnification.result.peakPss / 1048576),
    number(postUnification.result.apiPeakRss / 1048576),
    `${number(postUnification.result.snapshot.eventLoop.p95Ms)} / ${number(postUnification.result.snapshot.eventLoop.maxMs)}`,
    `${number(postUnification.clientEventLoop.p95Ms)} / ${number(postUnification.clientEventLoop.maxMs)}`,
    `${postUnification.cleanupResult.verifiedAbsent}/${postUnification.cleanupResult.attempted} أزيل وتأكد غيابه`,
  ],
];
const verificationSample = data => {
  const values = data.result.snapshot.observations
    .filter(row => row.operation === "attendance-write" && row.phase.startsWith("upload-"))
    .map(row => row.phases?.["image.primary.storage_verify"])
    .filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: values.length,
    p50: values[Math.floor((values.length - 1) * 0.5)],
    p95: values[Math.floor((values.length - 1) * 0.95)],
    max: values.at(-1),
  };
};
const verificationComparison = [
  { name: "قراءة كاملة قبل التحسين", ...verificationSample(preVerificationRun.data) },
  ...mixedReplicates.map(item => ({ name: "تحقق HEAD + CRC32C", ...verificationSample(item.data) })),
];
const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>نتائج قياس منظومة الصور — التنفيذ غير مكتمل</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#1f2937;font:16px/1.9 system-ui,Arial,sans-serif}
main{max-width:1120px;margin:auto;padding:28px 20px}section,header{background:#fff;border:1px solid #dce1e7;border-radius:10px;padding:22px;margin:0 0 20px}
h1{font-size:27px;line-height:1.6;margin:0 0 12px}h2{font-size:21px;margin:0 0 14px}p{margin:8px 0}
.warning{border-right:5px solid #b45309;background:#fffbeb}.critical{color:#991b1b;font-weight:700}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #dce1e7;padding:9px;text-align:right;vertical-align:top}th{background:#eef2f6}
code,pre{direction:ltr;text-align:left}pre{max-height:500px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;background:#f6f8fa;padding:16px}
summary{cursor:pointer;font-weight:700}small{color:#4b5563}@media print{body{background:#fff}main{padding:0}section,header{break-inside:avoid}details{display:none}}
</style></head><body><main>
<header><h1>نتائج قياس منظومة الصور</h1>
<p class="critical">المهمة غير مكتملة. نُفّذت إعادة بناء واختبارات فعلية، لكن لا يمكن إعلان قبول كامل قبل تأكيد مصدر صور التطوير واستكمال اختبارات الأجهزة/الترحيل المتاحة.</p>
<p>نُفّذت تجارب فعلية بأدوات قابلة للإعادة وصور اصطناعية، مع قالب التقرير ومحمّل الصور الحاليين. لم تُنشر تغييرات ولم تُعدّل قاعدة الإنتاج أو صور المستخدمين.</p>
<small>تاريخ قياس المعالجة: ${escape(processing.recordedAt)} — Node ${escape(processing.node)}</small></header>

<section class="warning"><h2>تم التحقق من عزل مخزن الاختبار</h2>
<p>قدّم المستخدم مخزنًا مستقلًا للتطوير، وأثبت الحارس اختلافه عن مخزن التطبيق. نجح اختبار نقل موقّع مع قراءة SHA-256 كاملة، ورفع فعلي من Chromium عبر CORS. دورة التطبيق الحالية تحقّق CRC32C أثناء الرفع ثم signed HEAD للحجم والنوع والجيل وSHA-256 المسجل. حُذفت فقط كائنات الاختبار الاصطناعية التي أنشأتها الأدوات.</p>
<p>اختبار الحمل استخدم قاعدة PostgreSQL جديدة داخل عملية اختبار منفصلة. عينة الترحيل الاصطناعية استخدمت قاعدة مؤقتة؛ لم يُشغّل CLI الذي يتصل بقاعدة التطبيق. لم تُفتح قاعدة الإنتاج ولم يتغير إعداد المخزن الأصلي.</p>
<p>متغير مخزن التطبيق موجود في نطاقي التطوير والإنتاج. وثائق Replit الرسمية تقول إن App Storage يتشارك البيانات بين نسختي التطبيق؛ لذلك اعتُبر المخزن الافتراضي غير معزول ولم يُفتح. لم يُفحص أي كائن أو بيانات من المخزن الأصلي، ولم تُكشف قيمة أي سر. <a href="https://docs.replit.com/features/data-and-storage/object-storage">وثائق App Storage الرسمية</a>. مخزن الاختبار المنفصل هو وجهة تجارب فقط، وليس دليلًا على عزل المصدر التاريخي.</p>
<p>اجتازت نواة السياسة ورفع التقارير وروابط المشاركة والملفات والشعارات والحضور صيغ SVG وGIF الثابتة والتجهيز المحلي والقراءة الآمنة ومسار PDF اختبارات معزولة. اجتاز ترحيل عينة اصطناعية واستئنافها على PostgreSQL مؤقتة، كما اجتاز تدفق متصفح مسجّل اصطناعيًا. الجرد الفعلي للأصول القديمة محجوب.</p></section>

<section><h2>Original Baseline — معالجة المسار القديم</h2>
<p>هذه قياسات خط الأساس قبل توحيد دورة الصور، وليست نتائج النسخة الحالية. صورة تفصيلية اصطناعية ثابتة، 3200×2400، بحجم 4,260,235 بايت. إعادة الترميز القديمة أُعيدت كما في المصدر، والمشتقات أُنتجت بالمكتبة الفعلية دون التخزين وقاعدة البيانات. كل دفعة في عملية منفصلة، والقياسات النهائية نُفّذت بالتتابع.</p>
${table(["عدد الصور", "الحالة", "زمن المعالجة بالثواني", "RSS الأقصى MiB", "p50 للصورة ms", "p95 للصورة ms", "مشتقات فاشلة"], processing.results.map(row => [
  row.count, row.status, number(row.elapsedMs / 1000), number(row.peakRss / 1048576),
  number(row.imageLatencyMs.p50), number(row.imageLatencyMs.p95),
  row.rows ? row.rows.filter(image => image.status !== "PASS").length : "لم تكتمل الدفعة",
]))}
<p>فشلت مشتقات صورتين من دفعة 20. دفعة 50 أوقفتها الأداة عند تجاوز حد أمان تجريبي قدره 700 MiB، ولم تنتظر انهيار البيئة. قيم p50/p95 تخص الصور التي اكتملت داخل دفعة واحدة، وليست تكرارات مستقلة لزمن الدفعة.</p>
<p>حجم النسخة المعاد ترميزها ظل 3,850,585 بايت؛ نسخة الطباعة 81,575 بايت والمصغر 25,535 بايت. مصدر الضغط الحالي أعاد الترميز عدة مرات؛ جرى عدّ 4 عمليات ترميز مشتقات للصورة المكتملة. لا يثبت هذا الاختبار سبب توقف الإنتاج أو نفاد ذاكرته.</p></section>

<section><h2>مقارنة النقل الحالية</h2>
<p>HTTP محلي، نفس المحتوى وفحص SHA-256، ترتيب الاختبارات متناوب، 8 عينات محسوبة لكل حالة بعد استبعاد أول عينة. لا تشمل الأرقام حافة النشر أو CORS أو الصلاحيات أو PWA. أسماء الصور رمزية؛ الأحجام الفعلية في البيانات الخام، وإحدى صور PNG تتجاوز 20 MiB بقليل لاختبار حجم كبير.</p>
${table(["العينة", "النقل", "حجم جسم الطلب بايت", "p50 ذهاب وإياب ms", "p95 ms", "p50 التحليل ms", "p50 فك الترميز ms"], transport.summary.map(row => [
  row.fixture, row.mode, row.wireBodyBytes, number(row.roundTripMs.p50), number(row.roundTripMs.p95),
  number(row.parseMs.p50), number(row.decodeMs.p50),
]))}
<p>يثبت الاختبار تكلفة حجم Base64 والتحليل في هذه البيئة فقط. النقل الثنائي أسرع هنا، لكن لم يُعتمد بديل ولم تُغيّر آلية نقل التطبيق؛ يلزم إثبات توافق الحافة والصلاحيات وسلامة الاكتمال قبل القرار.</p></section>

<section><h2>مقارنة المتصفح مع التخزين الحقيقي المعزول</h2>
<p>نفس Chromium والصورة ذات 4,260,235 بايت والمخزن المستقل وفحص المحتوى بعد الرفع. ترتيب متناوب، وتسع دورات لكل آلية مع استبعاد الأولى. التوقيع قيس منفصلًا؛ الإقرار هنا يشمل فحص SHA-256 بعد تنزيل الصورة المخزنة. الوكيل محلي خاص وليس مسار صلاحيات التطبيق أو حافة الإنتاج.</p>
${table(["النقل", "عينات", "تحضير p95 ms", "اكتمال متحقق p50 ms", "اكتمال متحقق p95 ms", "فشل التحقق"], storageTransport.summary.map(row => [
  row.mode, row.verifiedMs.n, number(row.prepareMs.p95), number(row.verifiedMs.p50), number(row.verifiedMs.p95), row.errors,
]))}
<p>النجاح عبر CORS لا يثبت صلاحيات رفع مباشر داخل التطبيق أو توافق PWA والحافة؛ لا تغيير للنقل استنادًا إلى هذه المقارنة وحدها.</p></section>
<section><h2>تنظيف بيانات الاختبار</h2>
<p>تعثر التنظيف الأول بعد اكتمال المقارنة. أُنجز التنظيف اللاحق بعد التحقق من وقت الإنشاء والمحتوى الاصطناعي وجيل كل كائن: ${storageCleanup.attempted} كائنات خاصة بالتجربة، وفشل متبقٍ ${storageCleanup.cleanupFailures}. لم تُحذف أصول أو صور مستخدمين، ولم يُنفّذ حذف شامل للمخزن.</p></section>

<section><h2>اختبارات الحمل النهائية على النسخة الحالية</h2>
<p>مسارات التطبيق الفعلية مع JWT وستة مستخدمين اصطناعيين: دفعات رفع 1 و10 و20 و50، فتح تقرير، تعديل مشروع، تسجيل حضور، تصفح ملفات، وتصدير PDF. مولّد الطلبات خارج عملية API، وكل دفعة تعمل بطابور صورتين مع عمليات بقية المستخدمين.</p>
<p>التشغيل الأخير <b>${escape(mixed.status)}</b>: اكتملت ${mixed.successfulUploads} من ${mixed.targetUploadCount} عملية رفع. RSS الأقصى للشجرة ${number(mixed.result.peakRss / 1048576)} MiB، وPSS الأقصى ${number(mixed.result.peakPss / 1048576)} MiB، وRSS API ${number(mixed.result.apiPeakRss / 1048576)} MiB. حد الأمان 700 MiB طُبق على PSS مع RSS احتياطي، ولم يحدث إيقاف بالحارس في التشغيلين النهائيين. استغرق التشغيل الأخير ${number(mixed.result.wallMs / 1000)} ثانية.</p>
<p>تأخر حلقة أحداث API في آخر تشغيل: p95 ${number(mixed.result.snapshot.eventLoop.p95Ms)} ms، أقصى ${number(mixed.result.snapshot.eventLoop.maxMs)} ms؛ مولّد الحمل p95 ${number(mixed.clientEventLoop?.p95Ms)} ms وأقصى ${number(mixed.clientEventLoop?.maxMs)} ms. هذان مقياسان مختلفان ولا يفسران وحدهما تأخر كل طلب.</p>
${table(["الحمل", "الخدمة", "طلبات باستجابة", "p50 ms", "p95 ms", "فشل HTTP", "فشل نقل غير منسوب", "إلغاء الحارس"], mixed.summary.map(row => [
  row.phase, row.operation, row.latencyMs.n, number(row.latencyMs.p50), number(row.latencyMs.p95),
  row.httpErrors, row.transportFailures, row.guardAborts,
]))}
<p>لم تفقد عينات RSS أو PSS داخل شجرة API؛ بقيت ${mixed.processDiscoveryOmissionCount} قراءة معلومات لعمليات خارج الشجرة ولم تدخل في حساب الذاكرة. أظهرت أزواج request-id في بعض الطلبات فرقًا بين زمن العميل وزمن Express؛ لا يُنسب ذلك إلى سبب واحد دون فحص إضافي. لا تثبت هذه الاختبارات سبب أي عطل إنتاجي.</p></section>

<section><h2>تاريخ تشغيلات p95 والحكم النهائي</h2>
<p>حُفظ حد القبول كما هو: p95 تحت الحمل لا يتجاوز الأكبر من 100 ms أو 1.5×p95 الخمول. العينة الأقل من 30 موسومة BLOCKED، دون تغيير حد الزمن. كل تشغيل استخدم API وقاعدة اختبار منفصلتين ومفاتيح صور جديدة. التشغيلان 06 و07 تاريخيان قبل إصلاح استعلامات المشروع ومشاركة الصور؛ لا يُعرضان على أنهما القياس النهائي.</p>
${table(["التشغيل", "المعالجة", "الحالة", "رفع ناجح", "صفوف p95 FAIL", "RSS MiB", "PSS MiB", "الكائنات التي تأكد حذفها"], mixedHistory.map(({ name, data }) => [
  name.replace(".json", ""), name <= "mixed-180-replicate-02.json" ? "قبل تحسينات الزمن" :
    name <= "mixed-180-replicate-04.json" ? "تحسين تصفح الملفات" :
      name === "mixed-180-replicate-05.json" ? "استعلامات التقرير بالتوازي" : "تحقق CRC32C/HEAD",
  data.status, `${data.successfulUploads}/${data.targetUploadCount}`,
  data.performanceAcceptance.filter(row => row.state === "FAIL").length,
  number(data.memorySamples.peakRss / 1048576), number(data.memorySamples.peakPss / 1048576),
  `${data.cleanupResult.verifiedAbsent}/${data.cleanupResult.attempted}`,
]))}
${table(["التشغيل", "الحمل", "المسار", "العينات", "حد p95 ms", "المقاس ms", "النتيجة"], mixedReplicates.flatMap(({name, data}) =>
  data.performanceAcceptance.map(row => [
    name.replace(".json", ""), row.phase, row.operation, row.sampleCount,
    number(row.thresholdMs), number(row.p95Ms), row.state,
  ])))}
<p class="critical">فشل الحد تاريخيًا في ${p95Failures.length} صفوف عبر التشغيلين 06 و07: ${escape(p95Failures.join("؛ "))}. بقيت النتيجة التاريخية FAIL. بعد ذلك أُزيلت استعلامات لا حاجة لها من مساري التقارير وتعديل المشروع، ثم أُعيد الحمل نفسه مرة واحدة. لا يُعد القياس التاريخي دليلًا على فشل النتيجة النهائية بعد الإصلاح.</p></section>

<section><h2>ثلاثة تكرارات مستقلة بعد الإصلاح</h2>
<p>أُعيد الحمل المختلط ثلاث مرات منفصلة بالشروط والحدود نفسها، دون خفض معيار p95. أكملت التشغيلات الثلاثة 180/180 صورة. اجتاز ${repeatedLoadRuns.filter(run => run.data.status === "PASS").length} من 3 تشغيلات كل صفوف p95؛ وسجّل التشغيل الآخر ${repeatedLoadRuns.reduce((sum, run) => sum + run.data.performanceAcceptance.filter(row => row.state === "FAIL").length, 0)} إخفاقًا واحدًا: تعديل المشروع أثناء دفعة 50، p95=${number(repeatedLoadRuns[1]?.data.performanceAcceptance.find(row => row.state === "FAIL")?.p95Ms)} ms مقابل حد ${number(repeatedLoadRuns[1]?.data.performanceAcceptance.find(row => row.state === "FAIL")?.thresholdMs)} ms. لم يتغير الحد ولم تُعد هذه النتيجة. تعافت كل طلبات 429 تلقائيًا ولم تسجل طلبات نهائية فاشلة. النتيجة المجمعة غير PASS بسبب ذلك الإخفاق.</p>
${table(["التشغيل", "الحالة", "رفع فريد", "429 مُستعاد", "رفع 50 p50/p95 ms", "RSS MiB", "PSS MiB", "حلقة API p95/max ms", "صفوف p95 FAIL", "تنظيف المخزن"], repeatedLoadSummaryRows)}
<details><summary>تفاصيل p50 وp95 وحد القبول لكل مسار</summary>
${table(["التشغيل", "الحمل", "المسار", "العينات", "p50 ms", "p95 ms", "حد القبول ms", "الحكم"], repeatedAcceptanceRows)}
${table(["التشغيل", "دفعة صور", "عينات رفع", "p50 ms", "p95 ms", "أخطاء HTTP", "محاولات مستعادة", "أخطاء نهائية"], repeatedUploadRows)}
</details>
<p>ذروة PSS عبر التكرارات ${number(Math.max(...repeatedLoadRuns.map(run => run.data.memorySamples.peakPss / 1048576)))} MiB، وRSS ${number(Math.max(...repeatedLoadRuns.map(run => run.data.memorySamples.peakRss / 1048576)))} MiB. لم تسجل عينات RSS/PSS مفقودة؛ استُبعدت بعض قراءات اكتشاف العمليات من الشجرة، موثقة ضمن البيانات الخام. جميع مفاتيح الصور الاصطناعية حُذفت وتأكد غيابها في كل تشغيل.</p></section>

<section><h2>الحمل المختلط بعد الإصلاح السببي</h2>
<p>بعد فشل التشغيل الأول إثر توحيد دورة الصور (حالة ${escape(firstPostUnification.status)} و${firstPostUnification.performanceAcceptance.filter(row => row.state === "FAIL").length} صفوف p95 فاشلة)، أُصلحت استعلامات مشاركة الصور والتعديل التي لم تكن مطلوبة في تلك الحالات ثم أُعيد الحمل مرة واحدة وبالحدود نفسها. في قاعدة اختبار منفصلة ومخزن التطوير المعزول اكتملت ${postUnification.successfulUploads} من ${postUnification.targetUploadCount} صورة فريدة ضمن دفعات اختيار 1 و10 و20 و50، بالتزامن مع مستخدمين اصطناعيين يفتحون التقارير ويعدّلون المشاريع ويسجلون الحضور ويتصفحون الملفات ويصدرون PDF. سُجل ${postUnification.completedUploadsObserved - postUnification.successfulUploads} طلب رفع مؤقت 429 وتعافت إعادة المحاولة؛ لم تفشل أي صورة نهائيًا. توازي رفع الصور بقي محدودًا باثنين، وليس 50 طلبًا متزامنًا.</p>
${table(["دفعة الصور", "طلبات الرفع", "p50 ms", "p95 ms", "رفض مؤقت 429", "نجاح فريد"], postUnification.summary.filter(row => row.operation === "upload" && row.phase.startsWith("upload-")).map(row => [
  row.phase, row.latencyMs.n, number(row.latencyMs.p50), number(row.latencyMs.p95),
  row.httpErrors, row.errors === 0 ? "كل الصور" : "راجع الأخطاء",
]))}
<p>RSS الأقصى للشجرة ${number(postUnification.result.peakRss / 1048576)} MiB، وPSS ${number(postUnification.result.peakPss / 1048576)} MiB، وRSS عملية API ${number(postUnification.result.apiPeakRss / 1048576)} MiB، وخيط العامل ${number(postUnification.result.workerTreePeakRss / 1048576)} MiB. CPU للشجرة ${number(postUnification.result.processTreeCpuMs / 1000)} ثانية خلال ${number(postUnification.result.wallMs / 1000)} ثانية. تأخر حلقة API p95/max ${number(postUnification.result.snapshot.eventLoop.p95Ms)}/${number(postUnification.result.snapshot.eventLoop.maxMs)} ms؛ والمولّد ${number(postUnification.clientEventLoop.p95Ms)}/${number(postUnification.clientEventLoop.maxMs)} ms.</p>
${table(["المسار أثناء دفعة 50", "العينات", "p95 ms", "حد القبول ms", "الحالة"], postUnification.performanceAcceptance.filter(row => row.phase === "upload-50").map(row => [
  row.operation, row.sampleCount, number(row.p95Ms), number(row.thresholdMs), row.state,
]))}
<p class="${postOptimizationFailures.length ? "critical" : ""}">نتيجة التشغيل بعد الإصلاح ${escape(postUnification.status)}؛ صفوف p95 الفاشلة ${postOptimizationFailures.length}. لم يتغير حد القبول. RSS الأقصى للشجرة ${number(postUnification.result.peakRss / 1048576)} MiB وPSS ${number(postUnification.result.peakPss / 1048576)} MiB وRSS API ${number(postUnification.result.apiPeakRss / 1048576)} MiB. تأخر حلقة API p95/max ${number(postUnification.result.snapshot.eventLoop.p95Ms)}/${number(postUnification.result.snapshot.eventLoop.maxMs)} ms، والمولّد ${number(postUnification.clientEventLoop.p95Ms)}/${number(postUnification.clientEventLoop.maxMs)} ms. أُزيل ${postUnification.cleanupResult.verifiedAbsent} من ${postUnification.cleanupResult.attempted} كائنًا اصطناعيًا وتأكد غيابها؛ فشل التنظيف ${postUnification.cleanupResult.deleteFailures}. هذه نتيجة تشغيل واحد بعد إصلاح سببي وليست تكرارات مستقلة متعددة.</p></section>

<section><h2>ترحيل العينة وتدفق المتصفح المسجّل</h2>
${table(["الاختبار", "الحالة", "النتيجة الفعلية", "الوقت ms", "تنظيف"], browserFlowRows)}
${table(["دفعة الصور", "حجم المصادر MiB", "زمن الرفع p50/max ms", "تحضير محلي p50/max ms", "الطابور ms", "النقل MiB", "المعاينة جاهز/كلي؛ ms", "أقصى نبضة/مهمة طويلة ms"], browserBatchRows)}
<p>في الواجهة المسجّلة: 81/81 رفعًا ناجحًا و81/81 تحضيرًا محليًا، بلا إعادة محاولة. دفعة 50 استغرقت ${number(browserLastBatch?.upload.queueElapsedMs)} ms؛ ظهرت مصغراتها الـ50 خلال ${number(browserLastBatch?.preview.elapsedMs)} ms، والتكبير ${browserLastBatch?.preview.zoomNaturalWidth ?? "غير مقاس"} px، وتجهيز صور الطباعة اكتمل. بقيت 50 مرجعًا بعد تعديل التقرير. أكبر تأخر نبضة ${number(browserMaxHeartbeatGap)} ms وأطول مهمة ${number(browserMaxLongTask)} ms. قياس heap في Chromium ${number(browserFlow.browserHeapBytes.beforeBatches / 1048576)} MiB قبل الدفعات و${number(browserFlow.browserHeapBytes.afterBatches / 1048576)} MiB بعدها؛ ليس قياسًا لذاكرة الصورة الأصلية/GPU ولا ذروة موثقة. هذه تجربة واحدة بصور مصطنعة متكررة، لا تُعد p95 أو حكم جودة صور إنشاءات.</p>
<p>هذه صور اصطناعية بقاعدة مؤقتة ومخزن منفصل، وليست ترحيلًا لصور المستخدمين. عينة الترحيل لا تمس المرجع الأصلي وتحفظ خريطة رجوع، لكنها تخص <code>project_files</code> فقط. لم يُفحص المخزن المصدر الأصلي، ولم تُرحّل مراجع التقارير القديمة أو صور الحضور أو الشعارات؛ لا تثبت النتائج سلامة كل أصل قديم أو يتيم.</p></section>
<section><h2>التحقق من التخزين قبل وبعد تقليل القراءة</h2>
<p>في مسار الصورة نفسه، قورنت أزمنة تحقق تخزين مشتق الحضور في تشغيل قبل التحسين وتشغيلين بعده. قبل التحسين كان الرفع يتبعه تنزيل كامل وSHA-256؛ بعده يُتحقق CRC32C من الرفع وHEAD من الحجم والنوع والجيل وSHA-256 المرفق. يظل نجاح الرفع مشروطًا بتأكيد وجود كائن مكتمل.</p>
${table(["طريقة التحقق", "عينات", "p50 ms", "p95 ms", "الحد الأقصى ms"], verificationComparison.map(row => [
  row.name, row.n, number(row.p50), number(row.p95), number(row.max),
]))}
<p>انخفض p95 في هاتين العينتين من ${number(verificationComparison[0].p95)} ms إلى ${number(verificationComparison[1].p95)}–${number(verificationComparison[2].p95)} ms، وانخفض أكبر زمن مسجل من ${number(verificationComparison[0].max)} إلى ${number(Math.max(verificationComparison[1].max, verificationComparison[2].max))} ms. هذا تحسن مقاس في تحقق التخزين، ولا يُنسب إليه وحده اجتياز p95 النهائي؛ سبب تحسن الحمل النهائي كان تقليل استعلامات DB الزائدة.</p></section>
<section><h2>موارد تشغيلات المقارنة والتشغيل النهائي</h2>
${table(["التشغيل", "الحالة", "الرفع الناجح", "RSS الشجرة MiB", "PSS الشجرة MiB", "RSS API MiB", "تأخر حلقة API p95/max ms", "تأخر مولد الحمل p95/max ms", "تنظيف المخزن"], mixedResourceRows)}
<p>مجموع RSS قد يكرر الصفحات المشتركة بين العمليات؛ PSS يوزعها تناسبيًا. جرى استخدام حد 700 MiB على PSS، مع احتياط RSS عند نقص العينة، ولم يُخفض حد القبول.</p></section>

<section><h2>صور مصدر كبيرة عبر نقطة الرفع الفعلية</h2>
<p>أُرسلت مصادر اصطناعية غير مجهزة إلى نقطة رفع التقارير في قاعدة مؤقتة ومخزن الاختبار المنفصل. شملت الصور التفصيلية والعينة الكبيرة ذات بيانات وصفية زائدة ورفض صورة عالية الضوضاء لا يمكن ضغطها ضمن 1.5 MiB بجودة مقبولة. هذه ليست صور هاتف أو نسبًا مئوية.</p>
${table(["الحالة", "حجم المصدر بايت", "زمن الطلب ms", "HTTP/نتيجة", "الحجم المحفوظ بايت", "الأبعاد", "استثناءات الجودة"], largeSource.measurements.map(row => [
  row.label, row.sourceBytes, row.responseTimeMs, row.status ? `${row.status} ${row.code}` : "201 ready", row.outputBytes ?? "لا تخزين",
  row.outputWidth && row.outputHeight ? `${row.outputWidth}×${row.outputHeight}` : "—",
  (row.exceptions || []).map(item => `${item.variant}:${item.code}`).join(", ") || "لا يوجد",
]))}
<p>تُحدد صور التقرير العادية حتى 350 KB، والتفاصيل الدقيقة حتى 600 KB، والاستثناء الفني حتى 1.5 MiB مع تسجيل profile الاستثناء؛ المصغرات حتى 400 px. رفضت الصورة عالية الضوضاء بلا تخزين عند تجاوز سقف الجودة بدل إعلان نجاح ناقص. القيم الخام محفوظة دون محتوى الصور.</p></section>

<section><h2>عرض التقرير والطباعة في Chromium</h2>
<p>اختبار النسخة الحالية بقالب التقرير ومحمّل الصور، باستخدام صور HTTP اصطناعية، على سطح مكتب وهاتف مُحاكى. لا تسجيل دخول أو تجاوز للصلاحيات؛ هذه ليست مراجعة تقرير مستخدم مصادق عليه ولا جهاز هاتف فعلي.</p>
${table(["العرض", "الصور", "الحالة", "ظهور النص ms", "طلبات الصور الأولية", "تهيئة الطباعة ms", "الصور المكتملة أولاً", "توليد PDF ms"], browser.rows.map(row => [
  row.width, row.count, row.status, number(row.textFirstMs), row.initialRequests, number(row.printPrepareMs),
  row.decoded, number(row.pdfMs),
]))}
<p>نجحت حالات 50 و100 صورة في العرض والطباعة؛ أكبر توازٍ للصور 2، وظهرت النصوص قبل تحميل الصور. تهيئة الطباعة كانت ${number(browser.rows[0]?.printPrepareMs)} ms لسطح المكتب/50 صورة، و${number(browser.rows[1]?.printPrepareMs)} ms لسطح المكتب/100 صورة. كل الحالات أصدرت PDF.</p>
<p>سجلت حالة سطح المكتب/50 صورة مهمة طويلة 144 ms؛ بقيت هذه محاكاة بأصول اصطناعية. لا تقيس V8 ذاكرة الصور المفكوكة أو GPU، وأربع حالات لا تكفي لنفي تسرب تراكمي عبر دورات طويلة.</p></section>

<section><h2>قياسات المعاينة والتحميل الكسول المطلوبة</h2>
${table(["المقياس", "النتيجة الفعلية/المصدر", "الحالة", "القيد"], browserPreviewRows)}
<p>آخر محاولة لجمع زمن أول صورة، زمن التفاعل، أحجام 50 مصغرًا وتدفق الشبكة توقفت في أداة الاختبار بعد أول صورة بسبب مرجع helper غير معرف. اجتازت قبل ذلك عينة الصورة الواحدة: النص والزر جاهزان، طلب مصغر واحد، ولا طلب للصورة الرئيسية قبل التكبير؛ أزيلت 3/3 كائنات العينة. لم تُعَد المحاولة وفق تعليمات الجولة الأخيرة. الاختبار الكامل السابق أكمل 50 مصغرًا خلال ${number(previewMeasurement.earlierFullUiRun.elapsedMs)} ms، لكن بالتنقل والانتظار لكل صورة على حدة؛ لذلك لا يمثل سرعة التحميل الطبيعي أو التوازي على الشبكة.</p>
<p>المراجعة الساكنة تؤكد تحميل المصغرات عند دخولها نطاق 500px، وتوازيًا كليًا بحد أقصى طلبين مع مصغر نشط واحد، وإعادة الاستخدام داخل نافذة المعاينة عبر حالة الذاكرة. استجابات الصور <code>private, no-store</code> فلا يُفترض تخزينها في cache مشترك؛ يظل قياس إعادة الاستخدام وبايتات النقل الفعلية لـ50 صورة BLOCKED. مسار التكبير والطباعة يطلب <code>report-photo</code>، لكن عدم تحميل النسخة الكاملة في العرض العادي اختُبر فعليًا لعينة واحدة فقط.</p></section>

<section><h2>تغطية القياسات المطلوبة</h2>
${table(["المكوّن", "ما قيس", "ما بقي غير مثبت"], [
  ["الخيط الرئيسي", "81 صورة في واجهة حقيقية؛ زمن العامل والتقدم وتأخر نبضة الواجهة والمهام الطويلة", "جهاز هاتف فعلي وأداء PWA"],
  ["ذاكرة العميل", "حجم heap في Chromium قبل/بعد دفعات الصور", "ذاكرة الصور الأصلية/GPU ودورات فتح طويلة وهاتف فعلي"],
  ["النقل", "Base64/text مقابل binary وPUT مباشر في بيئة تطوير؛ تحقق SHA-256 وCORS", "حافة النشر وPWA وشبكة ضعيفة وصلاحيات الإنتاج"],
  ["تحليل الطلب", "قياسات تحليل Base64 وJSON ومراحل طلبات الرفع والتخزين", "أثر الحافة المنشورة ووقت تحليل الطلب فيها"],
  ["حلقة الخادم", "ثلاثة تكرارات مستقلة؛ 180 صورة لكل تشغيل وقياس loop p95/max والذاكرة", "إخفاق p95 واحد لتعديل المشروع في التشغيل الثاني"],
  ["المعالجة", "CPU وRSS وPSS وأزمنة API والعامل وإخراج الصور الاصطناعية", "مقارنة جودة ميدانية على صور هندسية حقيقية"],
  ["التخزين الكائني", "توقيع ورفع وتحقق في مخزن معزول، مع اختبارات رفض وفشل", "توافق edge/PWA في النشر"],
  ["قاعدة البيانات", "قراءة تطوير، استعلامات وانتظار pool، ورفع متزامن مع مهام أخرى", "تغطية جلسات ميدانية وجميع قواعد البيانات التاريخية"],
  ["رسم التقرير", "قالب فعلي لـ50 و100؛ واجهة مصادق عليها رفعت 1/10/20/50 وظهرت فيها 50 مصغرًا خلال 16.7 ثانية بتصفح تسلسلي", "أزمنة أول صورة/التفاعل وبايتات النقل الفعلية؛ مصدر تاريخي معزول"],
  ["PDF", "PDF Chromium لـ50/100؛ PDF خادمي لصورة مُدارة واحدة", "حد إجمالي دقيق لحجم مرفقات الطباعة ومراجعة 50 صورة"],
])}</section>

<section><h2>Current Implementation — التنفيذ الحالي</h2>
<ul><li>توحّدت ملفات سياسة التقرير والمصغر والشعار والحضور، وعولجت شعارات SVG وGIF الثابتة بأمان، ورُفض GIF المتحرك بدل إسقاط إطاراته.</li>
<li>أُوقفت مسارات الضغط القديمة مع إبقاء سجلها التاريخي، وأصبحت قراءة الصور القديمة للمعاينة لا تنشئ مشتقات جديدة.</li>
<li>اجتازت 38 اختبار وحدة/معمارية و17 اختبار HTTP، وبناء ونوعيات API والويب، وجردًا جافًا وعينة ترحيل تطوير واحدة. تدفق الواجهة المسجّل اختبر اختيارًا ورفعًا وحفظًا وعرضًا لـ1/10/20/50 صورة مصدر اصطناعية بين 5 و20 MiB، مع تحقق الترتيب والتكبير والطباعة وتعديل التقرير. الصور الـ81 أعادت استخدام نمطين اصطناعيين، فلا تثبت جودة صور إنشاءات حقيقية.</li>
<li>اكتملت ثلاثة تكرارات للحمل المختلط؛ نجح اثنان وفشل واحد صف p95 لتعديل المشروع أثناء رفع 50 صورة (104.05 مقابل حد 100 ms). لم يُغير حد القبول ولم يُعاد الاختبار بعد الفشل.</li>
<li>أُنجزت مراجعة معمارية مستقلة للقراءة فقط؛ عُولجت ملاحظتان حول اختيار مشتق التقرير وقراءة PDF، وأُعيد اختبارهما. أكدت المراجعة أن ترحيل الصور القديمة يغطي <code>project_files</code> فقط.</li>
<li>جرد قاعدة التطوير وجد 1,127 صورة مشروع في <code>project_files</code> و993 مرجع تقرير و1,850 صورة حضور و7 شعارات. لم يُفحص مخزن المصدر الأصلي ولم تُرحّل صور التقارير/الحضور/الشعارات؛ لا تُعد أصولها أو روابطها القديمة مُتحققة.</li>
<li>اختبار PWA والحافة المنشورة والهاتف الفعلي ودورات الذاكرة الطويلة وحقن كل حالات الانقطاع والتوقف، والجرد الكامل للمكرر/اليتيم ما زال BLOCKED.</li>
<li>لم تُحذف أصول تاريخية أو تُمس بيانات الإنتاج، ولم يُنشر التطبيق.</li></ul>
<p>معايير التقرير: عادي 150–350 KB، تفاصيل دقيقة 350–600 KB، استثناء فني موثق حتى 1.5 MiB، ومصغر حتى 400 px و15–50 KB. حد p95 المسبق بقي كما هو؛ فشله يمنع إعلان اكتمال الأداء.</p></section>

<section><h2>نتيجة المراجعة المستقلة والحدود المفتوحة</h2>
${table(["المستوى", "النتيجة", "التصرف في هذه الجولة"], [
  ["PASS", "تأكيد تخزين دائم قبل نجاح الرفع؛ تحقق الصلاحيات لكل مسار؛ التوافق مع روابط التقارير القديمة؛ اختيار مشتق الطباعة؛ صور القراءة لا تُضغط عند الطلب.", "مراجعة ساكنة؛ الاختبارات المعزولة الحالية ناجحة"],
  ["P1 / BLOCKED", "CLI ترحيل صور المشروع يتحقق من مخزن الوجهة لكنه لا يثبت عزل DATABASE_URL قبل كتابة صفوف؛ لا يشغّل حتى يُضاف تحقق DB منفصل.", "لم يُشغّل CLI؛ عينة التكامل استخدمت PostgreSQL مؤقتة"],
  ["P1 / OPEN", "روابط الطباعة قد تعود للأصل التاريخي أو أصل file_image كبير إذا غاب مشتق الطباعة؛ لا سقف إجمالي لبايتات صور التقرير قبل الطباعة.", "لم يتغير السلوك في هذه الجولة؛ يلزم قرار حد آمن لا يقطع التقارير التاريخية"],
  ["P2 / FUTURE", "التعافي بعد تعطل عامل أو تنظيف ملفات يتيمة يعتمد على إعادة محاولة لاحقة؛ لم يظهر عامل مستقل في المسارات المفحوصة.", "سُجل كتحسين مستقبلي"],
])}
<small>المراجع: report preview mapping في <code>report-logos.ts</code> و<code>app.ts</code>; روابط الطباعة في <code>reports.ts:985–1012</code>; حد الحجم في <code>reportImageVariantStorage.ts:28–40</code> و<code>image-policy.ts:42–45</code>; عزل DB الناقص في <code>migrate-legacy-images.mjs:39–48</code>; recovery في <code>image-asset-store.ts:43–101</code>.</small>
<p>المراجعة لم تفتح مخزنًا أو قاعدة إنتاج. يقتصر الحكم على الكود والاختبارات المعزولة؛ العينة التاريخية من تقارير المستخدمين والشعارات والتوافق على مصدر قديم بقيت BLOCKED.</p></section>

<section><h2>خطة نشر وتراجع آمنة</h2>
<p>لا نشر الآن. قبل أي إصدار: حسم إخفاق p95 المتقطع دون تغيير الحد، استكمال اختبار الهاتف الذي سيتولاه المستخدم، مراجعة حد بايتات الطباعة، ثم تحقق build/authorization على نسخة تطوير بعد merge. لا تشغيل للترحيل قبل إثبات عزل قاعدة البيانات ومخزن المصدر وأخذ نسخة احتياطية موثقة.</p>
<p>التراجع: لا تغيّر روابط الأصول القديمة أو تحذف الأصل أثناء الترحيل. احتفظ بخريطة الرجوع وسجلات الربط، وأوقف دفعة الترحيل عند أول اختلاف. في إصدار الكود يمكن الرجوع إلى نقطة/نسخة ما قبل الدمج؛ عند أي تلف في بيانات التطوير تُستعاد النسخة الاحتياطية قبل إعادة التشغيل. لم يُجر هذا النشر أو التراجع.</p></section>

<section><h2>البيانات الخام القابلة للفحص</h2>
${[["معالجة الصور", processing], ["مقارنة النقل", transport], ["المتصفح وPDF", browser], ["قياسات المعاينة النهائية", previewMeasurement], ["التخزين", storage], ["النقل إلى المخزن", storageTransport], ["رفع المصدر الكبير", largeSource], ["تنظيف التجربة", storageCleanup], ["الحمل السابق", mixed], ["الحمل الأول بعد التوحيد", firstPostUnification], ["الحمل بعد الإصلاح", postUnification], ["ترحيل العينة المؤقتة", migrationEvidence], ["المتصفح المسجّل", browserFlow], ...repeatedLoadRuns.map(item => [item.name, item.data])].map(([title, data]) =>
  `<details><summary>${escape(title)}</summary><pre>${escape(JSON.stringify(data, null, 2))}</pre></details>`).join("")}
</section><section><h2>قابلية الإعادة وحدود السلامة</h2>
<p>الأدوات محفوظة في scripts/image-audit، والجرد التقني في docs/image-management/phase-01.md. الملفات الكبيرة والبيانات الخام والصور الاصطناعية في generated-artifacts/image-audit المستثنى من Git والنشر.</p>
<p>أُغلقت جولة التنفيذ بناءً على طلب المستخدم، لا باعتبار جميع معايير القبول PASS. الحالة العامة BLOCKED: مصدر الصور القديمة محمي من الفحص لأنه App Storage مشترك مع الإنتاج؛ تكرار واحد تجاوز p95؛ اختبار قياسات الصور التفصيلي تعطل في harness؛ مراجعة مستقلة أبقت P1 للطباعة وعزل DB. سيُتابع ترحيل الأصول في مهمة منفصلة بعد تجهيز نسخة تطوير موثوقة. لم يُستخدم أي اتصال إنتاجي.</p>
</section></main></body></html>`;
await writeFile(path.join(output, "baseline-report.html"), html);
console.log("Generated sanitized, self-contained baseline-report.html. Overall acceptance: BLOCKED.");

import type { DeviationAnalysis } from "@workspace/api-client-react";
import { AlertTriangle, Info } from "lucide-react";
import { DASH, SCHEDULE_STATUS_TEXT, fmtDate, fmtDays, fmtNum, fmtSigned, statusMeta } from "./format";
import { Kind, Metric, Section } from "./primitives";

export function ExecutiveSummary({ data }: { data: DeviationAnalysis }) {
  const st = statusMeta(data.status);
  const scheduleOk = data.scheduleStatus === "available";
  const pd = data.progressDeviation;
  const pdTone = pd == null ? "" : pd < 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400";

  let forecastText: string = DASH;
  let forecastNote = "";
  switch (data.forecastStatus) {
    case "estimated":
      forecastText = fmtDate(data.forecastCompletionDate);
      forecastNote = "مشروط باستمرار معدل الإنجاز الحالي نفسه؛ ليس التزاماً ولا تاريخاً تعاقدياً.";
      break;
    case "not_started":
      forecastNote = "لم يبدأ التنفيذ الفعلي بعد، فلا يوجد معدل يُبنى عليه التقدير.";
      break;
    case "completed_without_date":
      forecastNote = "البنود مكتملة لكن تاريخ الإنهاء الفعلي غير مسجّل.";
      break;
    default:
      forecastNote = "غير متاح لعدم توفر جدول زمني صالح أو بيانات كافية.";
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card">
        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          <div className="border-b border-border p-5 md:border-b-0 md:border-e">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>تاريخ الاحتساب: <strong className="text-foreground">{fmtDate(data.asOfDate)}</strong> (UTC)</span>
              <span className={`rounded px-1.5 py-0.5 font-bold ${data.dataStatus === "stale" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"}`}>
                {data.dataStatus === "stale" ? "تتضمن بيانات من لقطة سابقة" : "بيانات حية"}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${st.dot}`} />
              <h2 className={`text-2xl font-extrabold md:text-3xl ${st.tone}`}>{st.label}</h2>
            </div>
            <div className="mt-5 flex items-end gap-3">
              <span className={`text-5xl font-black tabular-nums md:text-6xl ${pdTone}`} dir="ltr">{fmtSigned(pd)}</span>
              <span className="pb-2 text-sm font-semibold text-muted-foreground">نقطة مئوية</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              الانحراف = الإنجاز الفعلي الموزون − المخطط الموزون. القيمة السالبة تعني أن التنفيذ خلف المخطط.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-border">
            <div className="bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">الفعلي الموزون <Kind kind="fact" /></div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums" dir="ltr" style={{ textAlign: "right" }}>{fmtNum(data.actualProgress)}%</div>
            </div>
            <div className="bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">المخطط الموزون <Kind kind="derived" /></div>
              <div className="mt-2 text-3xl font-extrabold tabular-nums" dir="ltr" style={{ textAlign: "right" }}>{data.plannedProgress == null ? DASH : `${fmtNum(data.plannedProgress)}%`}</div>
            </div>
            <div className="col-span-2 bg-card p-5">
              <div className="mb-2 flex justify-between text-[11px] text-muted-foreground"><span>0%</span><span>100%</span></div>
              <div className="relative h-3 rounded-full bg-muted">
                <div className="absolute inset-y-0 start-0 rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, data.actualProgress))}%` }} />
                {data.plannedProgress != null && (
                  <div className="absolute -top-1 h-5 w-0.5 bg-foreground" style={{ insetInlineStart: `${Math.min(100, Math.max(0, data.plannedProgress))}%` }} title="المخطط" />
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">الشريط: الفعلي. الخط العمودي: المخطط حتى تاريخ الاحتساب.</p>
            </div>
          </div>
        </div>
      </div>

      {!scheduleOk && (
        <div className="flex gap-3 rounded-xl border border-amber-600/40 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>{SCHEDULE_STATUS_TEXT[data.scheduleStatus] || "الجدول الزمني غير متاح."} تظهر المؤشرات الزمنية بشرطة (—) وليست صفراً.</p>
        </div>
      )}

      <Section title="المؤشرات الزمنية" kicker="ثلاثة مفاهيم مختلفة لا تُجمع">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="المكافئ الزمني للانحراف" value={fmtDays(data.timeDeviation)} kind="estimate"
            note="تحويل تقديري لفارق النقاط المئوية إلى أيام وفق المنحنى المخطط. لا يعني تأخراً في تاريخ النهاية." />
          <Metric label="تجاوز تاريخ النهاية الحالي" value={fmtDays(data.overrunDays)} kind="fact"
            tone={data.overrunDays && data.overrunDays > 0 ? "text-red-700 dark:text-red-400" : ""}
            note={<>أيام مضت بعد تاريخ النهاية المجدول الحالي ({fmtDate(data.currentEndDate)}) مع عدم الاكتمال.</>} />
          <Metric label="الإكمال المتوقع (مشروط)" value={forecastText} kind="estimate" note={forecastNote} />
          <Metric label="التأخر المتوقع عن النهاية الحالية" value={data.forecastStatus === "estimated" ? fmtDays(data.forecastDelayDays) : DASH} kind="estimate"
            note={data.expectedProgressAtEnd != null ? `الإنجاز المتوقع عند تاريخ النهاية الحالي: ${fmtNum(data.expectedProgressAtEnd)}%` : "يعتمد على نفس افتراض استمرار المعدل."} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="مكافئ التأخر التقديري فقط" value={fmtDays(data.grossDelayDays)} kind="estimate" />
          <Metric label="صافي التأخر" value={fmtDays(data.netDelayDays)} kind="estimate" note="غير محسوب: الأثر السببي للتوقفات على المسار غير مثبت." />
          <Metric label="مؤشر SPI" value={data.spi == null ? DASH : fmtNum(data.spi)} kind="derived" note="الفعلي ÷ المخطط للنسب فقط، وليس EVM مالياً." />
          <Metric label="تاريخ النهاية الحالي" value={fmtDate(data.currentEndDate)} kind="fact" note="تاريخ مجدول حالي، وليس التاريخ التعاقدي الأصلي." />
        </div>
        <div className="mt-4 flex gap-2 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            هذا التحليل لا يحدد المسار الحرج، ولا يمثل تحليل قيمة مكتسبة مالياً (EVM)، ولا يقرر استحقاق تمديد تعاقدي.
            تاريخ النهاية المستخدم هو تاريخ النهاية المجدول حالياً وقد يختلف عن التاريخ التعاقدي الأصلي.
          </p>
        </div>
      </Section>
    </div>
  );
}

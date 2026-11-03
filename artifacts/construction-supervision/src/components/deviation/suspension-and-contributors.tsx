import type { ActivityDeviation, DeviationAnalysis } from "@workspace/api-client-react";
import { fmtNum, fmtSigned, statusMeta } from "./format";
import { Kind, Section } from "./primitives";

export function SuspensionBlock({ data }: { data: DeviationAnalysis }) {
  const rows = [
    { label: "أيام توقف منقضية (اتحاد الفترات المؤهلة)", v: data.suspensionDays, note: "تُحسب الأيام المتداخلة مرة واحدة فقط." },
    { label: "منها: نُقل الجدول بسببها", v: data.shiftedSuspensionDays, note: "أُزيحت تواريخ الجدول فعلياً بهذه الأيام." },
    { label: "منها: لم يُنقل الجدول", v: data.unshiftedSuspensionDays, note: "مسجلة دون إزاحة للتواريخ." },
    { label: "توقفات بسبب المقاول", v: data.contractorSuspensionDays, note: "لا تُعفى ولا تُخصم من التأخر." },
  ];
  return (
    <Section title="التوقفات" kicker="وقائع مسجلة - بدون استنتاج سببي">
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-2.5">
            <div>
              <dt className="text-sm font-semibold">{r.label}</dt>
              <dd className="text-[11px] text-muted-foreground">{r.note}</dd>
            </div>
            <span className="text-lg font-extrabold tabular-nums">{Math.round(r.v ?? 0)} <span className="text-xs font-semibold text-muted-foreground">يوم</span></span>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        صافي التأخر لا يُحسب بطرح التوقفات، لأن أثرها السببي على تاريخ الإنهاء غير مثبت. <Kind kind="estimate" />
      </p>
    </Section>
  );
}

export function TopContributors({ rows, onPick }: { rows: ActivityDeviation[]; onPick: (name: string) => void }) {
  const negative = rows.filter((r) => r.weightedImpact != null && r.weightedImpact < 0)
    .sort((a, b) => (a.weightedImpact ?? 0) - (b.weightedImpact ?? 0));
  const top = negative.slice(0, 6);
  const maxAbs = Math.abs(top[0]?.weightedImpact ?? 1) || 1;
  return (
    <Section title="أكبر المساهمات في التأخر" kicker="مرتبة حسب الأثر الموزون على المشروع، لا الانحراف النسبي"
      aside={<span className="text-xs text-muted-foreground">يُعرض {top.length} من {negative.length}</span>}>
      {top.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">لا توجد بنود ذات مساهمة سالبة في الانحراف.</p>
      ) : (
        <ol className="space-y-3">
          {top.map((r, i) => (
            <li key={r.activityId}>
              <button type="button" onClick={() => onPick(r.activityName)} className="w-full text-start">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-semibold"><span className="me-2 tabular-nums text-muted-foreground">{i + 1}</span>{r.activityName}</span>
                  <span className="shrink-0 font-bold tabular-nums text-red-700 dark:text-red-400" dir="ltr">{fmtSigned(r.weightedImpact)} ن.م</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-red-600" style={{ width: `${(Math.abs(r.weightedImpact ?? 0) / maxAbs) * 100}%` }} />
                </div>
                <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                  <span>الوزن الفعّال {fmtNum(r.effectiveWeight)}%</span>
                  <span>انحراف البند <span dir="ltr">{fmtSigned(r.deviation)}</span></span>
                  <span>{statusMeta(r.status).short}</span>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

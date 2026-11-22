import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { formatDisplayPercent } from "@/lib/format-display-percent";

export interface ReportPeriodProgress {
  available: boolean;
  asOfDate: string;
  overallProgress: number | null;
  plannedProgress: number | null;
  variance: number | null;
  spi: number | null;
  trackingStartedAt: string | null;
  capturedAt: string | null;
  fingerprint: string | null;
  reason: string | null;
  activitiesCount: number;
  periodStartProgress: number | null;
  periodIncrease: number | null;
  historySource: "actual" | "estimated" | null;
}

export function useReportPeriodProgress(projectId: number, periodEnd: string, enabled: boolean, periodStart?: string) {
  return useQuery({
    queryKey: [`/api/projects/${projectId}/reports/progress-as-of`, periodEnd, periodStart],
    queryFn: () => customFetch<ReportPeriodProgress>(
      `/api/projects/${projectId}/reports/progress-as-of?periodEnd=${encodeURIComponent(periodEnd)}${periodStart ? `&periodStart=${encodeURIComponent(periodStart)}` : ""}`,
      { method: "GET", cache: "no-store" },
    ),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd),
    staleTime: 0,
    retry: false,
  });
}

export interface ReportForecastProgress {
  forecastDraft: true;
  targetDate: string;
  today: string;
  actualAsOfDate: string;
  actualAvailable: boolean;
  actualProgress: number | null;
  plannedProgress: number | null;
  plannedSource: "project_schedule" | "unavailable";
  actualSource: "history" | "estimated_history" | "approved_report" | "unavailable";
  actualReportNumber: number | null;
  manualSuggestion: {
    reportNumber: number;
    progressPercentage: number;
    actualAsOfDate: string;
    reportDate: string;
  } | null;
  activities: Array<{
    id: number;
    name: string;
    plannedProgress: number | null;
    actualProgress: number | null;
    actualAsOfDate: string;
    actualHistoricalUnverified: boolean;
    plannedHistoricalUnverified: boolean;
    status: string;
    forecastStatus: string;
    actualStatus: string | null;
    weight: number;
    sortOrder: number;
    [key: string]: unknown;
  }>;
}

export function useReportForecastProgress(projectId: number, targetDate: string, enabled: boolean, poll = enabled) {
  return useQuery({
    queryKey: [`/api/projects/${projectId}/reports/forecast-as-of`, targetDate],
    queryFn: () => customFetch<ReportForecastProgress>(
      `/api/projects/${projectId}/reports/forecast-as-of?targetDate=${encodeURIComponent(targetDate)}`,
      { method: "GET", cache: "no-store" },
    ),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(targetDate),
    staleTime: 0,
    retry: false,
    refetchInterval: poll ? 60_000 : false,
  });
}

interface Props {
  periodStart: string;
  periodEnd: string;
  data?: ReportPeriodProgress;
  loading: boolean;
  failed: boolean;
  manual: boolean;
  value: number;
  onChange: (value: string) => void;
  onManualChange: () => void;
}

export function ForecastReportProgressField({
  targetDate,
  data,
  loading,
  failed,
}: {
  targetDate: string;
  data?: ReportForecastProgress;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <FormItem className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <FormLabel>معاينة مسودة استشرافية</FormLabel>
      <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
        {!targetDate ? <p>حدد تاريخاً مستقبلياً لمعاينة الجدول.</p>
          : loading ? <p>جارٍ حساب الخطة المتوقعة وقراءة الإنجاز الموثق...</p>
          : failed ? <p className="text-destructive">تعذّر تحميل المعاينة؛ لا تُستخدم بيانات اليوم كتوقع أو كتاريخ سابق.</p>
          : data ? (
            <>
              <p>
                المخطط المتوقع بتاريخ {data.targetDate}: {data.plannedProgress == null
                  ? "غير متاح لعدم اكتمال الجدول"
                  : `${formatDisplayPercent(data.plannedProgress)}، محسوب من جدول المشروع`}
              </p>
              <p>
                {data.actualSource === "estimated_history" ? "النسبة من السجل التاريخي التقديري المراجع" : "الإنجاز الفعلي الموثق"}
                {" "}حتى {data.actualAsOfDate}: {data.actualAvailable && data.actualProgress != null
                  ? formatDisplayPercent(data.actualProgress)
                  : "غير متاح؛ لا توجد تغطية تاريخية موثوقة"}
              </p>
              {data.actualAvailable && data.actualSource === "approved_report" && (
                <p className="font-medium text-emerald-700 dark:text-emerald-300">
                  النسبة محفوظة في التقرير المعتمد رقم {data.actualReportNumber} لنفس التاريخ.
                </p>
              )}
              {data.actualAvailable && data.actualSource === "estimated_history" && (
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  المصدر: سجل تاريخي تقديري تمت مراجعته؛ تبقى قيم الإنجاز لكل بند غير مؤكدة.
                </p>
              )}
              <p className="font-medium text-amber-800 dark:text-amber-300">
                هذه معاينة مستقبلية غير معتمدة. لا تمثل النسبة المخططة إنجازاً فعلياً.
              </p>
              {data.activities.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg border bg-background text-foreground">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="p-2 text-right">البند</th>
                        <th className="p-2 text-center">المخطط المتوقع</th>
                        <th className="p-2 text-center">الفعلي الموثق</th>
                        <th className="p-2 text-center">الحالة المتوقعة</th>
                        <th className="p-2 text-center">الحالة الفعلية المسجلة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activities.map(activity => (
                        <tr key={activity.id} className="border-t">
                          <td className="p-2">{activity.name}</td>
                          <td className="p-2 text-center">
                            {typeof activity.plannedProgress === "number"
                              ? formatDisplayPercent(activity.plannedProgress)
                              : "غير متاح"}
                          </td>
                          <td className="p-2 text-center">
                            {!activity.actualHistoricalUnverified && typeof activity.actualProgress === "number"
                              ? formatDisplayPercent(activity.actualProgress)
                              : "غير متاح"}
                          </td>
                          <td className="p-2 text-center">{forecastStatusLabel(activity.forecastStatus)}</td>
                          <td className="p-2 text-center">
                            {activity.actualStatus ? forecastStatusLabel(activity.actualStatus) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : <p>اختر تاريخاً لعرض المعاينة.</p>}
      </div>
    </FormItem>
  );
}

function forecastStatusLabel(status: string) {
  return ({
    not_started: "لم يبدأ",
    in_progress: "قيد التنفيذ",
    completed: "مكتمل حسب الجدول",
    delayed: "متأخر",
    unknown: "غير متاح",
  } as Record<string, string>)[status] ?? "غير متاح";
}

export function NewReportProgressField({ periodStart, periodEnd, data, loading, failed, manual, value, onChange, onManualChange }: Props) {
  return (
    <FormItem className="sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FormLabel htmlFor="new-report-period-progress">نسبة الإنجاز حتى نهاية الفترة (%)</FormLabel>
        {periodEnd && (
          <Button type="button" variant="outline" size="sm" onClick={onManualChange}>
            {manual ? "استخدام النسبة المقترحة" : data?.available ? "تعديل نسبة التقرير" : "إدخال نسبة التقرير"}
          </Button>
        )}
      </div>
      <Input
        id="new-report-period-progress"
        type="number" min={0} max={100} step="any" dir="ltr"
        value={manual || data?.available ? value : ""}
        onChange={event => onChange(event.target.value)}
        disabled={!manual}
        placeholder="غير متاح تاريخياً"
        aria-describedby="new-report-period-progress-help"
      />
      <div id="new-report-period-progress-help" className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
        {!periodEnd ? <p>حدد نهاية فترة التقرير أولاً.</p>
          : loading && !manual ? <p>جارٍ قراءة سجل الإنجاز حتى نهاية الفترة...</p>
          : failed ? <p className="text-destructive">تعذّر قراءة السجل. لا تُستخدم نسبة المشروع الحالية بديلاً عنه.</p>
          : data?.available ? (
            <>
              <p>{manual ? "نسبة موثّقة مدخلة يدوياً" : "محتسب من سجل جميع البنود وأوزانها"}
                {" "}حتى نهاية {periodEnd} بتوقيت ليبيا، وليس تاريخ إصدار التقرير.</p>
              {!manual && data.historySource === "estimated" && (
                <p className="font-medium text-amber-700">المصدر: سجل تاريخي تقديري تمت مراجعته.</p>
              )}
              {data.plannedProgress !== null && Number.isFinite(Number(value)) && (
                <p>المخطط: {formatDisplayPercent(data.plannedProgress)} — الفارق: {formatDisplayPercent(Number(value) - data.plannedProgress, true)}
                  {" "}— SPI: {data.plannedProgress > 0 ? (Number(value) / data.plannedProgress).toFixed(2) : "غير متاح"}</p>
              )}
              {periodStart && data.periodStartProgress !== null && data.periodIncrease !== null && (
                <p>بداية الفترة: {formatDisplayPercent(data.periodStartProgress)} — التغير خلال الفترة: {formatDisplayPercent(data.periodIncrease, true)} نقطة مئوية.</p>
              )}
            </>
          ) : <p className="text-amber-700 dark:text-amber-400">{data?.reason}</p>}
        {data?.trackingStartedAt && (
          <p>بداية السجل المتاح: {new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "medium" }).format(new Date(data.trackingStartedAt))}.</p>
        )}
        {manual && <p>أدخل الإنجاز التراكمي حتى نهاية الفترة، لا إنجاز الفترة وحدها. تُحفظ النسبة في هذا التقرير فقط، ولا تغيّر إنجاز المشروع أو نسب بنوده.</p>}
      </div>
      <FormMessage />
    </FormItem>
  );
}

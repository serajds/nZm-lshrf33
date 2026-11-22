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

interface Props {
  periodStart: string;
  periodEnd: string;
  data?: ReportPeriodProgress;
  loading: boolean;
  failed: boolean;
  manual: boolean;
  value?: number;
  onChange: (value: string) => void;
  onManualChange: () => void;
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
        value={manual || data?.available ? value ?? "" : ""}
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

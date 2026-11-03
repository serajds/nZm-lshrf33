import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetProject,
  useGetProjectDeviation,
  useGetProjectDeviationTimeline,
  getGetProjectQueryKey,
  getGetProjectDeviationQueryKey,
  getGetProjectDeviationTimelineQueryKey,
} from "@workspace/api-client-react";
import { ArrowRight, RotateCw, Lock } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTabAccess } from "@/hooks/use-tab-access";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExecutiveSummary } from "@/components/deviation/executive-summary";
import { SuspensionBlock, TopContributors } from "@/components/deviation/suspension-and-contributors";
import { TimelineChart } from "@/components/deviation/timeline-chart";
import { ActivitiesTable } from "@/components/deviation/activities-table";
import { Section } from "@/components/deviation/primitives";
import { fmtNum, fmtSigned } from "@/components/deviation/format";

const PARAMS = { curve: "linear" } as const;

function ErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-600/30 bg-red-50 p-6 text-center text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
      <p>{text}</p>
      <Button variant="outline" size="sm" onClick={onRetry}><RotateCw className="me-1.5 h-4 w-4" />إعادة المحاولة</Button>
    </div>
  );
}

export default function ProjectDeviation() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  usePageTitle("تحليل الانحراف");
  const [search, setSearch] = useState("");

  const { isHidden, isLoading: accessLoading } = useTabAccess(projectId, "deviation", { redirectIfHidden: true });
  const allowed = !!projectId && !accessLoading && !isHidden;

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } });
  const dev = useGetProjectDeviation(projectId, PARAMS, {
    query: { enabled: allowed, queryKey: getGetProjectDeviationQueryKey(projectId, PARAMS) },
  });
  const tl = useGetProjectDeviationTimeline(projectId, PARAMS, {
    query: { enabled: allowed, queryKey: getGetProjectDeviationTimelineQueryKey(projectId, PARAMS) },
  });

  const data = dev.data && dev.data.projectId === projectId ? dev.data : undefined;
  const timeline = tl.data && tl.data.projectId === projectId ? tl.data : undefined;
  const rows = useMemo(() => data?.activitiesAnalysis ?? [], [data]);

  const reconciliation = useMemo(() => {
    if (!data || data.progressDeviation == null) return null;
    const sum = rows.reduce((s, r) => s + (r.weightedImpact ?? 0), 0);
    const diff = Math.abs(sum - data.progressDeviation);
    return { sum, diff, ok: diff <= (data.roundingTolerance ?? 0.01) };
  }, [data, rows]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <div className="page-hero flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="relative z-10 mt-0.5 shrink-0 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="relative z-10 text-lg font-bold leading-tight text-white md:text-2xl">{project?.name ?? "\u00a0"}</h1>
          <p className="relative z-10 mt-1 text-sm text-white/65">تحليل الانحراف: ما سُجّل فعلاً، وما هو تقدير</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {isHidden && !accessLoading ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-10 text-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <p className="font-semibold">لا تملك صلاحية عرض تحليل الانحراف لهذا المشروع.</p>
        </div>
      ) : dev.isError ? (
        <ErrorBox text="تعذر تحميل تحليل الانحراف." onRetry={() => dev.refetch()} />
      ) : !data ? (
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : (
        <>
          <ExecutiveSummary data={data} />

          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Section title="مسار الإنجاز عبر التقارير" kicker="منحنى خطي للمخطط">
              {tl.isError ? <ErrorBox text="تعذر تحميل المسار الزمني." onRetry={() => tl.refetch()} />
                : !timeline ? <Skeleton className="h-[320px] rounded-xl" />
                : <TimelineChart timeline={timeline} />}
            </Section>
            <TopContributors rows={rows} onPick={setSearch} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <SuspensionBlock data={data} />
            <Section title="كيف يُحسب الانحراف" kicker="طريقة الاحتساب">
              <ul className="space-y-2.5 text-sm leading-relaxed">
                <li><strong>الوزن الفعّال</strong> = وزن البند ÷ مجموع أوزان بنود المشروع × 100. للبنود المرتبطة يتوزع وزنها على عناصر المصدر بنفس النسبة.</li>
                <li><strong>انحراف البند</strong> = الفعلي − المخطط، بالنقاط المئوية.</li>
                <li><strong>المساهمة</strong> = انحراف البند × الوزن الفعّال ÷ 100. مجموع المساهمات يساوي انحراف المشروع.</li>
                <li>تُستخدم الدقة الكاملة في الحساب؛ فحص المطابقة أدناه بهامش {fmtNum(data.roundingTolerance ?? 0.01)} نقطة مئوية للقيم الخام. يُقرّب العرض إلى منزلتين؛ جمع القيم المعروضة قد يختلف حتى عدد البنود × 0.005 نقطة.</li>
              </ul>
              {reconciliation && (
                <div className={`mt-4 rounded-lg border p-3 text-xs ${reconciliation.ok ? "border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border-amber-600/40 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}>
                  مجموع المساهمات <span dir="ltr" className="font-bold tabular-nums">{fmtSigned(reconciliation.sum)}</span> مقابل انحراف المشروع{" "}
                  <span dir="ltr" className="font-bold tabular-nums">{fmtSigned(data.progressDeviation)}</span> —{" "}
                  {reconciliation.ok ? "متطابقان ضمن حد التقريب." : `فرق ${fmtNum(reconciliation.diff, 4)} يتجاوز حد التقريب؛ راجع البيانات.`}
                </div>
              )}
            </Section>
          </div>

          <Section title="تحليل البنود" kicker="البيانات الفعلية تبقى ظاهرة حتى دون جدول زمني">
            <ActivitiesTable rows={rows} search={search} setSearch={setSearch} />
          </Section>
        </>
      )}
    </div>
  );
}

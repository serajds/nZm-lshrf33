import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useGetProjectDeviation,
  useGetProjectDeviationTimeline,
  useGetProject,
} from "@workspace/api-client-react";
import type { ActivityDeviation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectNav } from "@/components/project-nav";
import {
  ArrowRight, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2, Clock,
  CalendarOff, BarChart3, Activity, Gauge, Lightbulb, CalendarClock, Target,
  Download, LineChart as LineChartIcon, Info,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  LineChart, Line, Legend, PieChart, Pie,
} from "recharts";

type CurveType = "linear" | "scurve";

const SUSPENSION_LABELS: Record<string, string> = {
  official_holiday: "إجازات رسمية",
  force_majeure: "قوة قاهرة",
  contractor_delay: "تأخير المقاول",
};
const SUSPENSION_COLORS: Record<string, string> = {
  official_holiday: "hsl(217, 91%, 60%)",
  force_majeure: "hsl(38, 92%, 50%)",
  contractor_delay: "hsl(0, 84%, 60%)",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

export default function ProjectDeviation() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  usePageTitle("الانحرافات");

  const [curve, setCurve] = useState<CurveType>("linear");

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: deviationData, isLoading } = useGetProjectDeviation(
    projectId,
    { curve },
    { query: { enabled: !!projectId } },
  );
  const { data: timelineData } = useGetProjectDeviationTimeline(
    projectId,
    { curve },
    { query: { enabled: !!projectId } },
  );

  const isNoSchedule = deviationData?.noSchedule === true;

  const exportExcel = async () => {
    if (!deviationData) return;
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const summary = [
      ["تحليل الانحراف للمشروع", project?.name || ""],
      ["تاريخ التقرير", new Date().toLocaleDateString("ar-EG")],
      ["نموذج المنحنى المخطط", curve === "scurve" ? "S-Curve" : "خطي"],
      [],
      ["المؤشر", "القيمة"],
      ["الإنجاز المخطط %", deviationData.plannedProgress ?? 0],
      ["الإنجاز الفعلي %", deviationData.actualProgress ?? 0],
      ["انحراف الإنجاز %", deviationData.progressDeviation ?? 0],
      ["مؤشر أداء الجدول SPI", deviationData.spi ?? "—"],
      ["إجمالي الانحراف (يوم)", deviationData.grossDelayDays ?? 0],
      ["أيام التوقف المعتمدة", deviationData.suspensionDays ?? 0],
      ["صافي الانحراف (يوم)", deviationData.netDelayDays ?? 0],
      ["تجاوز المدة التعاقدية (يوم)", deviationData.overrunDays ?? 0],
      ["تاريخ الإكمال المتوقع", deviationData.forecastCompletionDate ?? "—"],
      ["تأخر متوقع عن التعاقدي (يوم)", deviationData.forecastDelayDays ?? 0],
      ["الإنجاز المتوقع عند نهاية العقد %", deviationData.expectedProgressAtEnd ?? 0],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary["!cols"] = [{ wch: 36 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "ملخص الانحراف");

    const actsHeader = ["البند", "الوزن", "المخطط %", "الفعلي %", "الانحراف %", "الأثر الموزون %", "تجاوز المدة (يوم)"];
    const actsRows = (deviationData.activitiesAnalysis ?? []).map(a => [
      a.activityName,
      (a as any).weight ?? 1,
      a.plannedProgress,
      a.actualProgress,
      a.deviation,
      (a as any).weightedImpact ?? 0,
      a.overrunDays ?? "—",
    ]);
    const wsActs = XLSX.utils.aoa_to_sheet([actsHeader, ...actsRows]);
    wsActs["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsActs, "تفاصيل البنود");

    if (timelineData?.points && timelineData.points.length > 0) {
      const tHeader = ["التاريخ", "المخطط %", "الفعلي %", "الانحراف %"];
      const tRows = timelineData.points.map(p => [p.date, p.plannedProgress, p.actualProgress, p.deviation]);
      const wsT = XLSX.utils.aoa_to_sheet([tHeader, ...tRows]);
      wsT["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, wsT, "تطور الانحراف");
    }

    XLSX.writeFile(wb, `تحليل_الانحراف_${project?.name || "مشروع"}.xlsx`);
  };

  const chartData = useMemo(() => (deviationData?.activitiesAnalysis ?? [])
    .slice()
    .sort((a, b) => a.deviation - b.deviation)
    .map((a: ActivityDeviation) => ({
      name: a.activityName.length > 22 ? a.activityName.substring(0, 20) + '…' : a.activityName,
      fullName: a.activityName,
      planned: a.plannedProgress,
      actual: a.actualProgress,
      deviation: a.deviation,
      weightedImpact: (a as any).weightedImpact ?? 0,
    })), [deviationData]);

  const timelinePoints = useMemo(() => (timelineData?.points ?? []).map(p => ({
    date: p.date,
    label: new Date(p.date).toLocaleDateString("ar-EG", { month: "short", day: "numeric" }),
    planned: p.plannedProgress,
    actual: p.actualProgress,
    deviation: p.deviation,
  })), [timelineData]);

  const suspensionsData = useMemo(() => (deviationData?.suspensionsBreakdown ?? []).map(b => ({
    name: SUSPENSION_LABELS[b.type] || b.type,
    type: b.type,
    value: b.days,
    count: b.count,
    fill: SUSPENSION_COLORS[b.type] || "hsl(var(--muted))",
  })), [deviationData]);

  if (isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-sm text-muted-foreground">جاري تحليل بيانات الانحراف...</span>
        </div>
      </div>
    );
  }

  if (isNoSchedule) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start gap-3">
          <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
            <ArrowRight className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">تحليل الانحراف عن الجدول الزمني</p>
          </div>
        </div>
        <ProjectNav projectId={projectId} />
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="p-4 rounded-full bg-muted">
            <CalendarOff className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold text-muted-foreground">مشروع بدون جدول زمني معتمد</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            هذا المشروع لا يحتوي على جدول زمني معتمد، لذلك لا يتم حساب التأخير أو الانحرافات الزمنية.
          </p>
        </div>
      </div>
    );
  }

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'on_track': return { label: 'على المسار الصحيح', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800', icon: CheckCircle2, accent: 'from-emerald-400 to-emerald-600' };
      case 'ahead': return { label: 'متقدم عن الجدول الزمني', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800', icon: TrendingUp, accent: 'from-blue-400 to-blue-600' };
      case 'slightly_delayed': return { label: 'انحراف بسيط عن الخطة', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800', icon: TrendingDown, accent: 'from-amber-400 to-amber-600' };
      case 'significantly_delayed': return { label: 'انحراف كبير - يتطلب تدخلاً عاجلاً', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800', icon: AlertTriangle, accent: 'from-red-400 to-red-600' };
      default: return { label: status, color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: AlertTriangle, accent: 'from-gray-400 to-gray-600' };
    }
  };

  const statusInfo = deviationData ? getStatusInfo(deviationData.status) : null;
  const StatusIcon = statusInfo?.icon || AlertTriangle;

  const criticalActivities = (deviationData?.activitiesAnalysis ?? [])
    .filter((a: ActivityDeviation) => a.deviation < -5)
    .sort((a: ActivityDeviation, b: ActivityDeviation) => a.deviation - b.deviation);

  const aheadActivities = (deviationData?.activitiesAnalysis ?? [])
    .filter((a: ActivityDeviation) => a.deviation > 5)
    .sort((a: ActivityDeviation, b: ActivityDeviation) => b.deviation - a.deviation);

  const progressDev = deviationData?.progressDeviation ?? 0;
  const plannedProgress = deviationData?.plannedProgress ?? 0;
  const actualProgress = deviationData?.actualProgress ?? 0;
  const suspensionDays = deviationData?.suspensionDays ?? 0;
  const grossDelayDays = deviationData?.grossDelayDays ?? 0;
  const netDelayDays = deviationData?.netDelayDays ?? 0;
  const overrunDays = deviationData?.overrunDays ?? 0;
  const spi = deviationData?.spi ?? null;
  const forecastCompletionDate = deviationData?.forecastCompletionDate ?? null;
  const forecastDelayDays = deviationData?.forecastDelayDays ?? 0;
  const expectedProgressAtEnd = deviationData?.expectedProgressAtEnd ?? 0;
  const contractEndDate = deviationData?.contractEndDate ?? null;
  const recommendations = deviationData?.recommendations ?? [];

  const spiColor = spi == null ? 'text-muted-foreground' : spi >= 1 ? 'text-emerald-600 dark:text-emerald-400' : spi >= 0.9 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">تحليل الانحراف عن الجدول الزمني</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={curve} onValueChange={(v) => setCurve(v as CurveType)}>
            <SelectTrigger className="w-[180px]" dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="linear">منحنى خطي</SelectItem>
              <SelectItem value="scurve">منحنى S-Curve</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!deviationData}>
            <Download className="h-4 w-4 ml-1" />
            تصدير Excel
          </Button>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {deviationData && statusInfo && (
        <div className="space-y-6">
          {/* HERO STATUS BANNER */}
          <div className={`relative overflow-hidden p-5 md:p-6 rounded-2xl border-2 ${statusInfo.bg}`}>
            <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l ${statusInfo.accent}`} />
            <div className="flex flex-wrap items-center gap-4">
              <div className={`p-4 rounded-2xl bg-white/70 dark:bg-black/20 ${statusInfo.color}`}>
                <StatusIcon className="h-8 w-8" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <h2 className={`text-xl md:text-2xl font-bold ${statusInfo.color}`}>{statusInfo.label}</h2>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
                  <span>المخطط: <strong className="text-foreground">{plannedProgress.toFixed(1)}%</strong></span>
                  <span>الفعلي: <strong className="text-foreground">{actualProgress.toFixed(1)}%</strong></span>
                  <span>الفرق: <strong className={progressDev >= 0 ? 'text-emerald-600' : 'text-red-600'} dir="ltr">{progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%</strong></span>
                </div>
              </div>
              <div className="text-center">
                <div className={`text-4xl md:text-5xl font-black ${statusInfo.color}`} dir="ltr">
                  {progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">انحراف الإنجاز</p>
              </div>
            </div>
          </div>

          {/* KPI GRID */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={Gauge} label="مؤشر الأداء SPI" value={spi == null ? '—' : spi.toFixed(2)} hint={spi == null ? '' : spi >= 1 ? 'متفوق' : spi >= 0.9 ? 'مقبول' : 'ضعيف'} valueClass={spiColor} accent="from-cyan-400 to-cyan-600" />
            <KpiCard icon={Clock} label="إجمالي الانحراف" value={`${grossDelayDays}`} unit="يوم" valueClass={grossDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-amber-400 to-amber-600" />
            <KpiCard icon={CalendarOff} label="أيام التوقف" value={`${suspensionDays}`} unit="يوم" valueClass="text-purple-600" accent="from-purple-400 to-purple-600" />
            <KpiCard icon={Activity} label="صافي الانحراف" value={`${netDelayDays}`} unit="يوم" hint="بعد خصم التوقفات" valueClass={netDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-rose-400 to-rose-600" />
            <KpiCard icon={CalendarClock} label="تجاوز المدة" value={`${overrunDays}`} unit="يوم" hint="بعد الموعد التعاقدي" valueClass={overrunDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-red-400 to-red-600" />
            <KpiCard icon={Target} label="إنجاز متوقع نهاية العقد" value={`${expectedProgressAtEnd.toFixed(0)}%`} hint={contractEndDate ? fmtDate(contractEndDate) : ''} valueClass={expectedProgressAtEnd >= 99 ? 'text-emerald-600' : expectedProgressAtEnd >= 90 ? 'text-amber-600' : 'text-red-600'} accent="from-indigo-400 to-indigo-600" />
          </div>

          {/* FORECAST CARD */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">تاريخ الإكمال التعاقدي</p>
                    <p className="font-semibold">{fmtDate(contractEndDate)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-lg ${forecastDelayDays > 0 ? 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'}`}>
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">تاريخ الإكمال المتوقع</p>
                    <p className="font-semibold">{fmtDate(forecastCompletionDate)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-lg ${forecastDelayDays > 0 ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400' : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'}`}>
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التأخر المتوقع</p>
                    <p className={`font-semibold ${forecastDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {forecastDelayDays > 0 ? `${forecastDelayDays} يوم متأخر` : 'في الموعد'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* RECOMMENDATIONS */}
          {recommendations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-5 w-5 text-amber-500" />
                  توصيات تلقائية
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {recommendations.map((rec, idx) => {
                    const sevColor = rec.severity === 'critical'
                      ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20'
                      : rec.severity === 'warning'
                      ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20'
                      : 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20';
                    const SevIcon = rec.severity === 'critical' ? AlertTriangle : rec.severity === 'warning' ? TrendingDown : Info;
                    const iconColor = rec.severity === 'critical' ? 'text-red-600' : rec.severity === 'warning' ? 'text-amber-600' : 'text-blue-600';
                    return (
                      <div key={idx} className={`p-3 rounded-lg border ${sevColor}`}>
                        <div className="flex items-start gap-2">
                          <SevIcon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">{rec.title}</p>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.description}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* TIMELINE CHART */}
          {timelinePoints.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LineChartIcon className="h-5 w-5 text-primary" />
                    تطور الانحراف عبر الزمن
                  </CardTitle>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> المخطط</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> الفعلي</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> الانحراف</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timelinePoints} margin={{ top: 10, right: 10, left: 10, bottom: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        contentStyle={{
                          textAlign: 'right', direction: 'rtl', borderRadius: '8px',
                          border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px',
                        }}
                        formatter={(v: number, name: string) => [`${v}%`, name === 'planned' ? 'المخطط' : name === 'actual' ? 'الفعلي' : 'الانحراف']}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                      <Line type="monotone" dataKey="planned" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={{ r: 3 }} name="planned" />
                      <Line type="monotone" dataKey="actual" stroke="hsl(160, 84%, 39%)" strokeWidth={2} dot={{ r: 3 }} name="actual" />
                      <Line type="monotone" dataKey="deviation" stroke="hsl(0, 84%, 60%)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 2 }} name="deviation" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TWO-COL: planned vs actual + suspension breakdown */}
          <div className="grid gap-6 lg:grid-cols-3">
            {chartData.length > 0 && (
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      مقارنة الإنجاز المخطط والفعلي حسب البند
                    </CardTitle>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> المخطط</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> الفعلي</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-[340px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} interval={0} fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                          contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px' }}
                          formatter={(v: number, name: string) => [`${v}%`, name === 'planned' ? 'المخطط' : 'الفعلي']}
                          labelFormatter={(label: string) => {
                            const item = chartData.find((c: any) => c.name === label);
                            return item?.fullName || label;
                          }}
                        />
                        <Bar dataKey="planned" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="planned" />
                        <Bar dataKey="actual" fill="hsl(160, 84%, 39%)" radius={[4, 4, 0, 0]} name="actual" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarOff className="h-5 w-5 text-primary" />
                  تفصيل أيام التوقف
                </CardTitle>
              </CardHeader>
              <CardContent>
                {suspensionsData.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد فترات توقف مسجلة</p>
                  </div>
                ) : (
                  <>
                    <div className="h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={suspensionsData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                            {suspensionsData.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px' }}
                            formatter={(v: number, _n: string, p: any) => [`${v} يوم (${p.payload.count} فترة)`, p.payload.name]}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 space-y-2">
                      {suspensionsData.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.fill }} />
                            {s.name}
                          </span>
                          <span className="text-muted-foreground"><strong className="text-foreground">{s.value}</strong> يوم</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* DEVIATION BAR CHART (per activity) */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5 text-primary" />
                  انحراف كل بند عن المخطط
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }} barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} interval={0} fontSize={10} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tickFormatter={(v) => `${v}%`} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        cursor={{ fill: 'transparent' }}
                        contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px' }}
                        formatter={(v: number, name: string) => [`${v}%`, name === 'deviation' ? 'الانحراف' : 'الأثر الموزون']}
                        labelFormatter={(label: string) => {
                          const item = chartData.find((c: any) => c.name === label);
                          return item?.fullName || label;
                        }}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="deviation" radius={[4, 4, 0, 0]} name="deviation">
                        {chartData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.deviation < -10 ? 'hsl(0, 84%, 60%)' : entry.deviation < 0 ? 'hsl(38, 92%, 50%)' : 'hsl(160, 84%, 39%)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* CRITICAL & AHEAD ACTIVITIES */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className={criticalActivities.length > 0 ? 'border-red-200 dark:border-red-900' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className={`h-5 w-5 ${criticalActivities.length > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                  البنود الحرجة المتأخرة
                  {criticalActivities.length > 0 && (
                    <Badge variant="destructive" className="mr-2">{criticalActivities.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {criticalActivities.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد بنود متأخرة بشكل حرج</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                    {criticalActivities.map((activity: ActivityDeviation, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <span className="font-medium text-sm">{activity.activityName}</span>
                          <Badge variant="destructive" className="text-xs shrink-0" dir="ltr">{activity.deviation}%</Badge>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>المخطط: {activity.plannedProgress}%</span>
                            <span>الفعلي: {activity.actualProgress}%</span>
                          </div>
                          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                            <div className="absolute inset-y-0 right-0 bg-blue-400/40 rounded-full" style={{ width: `${activity.plannedProgress}%` }} />
                            <div className="absolute inset-y-0 right-0 bg-red-500 rounded-full" style={{ width: `${activity.actualProgress}%` }} />
                          </div>
                        </div>
                        {activity.overrunDays != null && activity.overrunDays > 0 && (
                          <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            تجاوز المدة: {activity.overrunDays} يوم بعد التاريخ المخطط
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={aheadActivities.length > 0 ? 'border-emerald-200 dark:border-emerald-900' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className={`h-5 w-5 ${aheadActivities.length > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                  البنود المتقدمة
                  {aheadActivities.length > 0 && (
                    <Badge className="mr-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">{aheadActivities.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aheadActivities.length === 0 ? (
                  <div className="text-center py-8">
                    <TrendingDown className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد بنود متقدمة عن الجدول</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                    {aheadActivities.map((activity: ActivityDeviation, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <span className="font-medium text-sm">{activity.activityName}</span>
                          <Badge className="text-xs shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" dir="ltr">+{activity.deviation}%</Badge>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>المخطط: {activity.plannedProgress}%</span>
                            <span>الفعلي: {activity.actualProgress}%</span>
                          </div>
                          <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                            <div className="absolute inset-y-0 right-0 bg-blue-400/40 rounded-full" style={{ width: `${activity.plannedProgress}%` }} />
                            <div className="absolute inset-y-0 right-0 bg-emerald-500 rounded-full" style={{ width: `${activity.actualProgress}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* DETAILED TABLE WITH WEIGHT & WEIGHTED IMPACT */}
          {(deviationData?.activitiesAnalysis ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  جدول تفصيلي مع الأوزان والأثر الموزون
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-3 px-3 text-right font-medium">البند</th>
                        <th className="py-3 px-3 text-center font-medium">الوزن</th>
                        <th className="py-3 px-3 text-center font-medium">المخطط</th>
                        <th className="py-3 px-3 text-center font-medium">الفعلي</th>
                        <th className="py-3 px-3 text-center font-medium">الانحراف</th>
                        <th className="py-3 px-3 text-center font-medium">الأثر الموزون</th>
                        <th className="py-3 px-3 text-center font-medium">تجاوز المدة</th>
                        <th className="py-3 px-3 text-center font-medium w-40">مؤشر الأداء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(deviationData.activitiesAnalysis as ActivityDeviation[]).map((a, idx) => {
                        const weight = (a as any).weight ?? 1;
                        const wImpact = (a as any).weightedImpact ?? 0;
                        const devColor = a.deviation < -10 ? 'text-red-600' : a.deviation < 0 ? 'text-amber-600' : a.deviation > 0 ? 'text-emerald-600' : 'text-muted-foreground';
                        const impactColor = wImpact < -1 ? 'text-red-600' : wImpact < 0 ? 'text-amber-600' : wImpact > 0 ? 'text-emerald-600' : 'text-muted-foreground';
                        const barColor = a.deviation < -10 ? 'bg-red-500' : a.deviation < 0 ? 'bg-amber-500' : 'bg-emerald-500';
                        return (
                          <tr key={idx} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-3 px-3 font-medium">{a.activityName}</td>
                            <td className="py-3 px-3 text-center" dir="ltr">{weight}</td>
                            <td className="py-3 px-3 text-center" dir="ltr">{a.plannedProgress}%</td>
                            <td className="py-3 px-3 text-center" dir="ltr">{a.actualProgress}%</td>
                            <td className={`py-3 px-3 text-center font-bold ${devColor}`} dir="ltr">
                              {a.deviation > 0 ? '+' : ''}{a.deviation}%
                            </td>
                            <td className={`py-3 px-3 text-center font-semibold ${impactColor}`} dir="ltr">
                              {wImpact > 0 ? '+' : ''}{wImpact}%
                            </td>
                            <td className="py-3 px-3 text-center" dir="ltr">
                              {(() => {
                                const ov = a.overrunDays;
                                if (ov == null) return <span className="text-muted-foreground">—</span>;
                                if (ov === 0) return <span className="text-emerald-600">—</span>;
                                return <span className="font-bold text-red-600">{ov} يوم</span>;
                              })()}
                            </td>
                            <td className="py-3 px-3">
                              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                                <div className={`absolute inset-y-0 right-0 ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(100, a.actualProgress)}%` }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!deviationData && !isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">لا تتوفر بيانات كافية</h3>
            <p className="text-sm text-muted-foreground">يرجى التأكد من وجود بنود أعمال مسجلة في المشروع لعرض تحليل الانحراف.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon, label, value, unit, hint, valueClass, accent,
}: {
  icon: any; label: string; value: string; unit?: string; hint?: string; valueClass?: string; accent: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-l ${accent}`} />
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${valueClass ?? ''}`} dir="ltr">
          {value}
          {unit && <span className="text-sm font-normal mr-1">{unit}</span>}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

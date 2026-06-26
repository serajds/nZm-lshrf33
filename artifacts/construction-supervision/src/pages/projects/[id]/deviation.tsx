import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useGetProjectDeviation,
  useGetProjectDeviationTimeline,
  useGetProject,
} from "@workspace/api-client-react";
import { useTabAccess } from "@/hooks/use-tab-access";
import type { ActivityDeviation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import {
  ArrowRight, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2, Clock,
  CalendarOff, BarChart3, Activity, Gauge, Lightbulb, CalendarClock, Target,
  LineChart as LineChartIcon, Info, Filter,
  type LucideIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  LineChart, Line, Legend, PieChart, Pie, AreaChart, Area
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";

type ChartRow = {
  name: string;
  fullName: string;
  planned: number;
  actual: number;
  deviation: number;
  weightedImpact: number;
};

type SuspensionRow = {
  name: string;
  type: string;
  value: number;
  count: number;
  fill: string;
};

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
    return new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }
};

export default function ProjectDeviation() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  usePageTitle("تحليل الانحراف");

  const [sortKey, setSortKey] = useState<"default" | "name" | "weight" | "planned" | "actual" | "deviation" | "weightedImpact" | "overrun">("default");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activityFilter, setActivityFilter] = useState<"all" | "critical" | "ahead">("all");

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { isHidden } = useTabAccess(projectId, "deviation", { redirectIfHidden: true });

  const { data: deviationData, isLoading } = useGetProjectDeviation(
    projectId,
    { curve: "linear" },
    {
      query: {
        enabled: !!projectId,
        placeholderData: (prev: any) => prev,
      } as any,
    },
  );
  
  const { data: timelineData } = useGetProjectDeviationTimeline(
    projectId,
    { curve: "linear" },
    {
      query: {
        enabled: !!projectId,
        placeholderData: (prev: any) => prev,
      } as any,
    },
  );

  const isNoSchedule = deviationData?.noSchedule === true;

  const chartData = useMemo(() => (deviationData?.activitiesAnalysis ?? [])
    .slice()
    .sort((a, b) => a.deviation - b.deviation)
    .map((a: ActivityDeviation) => ({
      name: a.activityName.length > 22 ? a.activityName.substring(0, 20) + '…' : a.activityName,
      fullName: a.activityName,
      planned: a.plannedProgress,
      actual: a.actualProgress,
      deviation: a.deviation,
      weightedImpact: a.weightedImpact ?? 0,
    })), [deviationData]);

  const timelinePoints = useMemo(() => (timelineData?.points ?? []).map(p => ({
    date: p.date,
    label: new Date(p.date).toLocaleDateString("ar-EG-u-nu-latn", { month: "short", day: "numeric" }),
    planned: p.plannedProgress,
    actual: p.actualProgress,
    deviation: p.deviation,
  })), [timelineData]);

  const sortedActivities = useMemo<ActivityDeviation[]>(() => {
    let list = (deviationData?.activitiesAnalysis ?? []).slice() as ActivityDeviation[];
    
    if (activityFilter === "critical") list = list.filter(a => a.deviation < -5);
    else if (activityFilter === "ahead") list = list.filter(a => a.deviation > 5);

    if (sortKey === "default") return list;
    
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortKey) {
        case "name": av = a.activityName; bv = b.activityName; break;
        case "weight": av = a.weight ?? 1; bv = b.weight ?? 1; break;
        case "planned": av = a.plannedProgress; bv = b.plannedProgress; break;
        case "actual": av = a.actualProgress; bv = b.actualProgress; break;
        case "weightedImpact": av = a.weightedImpact ?? 0; bv = b.weightedImpact ?? 0; break;
        case "overrun": av = a.overrunDays ?? -1; bv = b.overrunDays ?? -1; break;
        default: av = a.deviation; bv = b.deviation;
      }
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv, "ar") * dir;
      return ((av as number) - (bv as number)) * dir;
    });
    return list;
  }, [deviationData, sortKey, sortDir, activityFilter]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  
  const sortIndicator = (key: typeof sortKey) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const suspensionsData = useMemo<SuspensionRow[]>(() => (deviationData?.suspensionsBreakdown ?? []).map(b => ({
    name: SUSPENSION_LABELS[b.type] || b.type,
    type: b.type,
    value: b.days,
    count: b.count,
    fill: SUSPENSION_COLORS[b.type] || "hsl(var(--muted))",
  })), [deviationData]);

  if (isLoading && !deviationData) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <motion.span className="absolute inset-0 border-4 border-primary/20 rounded-full"></motion.span>
            <motion.span 
              className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full"
              animate={{ rotate: 360 }} 
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
          </div>
          <span className="text-sm font-medium text-muted-foreground animate-pulse">جاري تحليل بيانات الانحراف...</span>
        </div>
      </div>
    );
  }

  if (isNoSchedule) {
    return (
      <motion.div initial="hidden" animate="visible" variants={containerVariants} className="space-y-6">
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
        <motion.div variants={itemVariants} className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="p-5 rounded-full bg-muted/50 border border-border/50">
            <CalendarOff className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold text-muted-foreground">مشروع بدون جدول زمني معتمد</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            هذا المشروع لا يحتوي على جدول زمني معتمد، لذلك لا يتم حساب التأخير أو الانحرافات الزمنية.
          </p>
        </motion.div>
      </motion.div>
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
    <motion.div initial="hidden" animate="visible" variants={containerVariants} className="space-y-6 relative pb-10">
      {/* Decorative Orbs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute top-40 right-10 w-72 h-72 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none -z-10" />

      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">تحليل الانحراف والتنبؤ الزمني (EVM)</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {deviationData && statusInfo && (
        <div className="space-y-8">
          {/* HERO STATUS BANNER */}
          <motion.div variants={itemVariants} className={`relative overflow-hidden p-6 md:p-8 rounded-3xl border ${statusInfo.bg} shadow-lg shadow-${statusInfo.color.split('-')[1]}-500/10`}>
            <div className={`absolute inset-x-0 top-0 h-2 bg-gradient-to-l ${statusInfo.accent}`} />
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/20 dark:bg-black/10 rounded-full blur-2xl pointer-events-none" />
            
            <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
              <div className={`p-5 rounded-2xl bg-white/80 dark:bg-black/30 backdrop-blur-md shadow-sm border border-white/20 ${statusInfo.color}`}>
                <StatusIcon className="h-10 w-10" />
              </div>
              <div className="flex-1 text-center md:text-right">
                <h2 className={`text-2xl md:text-3xl font-extrabold ${statusInfo.color}`}>{statusInfo.label}</h2>
                <div className="flex flex-wrap justify-center md:justify-start gap-x-8 gap-y-3 mt-4 text-sm font-medium text-muted-foreground">
                  <div className="flex items-center gap-2 bg-white/50 dark:bg-black/20 px-3 py-1.5 rounded-lg border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    <span>المخطط: <strong className="text-foreground text-base tabular-nums">{plannedProgress.toFixed(1)}%</strong></span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/50 dark:bg-black/20 px-3 py-1.5 rounded-lg border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>الفعلي: <strong className="text-foreground text-base tabular-nums">{actualProgress.toFixed(1)}%</strong></span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/50 dark:bg-black/20 px-3 py-1.5 rounded-lg border border-white/10">
                    <span className={`w-2 h-2 rounded-full ${progressDev >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                    <span>الفرق: <strong className={`text-base tabular-nums ${progressDev >= 0 ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">{progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%</strong></span>
                  </div>
                </div>
              </div>
              <div className="text-center bg-white/60 dark:bg-black/20 p-5 rounded-2xl border border-white/20 backdrop-blur-sm min-w-[160px]">
                <div className={`text-5xl font-black tabular-nums tracking-tight ${statusInfo.color}`} dir="ltr">
                  {progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%
                </div>
                <p className="text-sm font-semibold text-muted-foreground mt-2 uppercase tracking-wide">انحراف الإنجاز</p>
              </div>
            </div>
          </motion.div>

          {/* KPI GRID */}
          <motion.div variants={itemVariants} className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={Gauge} label="مؤشر الأداء SPI" value={spi == null ? '—' : spi.toFixed(2)} hint={spi == null ? '' : spi >= 1 ? 'متفوق' : spi >= 0.9 ? 'مقبول' : 'ضعيف'} valueClass={spiColor} accent="from-cyan-400 to-blue-500" />
            <KpiCard icon={Clock} label="إجمالي الانحراف" value={`${grossDelayDays}`} unit="يوم" valueClass={grossDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-amber-400 to-orange-500" />
            <KpiCard icon={CalendarOff} label="أيام التوقف" value={`${suspensionDays}`} unit="يوم" valueClass="text-purple-600" accent="from-purple-400 to-fuchsia-500" />
            <KpiCard icon={Activity} label="صافي الانحراف" value={`${netDelayDays}`} unit="يوم" hint="بعد خصم التوقفات" valueClass={netDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-rose-400 to-red-500" />
            <KpiCard icon={CalendarClock} label="تجاوز المدة" value={`${overrunDays}`} unit="يوم" hint="بعد الموعد التعاقدي" valueClass={overrunDays > 0 ? 'text-red-600' : 'text-emerald-600'} accent="from-red-400 to-red-600" />
            <KpiCard icon={Target} label="إنجاز متوقع (النهاية)" value={`${expectedProgressAtEnd.toFixed(0)}%`} hint={contractEndDate ? fmtDate(contractEndDate) : ''} valueClass={expectedProgressAtEnd >= 99 ? 'text-emerald-600' : expectedProgressAtEnd >= 90 ? 'text-amber-600' : 'text-red-600'} accent="from-indigo-400 to-violet-500" />
          </motion.div>

          {/* FORECAST CARD */}
          <motion.div variants={itemVariants}>
            <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-950">
              <CardContent className="p-0">
                <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse border-border">
                  <div className="p-6 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="p-3 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 shadow-inner">
                      <CalendarClock className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">تاريخ الإكمال التعاقدي</p>
                      <p className="text-lg font-bold">{fmtDate(contractEndDate)}</p>
                    </div>
                  </div>
                  <div className="p-6 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`p-3 rounded-2xl shadow-inner ${forecastDelayDays > 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'}`}>
                      <Target className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">تاريخ الإكمال المتوقع (EAC)</p>
                      <p className="text-lg font-bold">{fmtDate(forecastCompletionDate)}</p>
                    </div>
                  </div>
                  <div className="p-6 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className={`p-3 rounded-2xl shadow-inner ${forecastDelayDays > 0 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : forecastDelayDays < 0 ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600'}`}>
                      <Clock className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">الوضع الزمني المتوقع</p>
                      <p className={`text-lg font-bold ${forecastDelayDays > 0 ? 'text-red-600' : forecastDelayDays < 0 ? 'text-indigo-600' : 'text-emerald-600'}`}>
                        {forecastDelayDays > 0 ? `${forecastDelayDays} يوم تأخير` : forecastDelayDays < 0 ? `${Math.abs(forecastDelayDays)} يوم إنجاز مبكر` : 'في الموعد تماماً'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* TIMELINE AREA CHART */}
          {timelinePoints.length > 1 && (
            <motion.div variants={itemVariants}>
              <Card className="shadow-md border-border/50">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <LineChartIcon className="h-5 w-5 text-primary" />
                      تطور الانحراف عبر الزمن (S-Curve)
                    </CardTitle>
                    <div className="flex items-center gap-5 text-sm font-medium bg-muted/50 px-4 py-2 rounded-full">
                      <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" /> المخطط</span>
                      <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" /> الفعلي</span>
                      <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 shadow-sm" /> الانحراف</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-[380px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={timelinePoints} margin={{ top: 10, right: 10, left: 10, bottom: 30 }}>
                        <defs>
                          <linearGradient id="colorPlanned" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                        <XAxis dataKey="label" fontSize={12} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                        <YAxis tickFormatter={(v) => `${v}%`} fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} dx={-10} />
                        <Tooltip
                          contentStyle={{
                            textAlign: 'right', direction: 'rtl', borderRadius: '12px',
                            border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))',
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                            fontSize: '13px', padding: '12px'
                          }}
                          formatter={(v: number, name: string) => [
                            <span className="font-bold tabular-nums">{v}%</span>, 
                            name === 'planned' ? 'المخطط' : name === 'actual' ? 'الفعلي' : 'الانحراف'
                          ]}
                        />
                        <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" opacity={0.5} />
                        <Area type="monotone" dataKey="planned" stroke="hsl(217, 91%, 60%)" fillOpacity={1} fill="url(#colorPlanned)" strokeWidth={3} name="planned" />
                        <Area type="monotone" dataKey="actual" stroke="hsl(160, 84%, 39%)" fillOpacity={1} fill="url(#colorActual)" strokeWidth={3} name="actual" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* TWO-COL: planned vs actual + suspension breakdown */}
          <div className="grid gap-6 xl:grid-cols-3">
            {chartData.length > 0 && (
              <motion.div variants={itemVariants} className="xl:col-span-2">
                <Card className="h-full shadow-md border-border/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        الإنجاز حسب البند
                      </CardTitle>
                      <div className="flex items-center gap-4 text-sm font-medium">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block shadow-sm" /> المخطط</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block shadow-sm" /> الفعلي</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[380px] w-full mt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 80 }} barCategoryGap="20%">
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                          <XAxis dataKey="name" angle={-45} textAnchor="end" height={90} interval={0} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} dy={10} />
                          <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                          <Tooltip
                            cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                            contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '12px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))', fontSize: '13px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(v: number, name: string) => [<strong className="tabular-nums">{v}%</strong>, name === 'planned' ? 'المخطط' : 'الفعلي']}
                            labelFormatter={(label: string) => {
                              const item = chartData.find((c) => c.name === label);
                              return <span className="font-semibold">{item?.fullName || label}</span>;
                            }}
                          />
                          <Bar dataKey="planned" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="planned" />
                          <Bar dataKey="actual" fill="hsl(160, 84%, 39%)" radius={[4, 4, 0, 0]} name="actual" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            <motion.div variants={itemVariants}>
              <Card className="h-full shadow-md border-border/50 bg-gradient-to-b from-card to-muted/20">
                <CardHeader className="pb-4 border-b">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CalendarOff className="h-5 w-5 text-primary" />
                    تحليل التوقفات
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  {suspensionsData.length === 0 ? (
                    <div className="text-center py-16">
                      <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                      </div>
                      <p className="text-base font-semibold">لا توجد فترات توقف</p>
                      <p className="text-sm text-muted-foreground mt-1">المشروع يسير بدون توقفات مسجلة</p>
                    </div>
                  ) : (
                    <>
                      <div className="h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie 
                              data={suspensionsData} 
                              dataKey="value" 
                              nameKey="name" 
                              innerRadius={60} 
                              outerRadius={90} 
                              paddingAngle={3}
                              stroke="none"
                            >
                              {suspensionsData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={entry.fill} className="drop-shadow-sm" />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '12px', border: 'none', background: 'hsl(var(--background))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '13px' }}
                              formatter={(v: number, _n: string, p: { payload: SuspensionRow }) => [<strong className="tabular-nums">{v} يوم</strong>, `(${p.payload.count} فترة) ${p.payload.name}`]}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-6 space-y-3 bg-white dark:bg-black/20 p-4 rounded-xl border border-border/50">
                        {suspensionsData.map((s, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-3 font-medium">
                              <span className="w-3 h-3 rounded-full shadow-sm" style={{ background: s.fill }} />
                              {s.name}
                            </span>
                            <span className="text-muted-foreground"><strong className="text-foreground text-base tabular-nums">{s.value}</strong> يوم</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* CRITICAL & AHEAD ACTIVITIES */}
          <div className="grid gap-6 lg:grid-cols-2">
            <motion.div variants={itemVariants}>
              <Card className={`h-full shadow-md transition-colors ${criticalActivities.length > 0 ? 'border-red-200 dark:border-red-900/50' : 'border-border/50'}`}>
                <CardHeader className={`pb-3 border-b ${criticalActivities.length > 0 ? 'bg-red-50/50 dark:bg-red-950/10' : ''}`}>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className={`p-2 rounded-lg ${criticalActivities.length > 0 ? 'bg-red-100 text-red-600 dark:bg-red-900/40' : 'bg-muted text-muted-foreground'}`}>
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    البنود الحرجة المتأخرة
                    {criticalActivities.length > 0 && (
                      <Badge variant="destructive" className="mr-auto px-3 py-1 shadow-sm text-sm">{criticalActivities.length}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {criticalActivities.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                      </div>
                      <p className="font-semibold text-emerald-600">عمل ممتاز!</p>
                      <p className="text-sm text-muted-foreground mt-1">لا توجد بنود متأخرة بشكل حرج</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[450px] overflow-auto pr-2 custom-scrollbar">
                      <AnimatePresence>
                        {criticalActivities.map((activity: ActivityDeviation, idx: number) => (
                          <motion.div 
                            key={activity.activityId}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 rounded-xl border border-red-100 dark:border-red-900/40 bg-gradient-to-r from-red-50/80 to-white dark:from-red-950/20 dark:to-background shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l-xl"></div>
                            <div className="flex justify-between items-start gap-3 mb-3">
                              <span className="font-bold text-sm leading-tight text-foreground">{activity.activityName}</span>
                              <Badge variant="destructive" className="text-sm shrink-0 shadow-sm" dir="ltr">{activity.deviation}%</Badge>
                            </div>
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                                <span>المخطط: <span className="text-blue-600 dark:text-blue-400">{activity.plannedProgress}%</span></span>
                                <span>الفعلي: <span className="text-red-600 dark:text-red-400">{activity.actualProgress}%</span></span>
                              </div>
                              <div className="relative h-2.5 rounded-full bg-muted/50 overflow-hidden inset-shadow-sm">
                                <div className="absolute inset-y-0 right-0 bg-blue-500/30 rounded-full" style={{ width: `${activity.plannedProgress}%` }} />
                                <div className="absolute inset-y-0 right-0 bg-red-500 rounded-full shadow-sm" style={{ width: `${activity.actualProgress}%` }} />
                              </div>
                            </div>
                            {activity.overrunDays != null && activity.overrunDays > 0 && (
                              <div className="mt-3 text-xs font-semibold text-red-600 bg-red-100 dark:bg-red-900/30 px-3 py-2 rounded-lg flex items-center gap-2">
                                <Clock className="h-4 w-4 shrink-0" />
                                تجاوز المدة بـ {activity.overrunDays} يوم عن المخطط
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            <motion.div variants={itemVariants}>
              <Card className={`h-full shadow-md transition-colors ${aheadActivities.length > 0 ? 'border-emerald-200 dark:border-emerald-900/50' : 'border-border/50'}`}>
                <CardHeader className={`pb-3 border-b ${aheadActivities.length > 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/10' : ''}`}>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className={`p-2 rounded-lg ${aheadActivities.length > 0 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40' : 'bg-muted text-muted-foreground'}`}>
                      <TrendingUp className="h-5 w-5" />
                    </div>
                    البنود المتقدمة
                    {aheadActivities.length > 0 && (
                      <Badge className="mr-auto px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm text-sm">
                        {aheadActivities.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {aheadActivities.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <TrendingDown className="h-7 w-7 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">لا توجد بنود متقدمة عن الجدول بشكل ملحوظ</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[450px] overflow-auto pr-2 custom-scrollbar">
                      <AnimatePresence>
                        {aheadActivities.map((activity: ActivityDeviation, idx: number) => (
                          <motion.div 
                            key={activity.activityId}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/40 bg-gradient-to-r from-emerald-50/80 to-white dark:from-emerald-950/20 dark:to-background shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-xl"></div>
                            <div className="flex justify-between items-start gap-3 mb-3">
                              <span className="font-bold text-sm leading-tight text-foreground">{activity.activityName}</span>
                              <Badge className="text-sm shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300 shadow-sm" dir="ltr">+{activity.deviation}%</Badge>
                            </div>
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                                <span>المخطط: <span className="text-blue-600 dark:text-blue-400">{activity.plannedProgress}%</span></span>
                                <span>الفعلي: <span className="text-emerald-600 dark:text-emerald-400">{activity.actualProgress}%</span></span>
                              </div>
                              <div className="relative h-2.5 rounded-full bg-muted/50 overflow-hidden inset-shadow-sm">
                                <div className="absolute inset-y-0 right-0 bg-blue-500/30 rounded-full" style={{ width: `${activity.plannedProgress}%` }} />
                                <div className="absolute inset-y-0 right-0 bg-emerald-500 rounded-full shadow-sm" style={{ width: `${activity.actualProgress}%` }} />
                              </div>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* DETAILED TABLE WITH WEIGHT & WEIGHTED IMPACT */}
          {(deviationData?.activitiesAnalysis ?? []).length > 0 && (
            <motion.div variants={itemVariants}>
              <Card className="shadow-md border-border/50 overflow-hidden">
                <CardHeader className="pb-4 bg-muted/20 border-b">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <BarChart3 className="h-5 w-5 text-primary" />
                      الجدول التفصيلي للانحراف
                    </CardTitle>
                    <div className="flex bg-background p-1 rounded-lg border border-border/50 shadow-sm">
                      <Button 
                        variant={activityFilter === "all" ? "secondary" : "ghost"} 
                        size="sm" 
                        onClick={() => setActivityFilter("all")}
                        className="text-xs px-4"
                      >
                        الكل
                      </Button>
                      <Button 
                        variant={activityFilter === "critical" ? "destructive" : "ghost"} 
                        size="sm" 
                        onClick={() => setActivityFilter("critical")}
                        className="text-xs px-4"
                      >
                        حرجة
                      </Button>
                      <Button 
                        variant={activityFilter === "ahead" ? "default" : "ghost"} 
                        size="sm" 
                        onClick={() => setActivityFilter("ahead")}
                        className={`text-xs px-4 ${activityFilter === "ahead" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}`}
                      >
                        متقدمة
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground border-b border-border/60">
                          <th className="py-4 px-4 text-right font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("name")}>
                            البند <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("name")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("weight")}>
                            الوزن <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("weight")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("planned")}>
                            المخطط <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("planned")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("actual")}>
                            الفعلي <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("actual")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("deviation")}>
                            الانحراف <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("deviation")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("weightedImpact")}>
                            الأثر الموزون <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("weightedImpact")}</span>
                          </th>
                          <th className="py-4 px-3 text-center font-semibold cursor-pointer select-none hover:text-foreground transition-colors group" onClick={() => toggleSort("overrun")}>
                            تجاوز المدة <span className="opacity-50 group-hover:opacity-100 transition-opacity">{sortIndicator("overrun")}</span>
                          </th>
                          <th className="py-4 px-4 text-center font-semibold w-48">مؤشر الإنجاز</th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {sortedActivities.map((a, idx) => {
                            const weight = a.weight ?? 1;
                            const wImpact = a.weightedImpact ?? 0;
                            const devColor = a.deviation < -10 ? 'text-red-600 dark:text-red-400 font-bold' : a.deviation < 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : a.deviation > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-muted-foreground';
                            const impactColor = wImpact < -1 ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : wImpact < 0 ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' : wImpact > 0 ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' : 'text-muted-foreground bg-muted/30';
                            const barColor = a.deviation < -10 ? 'bg-red-500' : a.deviation < 0 ? 'bg-amber-500' : 'bg-emerald-500';
                            return (
                              <motion.tr 
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                key={a.activityId} 
                                className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors group"
                              >
                                <td className="py-4 px-4 font-medium text-foreground">{a.activityName}</td>
                                <td className="py-4 px-3 text-center text-muted-foreground" dir="ltr">{weight}</td>
                                <td className="py-4 px-3 text-center text-blue-600 dark:text-blue-400 font-medium" dir="ltr">{a.plannedProgress}%</td>
                                <td className="py-4 px-3 text-center font-medium" dir="ltr">{a.actualProgress}%</td>
                                <td className={`py-4 px-3 text-center ${devColor}`} dir="ltr">
                                  {a.deviation > 0 ? '+' : ''}{a.deviation}%
                                </td>
                                <td className="py-4 px-3 text-center" dir="ltr">
                                  <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md font-semibold text-xs ${impactColor}`}>
                                    {wImpact > 0 ? '+' : ''}{wImpact}%
                                  </span>
                                </td>
                                <td className="py-4 px-3 text-center" dir="ltr">
                                  {(() => {
                                    const ov = a.overrunDays;
                                    if (ov == null) return <span className="text-muted-foreground/50">—</span>;
                                    if (ov === 0) return <span className="text-emerald-500/80">—</span>;
                                    return <span className="font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2.5 py-1 rounded-md text-xs">{ov} يوم</span>;
                                  })()}
                                </td>
                                <td className="py-4 px-4">
                                  <div className="relative h-2.5 rounded-full bg-muted/60 overflow-hidden inset-shadow-sm group-hover:bg-muted transition-colors">
                                    <div className={`absolute inset-y-0 right-0 ${barColor} rounded-full shadow-sm transition-all duration-1000 ease-out`} style={{ width: `${Math.min(100, a.actualProgress)}%` }} />
                                  </div>
                                </td>
                              </motion.tr>
                            );
                          })}
                        </AnimatePresence>
                        {sortedActivities.length === 0 && (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-muted-foreground">
                              لا توجد بنود تطابق معايير التصفية المحددة.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      )}

      {!deviationData && !isLoading && (
        <motion.div variants={itemVariants}>
          <Card className="border-dashed border-2 bg-muted/10 shadow-none">
            <CardContent className="py-20 text-center">
              <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
                <BarChart3 className="h-10 w-10 text-muted-foreground opacity-50" />
              </div>
              <h3 className="text-xl font-bold mb-3 text-foreground">لا تتوفر بيانات كافية</h3>
              <p className="text-base text-muted-foreground max-w-md mx-auto">يرجى التأكد من وجود بنود أعمال مسجلة ونسب إنجاز في المشروع لعرض تحليل الانحراف المتقدم.</p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}

function KpiCard({
  icon: Icon, label, value, unit, hint, valueClass, accent,
}: {
  icon: LucideIcon; label: string; value: string; unit?: string; hint?: string; valueClass?: string; accent: string;
}) {
  return (
    <Card className="relative overflow-hidden border-0 shadow-md group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 bg-white dark:bg-slate-900">
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l ${accent} opacity-80 group-hover:opacity-100 transition-opacity`} />
      <div className={`absolute -right-6 -top-6 w-20 h-20 bg-gradient-to-br ${accent} rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none`} />
      
      <CardContent className="p-5 relative z-10">
        <div className="flex items-center gap-3 text-muted-foreground mb-4">
          <div className="p-2 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors">
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <div className={`text-3xl font-black tabular-nums tracking-tight mb-1 ${valueClass ?? 'text-foreground'}`} dir="ltr">
          {value}
          {unit && <span className="text-sm font-medium ml-1.5 opacity-70 tracking-normal">{unit}</span>}
        </div>
        {hint ? (
          <p className="text-[11px] font-medium text-muted-foreground mt-2 flex items-center gap-1.5">
            <Info className="h-3 w-3" />
            {hint}
          </p>
        ) : (
          <div className="h-4 mt-2"></div>
        )}
      </CardContent>
    </Card>
  );
}

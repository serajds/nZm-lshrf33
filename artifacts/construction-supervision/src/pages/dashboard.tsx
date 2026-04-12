import { useGetDashboardSummary } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/utils";
import {
  Building2, ActivitySquare, AlertTriangle, CheckCircle2,
  FileText, TrendingUp, PauseCircle, BarChart3, Clock, ChevronLeft
} from "lucide-react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from "recharts";

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; ring: string }> = {
  active:    { label: "نشط",    color: "text-blue-600",   bg: "bg-blue-100",    ring: "ring-blue-400" },
  completed: { label: "مكتمل",  color: "text-emerald-600",bg: "bg-emerald-100", ring: "ring-emerald-400" },
  delayed:   { label: "متأخر",  color: "text-red-600",    bg: "bg-red-100",     ring: "ring-red-400" },
  suspended: { label: "متوقف",  color: "text-orange-600", bg: "bg-orange-100",  ring: "ring-orange-400" },
};

const PIE_COLORS = {
  active:    "hsl(220, 90%, 56%)",
  completed: "hsl(158, 52%, 40%)",
  delayed:   "hsl(0, 72%, 50%)",
  suspended: "hsl(32, 85%, 50%)",
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, color: "text-gray-600", bg: "bg-gray-100", ring: "" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.bg.replace("100", "500")}`} />
      {s.label}
    </span>
  );
}

function ProgressBar({ value, planned, height = "h-2" }: { value: number; planned?: number; height?: string }) {
  return (
    <div className={`relative w-full ${height} bg-gray-100 rounded-full overflow-hidden`}>
      {planned !== undefined && (
        <div
          className="absolute top-0 bottom-0 bg-gray-300 rounded-full transition-all"
          style={{ width: `${Math.min(100, planned)}%` }}
        />
      )}
      <div
        className="absolute top-0 bottom-0 rounded-full transition-all"
        style={{
          width: `${Math.min(100, value)}%`,
          background: value >= 80 ? "hsl(158,52%,42%)" : value >= 50 ? "hsl(220,90%,56%)" : "hsl(0,72%,52%)",
        }}
      />
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  gradient: string;
  sub?: string;
}
function KpiCard({ label, value, icon: Icon, gradient, sub }: KpiCardProps) {
  return (
    <Card className="overflow-hidden border-0 shadow-md">
      <CardContent className="p-0">
        <div className={`${gradient} p-3 sm:p-4 flex items-center justify-between`}>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs font-medium text-white/80 mb-0.5 sm:mb-1 truncate">{label}</p>
            <p className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{value}</p>
            {sub && <p className="text-[10px] sm:text-xs text-white/70 mt-0.5 sm:mt-1 truncate">{sub}</p>}
          </div>
          <div className="bg-white/20 rounded-lg sm:rounded-xl p-2 sm:p-3 shrink-0">
            <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomDonutLabel = ({ viewBox, total }: { viewBox?: { cx: number; cy: number }; total: number }) => {
  const cx = viewBox?.cx ?? 0;
  const cy = viewBox?.cy ?? 0;
  return (
    <>
      <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle" className="fill-foreground" style={{ fontSize: 26, fontWeight: 800, fontFamily: "inherit" }}>
        {total}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" }}>
        مشروع
      </text>
    </>
  );
};

export default function Dashboard() {
  usePageTitle("لوحة التحكم");
  const { user } = useAuth();
  const { data: summary, isLoading } = useGetDashboardSummary();
  const isContractor = user?.role === "contractor" || (user as Record<string, unknown>)?.isContractorCompanyUser === true;
  const getProjectLink = (projectId: number) =>
    isContractor ? `/projects/${projectId}/activities` : `/projects/${projectId}`;

  const today = new Date();
  const dateStr = today.toLocaleDateString("ar-u-nu-latn", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">جاري تحميل لوحة التحكم...</p>
        </div>
      </div>
    );
  }

  const pieData = [
    { name: "نشط",   value: summary?.activeProjects    ?? 0, color: PIE_COLORS.active },
    { name: "مكتمل", value: summary?.completedProjects ?? 0, color: PIE_COLORS.completed },
    { name: "متأخر", value: summary?.delayedProjects   ?? 0, color: PIE_COLORS.delayed },
    { name: "متوقف", value: summary?.suspendedProjects ?? 0, color: PIE_COLORS.suspended },
  ].filter(d => d.value > 0);

  const totalProjects = summary?.totalProjects ?? 0;

  const allProjects = summary?.allProjects ?? [];
  const recentReports = summary?.recentReports ?? [];

  const barData = allProjects.slice(0, 8).map(p => ({
    name: (p.name ?? "").length > 18 ? (p.name ?? "").slice(0, 18) + "…" : (p.name ?? ""),
    فعلي: p.overallProgress ?? 0,
    مخطط: p.plannedProgress ?? 0,
  }));

  const totalActivities   = summary?.totalActivities     ?? 0;
  const completedActs     = summary?.completedActivities  ?? 0;
  const delayedActs       = summary?.delayedActivities    ?? 0;
  const inProgressActs    = summary?.inProgressActivities ?? 0;

  const delayedActivitiesList = summary?.delayedActivitiesList ?? [];

  const actPct = (n: number) => totalActivities > 0 ? Math.round(n / totalActivities * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-xl">
            <BarChart3 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold">لوحة التحكم الرئيسية</h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{dateStr}</p>
          </div>
        </div>
        <Link href="/projects" className="flex items-center gap-1 text-xs sm:text-sm text-primary hover:text-primary/80 font-medium transition-colors shrink-0">
          <span className="hidden sm:inline">عرض جميع</span> المشاريع <ChevronLeft className="h-4 w-4" />
        </Link>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="إجمالي المشاريع"
          value={totalProjects}
          icon={Building2}
          gradient="bg-gradient-to-br from-blue-600 to-blue-800"
          sub={`${summary?.activeProjects ?? 0} نشط حالياً`}
        />
        <KpiCard
          label="متوسط الإنجاز"
          value={`${summary?.averageProgress ?? 0}%`}
          icon={TrendingUp}
          gradient="bg-gradient-to-br from-indigo-600 to-purple-700"
          sub="عبر جميع المشاريع"
        />
        <KpiCard
          label="مشاريع متأخرة"
          value={summary?.delayedProjects ?? 0}
          icon={AlertTriangle}
          gradient={
            (summary?.delayedProjects ?? 0) > 0
              ? "bg-gradient-to-br from-red-500 to-rose-700"
              : "bg-gradient-to-br from-emerald-500 to-green-700"
          }
          sub={(summary?.delayedProjects ?? 0) === 0 ? "لا يوجد تأخير" : "تحتاج متابعة"}
        />
        <KpiCard
          label="التقارير المرفوعة"
          value={summary?.totalReports ?? 0}
          icon={FileText}
          gradient="bg-gradient-to-br from-orange-500 to-amber-700"
          sub="إجمالي التقارير"
        />
      </div>

      {/* ── Secondary Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "مكتملة",    value: summary?.completedProjects ?? 0, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
          { label: "متوقفة",    value: summary?.suspendedProjects ?? 0, icon: PauseCircle,  color: "text-orange-600", bg: "bg-orange-50",  border: "border-orange-200" },
          { label: "بنود الأعمال",   value: totalActivities,                  icon: ActivitySquare,color: "text-blue-600", bg: "bg-blue-50",    border: "border-blue-200" },
          { label: "بنود مكتملة", value: completedActs,                icon: BarChart3,   color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
        ].map(s => (
          <Card key={s.label} className={`border ${s.border} shadow-sm`}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${s.bg}`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Charts Row ── */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Donut: Status Distribution */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">توزيع حالة المشاريع</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                    {totalProjects > 0 && (
                      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                        <tspan x="50%" dy="-8" style={{ fontSize: 26, fontWeight: 800 }}>{totalProjects}</tspan>
                        <tspan x="50%" dy="22" style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}>مشروع</tspan>
                      </text>
                    )}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [v, "مشاريع"]}
                    contentStyle={{ textAlign: "right", direction: "rtl", fontSize: 13, borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {pieData.map(s => (
                <div key={s.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-muted-foreground">{s.name}</span>
                  <span className="text-xs font-bold mr-auto">{s.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Bar: Actual vs Planned per project */}
        <Card className="shadow-sm lg:col-span-3">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">الإنجاز الفعلي مقابل المخطط</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {barData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">لا توجد مشاريع</div>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip
                      formatter={(v: number, name: string) => [`${v}%`, name]}
                      contentStyle={{ textAlign: "right", direction: "rtl", fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="مخطط" fill="hsl(var(--muted))" radius={[0, 4, 4, 0]} barSize={8} />
                    <Bar dataKey="فعلي" fill="hsl(220,90%,56%)" radius={[0, 4, 4, 0]} barSize={8} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Activity Progress Bar ── */}
      {totalActivities > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              ملخص بنود الأعمال — {totalActivities} بند إجمالاً
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-6 mb-4">
              {[
                { label: "مكتملة",    val: completedActs,  pct: actPct(completedActs),  color: "bg-emerald-500", textColor: "text-emerald-600" },
                { label: "جارية",     val: inProgressActs, pct: actPct(inProgressActs), color: "bg-blue-500",    textColor: "text-blue-600" },
                { label: "متأخرة",    val: delayedActs,    pct: actPct(delayedActs),    color: "bg-red-500",     textColor: "text-red-600" },
              ].map(a => (
                <div key={a.label} className="text-center">
                  <div className={`text-2xl font-extrabold tabular-nums ${a.textColor}`}>{a.val}</div>
                  <div className="text-xs text-muted-foreground mb-2">{a.label} ({a.pct}%)</div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${a.color} rounded-full transition-all`} style={{ width: `${a.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Delayed Activities Alert ── */}
      {delayedActivitiesList.length > 0 && (
        <Card className="shadow-sm border-red-200 bg-red-50/30">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <div className="p-2 rounded-lg bg-red-100">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-red-700">
                تنبيهات التأخر — {delayedActivitiesList.length} بند متأخر
              </CardTitle>
              <p className="text-xs text-red-500/80 mt-0.5">بنود تجاوزت موعد انتهائها المخطط</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {delayedActivitiesList.map(a => (
                <Link key={`${a.projectId}-${a.id}`} href={`/projects/${a.projectId}/activities`} className="block group">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 p-3 rounded-lg bg-white border border-red-100 hover:border-red-300 transition-all">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate group-hover:text-red-700 transition-colors">{a.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.projectName}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-left">
                        <span className="text-xs text-muted-foreground">الإنجاز</span>
                        <p className="text-sm font-bold tabular-nums">{a.actualProgress}%</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">
                        <Clock className="h-3 w-3" /> متأخر {a.delayDays} يوم
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Projects Table + Recent Reports ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Projects Table */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              جميع المشاريع
            </CardTitle>
            <Link href="/projects" className="text-xs text-primary hover:text-primary/80 font-medium">
              عرض الكل
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {allProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">لا توجد مشاريع</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">المشروع</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">الحالة</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">الإنجاز</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allProjects.map((p, i) => (
                      <tr key={p.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 1 ? "bg-muted/10" : ""}`}>
                        <td className="px-4 py-3">
                          <Link href={getProjectLink(p.id)} className="font-medium hover:text-primary transition-colors line-clamp-1">
                            {p.name}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.ownerEntity}</p>
                        </td>
                        <td className="px-3 py-3 hidden sm:table-cell">
                          <StatusBadge status={p.status ?? "active"} />
                        </td>
                        <td className="px-3 py-3 min-w-[120px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <ProgressBar value={p.overallProgress ?? 0} planned={p.plannedProgress ?? 0} />
                            </div>
                            <span className="text-xs font-bold tabular-nums w-10 text-left">{p.overallProgress}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            {p.noSchedule ? (
                              <span className="text-muted-foreground">بدون جدول</span>
                            ) : (p.daysRemaining ?? 0) > 0 ? `${p.daysRemaining} يوم` : <span className="text-red-500 font-medium">منتهي</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Reports */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">آخر التقارير</CardTitle>
          </CardHeader>
          <CardContent>
            {recentReports.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">لا توجد تقارير</p>
            ) : (
              <div className="space-y-3">
                {recentReports.map((r) => (
                  <Link key={r.id} href={`/projects/${r.projectId}/reports`} className="block group">
                    <div className="flex items-start justify-between gap-2 p-3 rounded-lg border hover:border-primary/40 hover:bg-muted/30 transition-all">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 p-1.5 rounded-md bg-primary/10">
                          <FileText className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                            {r.type === "weekly" ? "تقرير أسبوعي" : "تقرير شهري"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(r.reportDate)}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-left">
                        <span className="text-sm font-bold tabular-nums text-primary">{r.progressPercentage}%</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

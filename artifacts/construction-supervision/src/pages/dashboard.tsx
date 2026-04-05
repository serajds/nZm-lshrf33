import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, ActivitySquare, AlertTriangle, CheckCircle2, FileText, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

const statusColors = {
  active: "hsl(var(--primary))",
  completed: "hsl(158, 52%, 38%)",
  delayed: "hsl(0, 68%, 48%)",
};

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-muted-foreground">
        جاري التحميل...
      </div>
    );
  }

  const statCards = [
    {
      label: "إجمالي المشاريع",
      value: summary?.totalProjects ?? 0,
      icon: Building2,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
      accent: "border-primary/30",
    },
    {
      label: "مشاريع نشطة",
      value: summary?.activeProjects ?? 0,
      icon: ActivitySquare,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-500",
      accent: "border-blue-500/30",
    },
    {
      label: "مشاريع متأخرة",
      value: summary?.delayedProjects ?? 0,
      icon: AlertTriangle,
      iconBg: "bg-destructive/10",
      iconColor: "text-destructive",
      accent: "border-destructive/30",
    },
    {
      label: "مشاريع مكتملة",
      value: summary?.completedProjects ?? 0,
      icon: CheckCircle2,
      iconBg: "bg-emerald-500/10",
      iconColor: "text-emerald-600",
      accent: "border-emerald-500/30",
    },
    {
      label: "متوسط الإنجاز",
      value: `${summary?.averageProgress ?? 0}%`,
      icon: TrendingUp,
      iconBg: "bg-indigo-500/10",
      iconColor: "text-indigo-500",
      accent: "border-indigo-500/30",
    },
    {
      label: "التقارير المرفوعة",
      value: summary?.totalReports ?? 0,
      icon: FileText,
      iconBg: "bg-orange-500/10",
      iconColor: "text-orange-500",
      accent: "border-orange-500/30",
    },
  ];

  const pieData = [
    { name: "نشط", value: summary?.activeProjects ?? 0, color: statusColors.active },
    { name: "مكتمل", value: summary?.completedProjects ?? 0, color: statusColors.completed },
    { name: "متأخر", value: summary?.delayedProjects ?? 0, color: statusColors.delayed },
  ];

  const getStatusLabel = (status: string) =>
    ({ active: "نشط", completed: "مكتمل", delayed: "متأخر", suspended: "متوقف" })[status] ?? status;

  return (
    <div className="space-y-6">
      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((card) => (
          <Card
            key={card.label}
            className={`border-t-2 ${card.accent} shadow-sm overflow-hidden`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight truncate">
                    {card.label}
                  </p>
                  <p className="text-2xl font-bold mt-1.5 tabular-nums">
                    {card.value}
                  </p>
                </div>
                <div className={`p-2 rounded-lg shrink-0 ${card.iconBg}`}>
                  <card.icon className={`h-4 w-4 ${card.iconColor}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Charts Row ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pie Chart */}
        <Card className="shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="text-base font-semibold">توزيع حالة المشاريع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [v, "المشاريع"]}
                    contentStyle={{ textAlign: "right", direction: "rtl", fontSize: 13 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-5 mt-2">
              {pieData.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-xs text-muted-foreground">{s.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Projects */}
        <Card className="shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="text-base font-semibold">أحدث المشاريع</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {!summary?.recentProjects?.length ? (
              <p className="text-center py-10 text-sm text-muted-foreground">
                لا توجد مشاريع حديثة
              </p>
            ) : (
              <div className="space-y-3">
                {summary.recentProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between gap-4 py-3 border-b last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-sm font-medium hover:text-primary transition-colors truncate block"
                      >
                        {project.name}
                      </Link>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {project.ownerEntity}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular-nums">
                        {project.overallProgress}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {getStatusLabel(project.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

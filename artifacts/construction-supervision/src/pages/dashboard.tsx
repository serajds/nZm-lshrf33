import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, ActivitySquare, AlertTriangle, CheckCircle2, FileText, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center">جاري التحميل...</div>;
  }

  const statusData = [
    { name: "نشط", value: summary?.activeProjects || 0, color: "hsl(var(--primary))" },
    { name: "مكتمل", value: summary?.completedProjects || 0, color: "hsl(160, 84%, 39%)" },
    { name: "متأخر", value: summary?.delayedProjects || 0, color: "hsl(0, 84.2%, 60.2%)" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">لوحة التحكم</h1>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">إجمالي المشاريع</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalProjects || 0}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">مشاريع نشطة</CardTitle>
            <ActivitySquare className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.activeProjects || 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">مشاريع متأخرة</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.delayedProjects || 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">مشاريع مكتملة</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.completedProjects || 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">متوسط الإنجاز</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">%{summary?.averageProgress || 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">التقارير المرفوعة</CardTitle>
            <FileText className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalReports || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>توزيع حالة المشاريع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [value, "المشاريع"]}
                    contentStyle={{ textAlign: 'right', direction: 'rtl' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-4">
              {statusData.map((status) => (
                <div key={status.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: status.color }} />
                  <span className="text-sm text-muted-foreground">{status.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>أحدث المشاريع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary?.recentProjects?.map((project) => (
                <div key={project.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div className="space-y-1">
                    <Link href={`/projects/${project.id}`} className="font-medium hover:underline text-primary">
                      {project.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">{project.ownerEntity}</p>
                  </div>
                  <div className="text-left">
                    <div className="font-semibold">% {project.overallProgress}</div>
                    <div className="text-xs text-muted-foreground">
                      {project.status === 'active' ? 'نشط' : 
                       project.status === 'completed' ? 'مكتمل' : 
                       project.status === 'delayed' ? 'متأخر' : 'متوقف'}
                    </div>
                  </div>
                </div>
              ))}
              {!summary?.recentProjects?.length && (
                <div className="text-center py-8 text-muted-foreground">لا توجد مشاريع حديثة</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

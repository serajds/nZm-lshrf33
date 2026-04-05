import { useParams, useLocation } from "wouter";
import { 
  useGetProjectDeviation,
  useGetProject
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine
} from "recharts";

export default function ProjectDeviation() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: deviationData, isLoading } = useGetProjectDeviation(projectId, { query: { enabled: !!projectId } });

  if (isLoading) return <div className="flex h-40 items-center justify-center">جاري التحميل...</div>;

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'on_track': return { label: 'على المسار', color: 'text-emerald-600', bg: 'bg-emerald-600/10 border-emerald-600/20', icon: CheckCircle2 };
      case 'ahead': return { label: 'متقدم عن الجدول', color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', icon: TrendingUp };
      case 'slightly_delayed': return { label: 'تأخير بسيط', color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20', icon: TrendingDown };
      case 'significantly_delayed': return { label: 'تأخير كبير', color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/20', icon: AlertTriangle };
      default: return { label: status, color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: AlertTriangle };
    }
  };

  const statusInfo = deviationData ? getStatusInfo(deviationData.status) : null;
  const StatusIcon = statusInfo?.icon || AlertTriangle;

  const chartData = deviationData?.activitiesAnalysis.map((a: any) => ({
    name: a.activityName,
    deviation: a.deviation, // Negative is behind schedule, positive is ahead
  })) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{project?.name} - تحليل الانحراف</h1>
      </div>

      <Tabs defaultValue="deviation" className="w-full" dir="rtl">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
          <TabsTrigger value="summary" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}`)}>ملخص المشروع</TabsTrigger>
          <TabsTrigger value="activities" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/activities`)}>الجدول الزمني</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/reports`)}>التقارير</TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/files`)}>الملفات</TabsTrigger>
          <TabsTrigger value="deviation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3">تحليل الانحراف</TabsTrigger>
        </TabsList>
      </Tabs>

      {deviationData && statusInfo && (
        <div className="grid gap-6">
          <div className={`p-6 rounded-xl border ${statusInfo.bg} flex items-center gap-4`}>
            <div className={`p-3 rounded-full bg-background/50 ${statusInfo.color}`}>
              <StatusIcon className="h-8 w-8" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.label}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                تحليل الانحراف الشامل بناءً على مؤشرات الأداء والجدول الزمني المعتمد.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">انحراف الإنجاز (Progress Deviation)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-4xl font-bold ${deviationData.progressDeviation < 0 ? 'text-destructive' : 'text-emerald-600'}`} dir="ltr">
                  {deviationData.progressDeviation > 0 ? '+' : ''}{deviationData.progressDeviation}%
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  الفرق بين الإنجاز المخطط والفعلي
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">انحراف الوقت (Time Deviation)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-4xl font-bold ${deviationData.timeDeviation > 0 ? 'text-destructive' : 'text-emerald-600'}`} dir="ltr">
                  {deviationData.timeDeviation > 0 ? '+' : ''}{deviationData.timeDeviation} يوم
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  عدد الأيام المتأخرة عن الجدول الزمني
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تحليل الانحراف حسب الأنشطة</CardTitle>
              <CardDescription>القيم السالبة تعني تأخير عن المخطط، والقيم الموجبة تعني تقدم</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} fontSize={12} />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip 
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ textAlign: 'right', direction: 'rtl' }} 
                      formatter={(v: number) => [`${v}%`, 'الانحراف']} 
                    />
                    <ReferenceLine y={0} stroke="#666" />
                    <Bar dataKey="deviation" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.deviation < 0 ? 'hsl(var(--destructive))' : 'hsl(160, 84%, 39%)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-8 space-y-4">
                <h3 className="font-semibold">الأنشطة الحرجة المتأخرة</h3>
                <div className="grid gap-3">
                  {deviationData.activitiesAnalysis
                    .filter((a: any) => a.deviation < -5)
                    .sort((a: any, b: any) => a.deviation - b.deviation)
                    .map((activity: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center p-3 rounded-md border border-destructive/20 bg-destructive/5">
                        <span className="font-medium">{activity.activityName}</span>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground" dir="ltr">مخطط: {activity.plannedProgress}% | فعلي: {activity.actualProgress}%</span>
                          <Badge variant="destructive" dir="ltr">{activity.deviation}%</Badge>
                        </div>
                      </div>
                    ))}
                  {deviationData.activitiesAnalysis.filter((a: any) => a.deviation < -5).length === 0 && (
                    <div className="text-center py-4 text-muted-foreground text-sm">لا توجد أنشطة متأخرة بشكل حرج</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

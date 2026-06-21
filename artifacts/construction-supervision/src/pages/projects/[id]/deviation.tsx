import { useParams, useLocation } from "wouter";
import { 
  useGetProjectDeviation,
  useGetProject
} from "@workspace/api-client-react";
import type { ActivityDeviation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ProjectNav } from "@/components/project-nav";
import { ArrowRight, AlertTriangle, TrendingDown, TrendingUp, CheckCircle2, Clock, CalendarOff, BarChart3, Activity, Gauge } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend
} from "recharts";

export default function ProjectDeviation() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: deviationData, isLoading } = useGetProjectDeviation(projectId, { query: { enabled: !!projectId } });

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

  const dd = deviationData as any;

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'on_track': return { label: 'على المسار الصحيح', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800', icon: CheckCircle2, barColor: 'bg-emerald-500' };
      case 'ahead': return { label: 'متقدم عن الجدول الزمني', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800', icon: TrendingUp, barColor: 'bg-blue-500' };
      case 'slightly_delayed': return { label: 'تأخير بسيط عن الجدول', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800', icon: TrendingDown, barColor: 'bg-amber-500' };
      case 'significantly_delayed': return { label: 'تأخير كبير - يحتاج تدخل', color: 'text-red-600', bg: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800', icon: AlertTriangle, barColor: 'bg-red-500' };
      default: return { label: status, color: 'text-muted-foreground', bg: 'bg-muted border-border', icon: AlertTriangle, barColor: 'bg-muted' };
    }
  };

  const statusInfo = deviationData ? getStatusInfo(deviationData.status) : null;
  const StatusIcon = statusInfo?.icon || AlertTriangle;

  const chartData = (deviationData?.activitiesAnalysis ?? []).map((a: ActivityDeviation) => ({
    name: a.activityName.length > 20 ? a.activityName.substring(0, 18) + '...' : a.activityName,
    fullName: a.activityName,
    planned: a.plannedProgress,
    actual: a.actualProgress,
    deviation: a.deviation,
  }));

  const criticalActivities = (deviationData?.activitiesAnalysis ?? [])
    .filter((a: ActivityDeviation) => a.deviation < -5)
    .sort((a: ActivityDeviation, b: ActivityDeviation) => a.deviation - b.deviation);

  const aheadActivities = (deviationData?.activitiesAnalysis ?? [])
    .filter((a: ActivityDeviation) => a.deviation > 5)
    .sort((a: ActivityDeviation, b: ActivityDeviation) => b.deviation - a.deviation);

  const progressDev = deviationData?.progressDeviation ?? 0;
  const suspensionDays = dd?.suspensionDays ?? 0;
  const grossDelayDays = dd?.grossDelayDays ?? 0;
  const netDelayDays = dd?.netDelayDays ?? 0;

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

      {deviationData && statusInfo && (
        <div className="space-y-6">

          <div className={`p-5 rounded-xl border-2 ${statusInfo.bg} flex items-center gap-4`}>
            <div className={`p-3 rounded-xl ${statusInfo.color}`} style={{ background: 'rgba(255,255,255,0.6)' }}>
              <StatusIcon className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h2 className={`text-xl font-bold ${statusInfo.color}`}>{statusInfo.label}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {deviationData.status === 'on_track' && 'المشروع يسير وفق الخطة الزمنية المعتمدة بشكل جيد.'}
                {deviationData.status === 'ahead' && 'المشروع متقدم عن الجدول الزمني المخطط. أداء ممتاز!'}
                {deviationData.status === 'slightly_delayed' && 'هناك تأخير بسيط يمكن تداركه بتكثيف العمل في الفترة القادمة.'}
                {deviationData.status === 'significantly_delayed' && 'تأخير كبير يستوجب اتخاذ إجراءات تصحيحية عاجلة ومراجعة الخطة.'}
              </p>
            </div>
            <div className={`text-3xl font-black ${statusInfo.color}`} dir="ltr">
              {progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%
            </div>
          </div>

          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-blue-400 to-blue-600" />
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Gauge className="h-4 w-4" />
                  <span className="text-xs font-medium">انحراف الإنجاز</span>
                </div>
                <div className={`text-2xl font-bold ${progressDev < 0 ? 'text-red-600' : 'text-emerald-600'}`} dir="ltr">
                  {progressDev > 0 ? '+' : ''}{progressDev.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">الفرق بين المخطط والفعلي</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-amber-400 to-amber-600" />
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs font-medium">التأخير الإجمالي</span>
                </div>
                <div className={`text-2xl font-bold ${grossDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'}`} dir="ltr">
                  {grossDelayDays} <span className="text-sm font-normal">يوم</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">إجمالي أيام التأخير</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-purple-400 to-purple-600" />
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <CalendarOff className="h-4 w-4" />
                  <span className="text-xs font-medium">أيام التوقف</span>
                </div>
                <div className="text-2xl font-bold text-purple-600" dir="ltr">
                  {suspensionDays} <span className="text-sm font-normal">يوم</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">أيام التوقف المعتمدة</p>
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-red-400 to-red-600" />
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-2">
                  <Activity className="h-4 w-4" />
                  <span className="text-xs font-medium">التأخير الصافي</span>
                </div>
                <div className={`text-2xl font-bold ${netDelayDays > 0 ? 'text-red-600' : 'text-emerald-600'}`} dir="ltr">
                  {netDelayDays} <span className="text-sm font-normal">يوم</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">بعد خصم التوقفات</p>
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    مقارنة الإنجاز المخطط والفعلي
                  </CardTitle>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> المخطط
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> الفعلي
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[350px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        angle={-40}
                        textAnchor="end"
                        height={80}
                        interval={0}
                        fontSize={11}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        domain={[0, 100]}
                        fontSize={11}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                        contentStyle={{
                          textAlign: 'right',
                          direction: 'rtl',
                          borderRadius: '8px',
                          border: '1px solid hsl(var(--border))',
                          background: 'hsl(var(--card))',
                          fontSize: '12px',
                        }}
                        formatter={(v: number, name: string) => [
                          `${v}%`,
                          name === 'planned' ? 'المخطط' : 'الفعلي',
                        ]}
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

          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  تحليل الانحراف حسب النشاط
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }} barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        angle={-40}
                        textAnchor="end"
                        height={80}
                        interval={0}
                        fontSize={11}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}%`}
                        fontSize={11}
                        tick={{ fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <Tooltip
                        cursor={{ fill: 'transparent' }}
                        contentStyle={{
                          textAlign: 'right',
                          direction: 'rtl',
                          borderRadius: '8px',
                          border: '1px solid hsl(var(--border))',
                          background: 'hsl(var(--card))',
                          fontSize: '12px',
                        }}
                        formatter={(v: number) => [`${v}%`, 'الانحراف']}
                        labelFormatter={(label: string) => {
                          const item = chartData.find((c: any) => c.name === label);
                          return item?.fullName || label;
                        }}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="deviation" radius={[4, 4, 0, 0]}>
                        {chartData.map((entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={entry.deviation < -10 ? 'hsl(0, 84%, 60%)' : entry.deviation < 0 ? 'hsl(38, 92%, 50%)' : 'hsl(160, 84%, 39%)'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className={criticalActivities.length > 0 ? 'border-red-200 dark:border-red-900' : ''}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className={`h-5 w-5 ${criticalActivities.length > 0 ? 'text-red-500' : 'text-muted-foreground'}`} />
                  الأنشطة الحرجة المتأخرة
                  {criticalActivities.length > 0 && (
                    <Badge variant="destructive" className="mr-2">{criticalActivities.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {criticalActivities.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد أنشطة متأخرة بشكل حرج</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {criticalActivities.map((activity: ActivityDeviation, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium text-sm">{activity.activityName}</span>
                          <Badge variant="destructive" className="text-xs" dir="ltr">{activity.deviation}%</Badge>
                        </div>
                        <div className="flex items-center gap-3">
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
                        </div>
                        {activity.delayDays != null && activity.delayDays > 0 && (
                          <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            متأخر {activity.delayDays} يوم عن الموعد المحدد
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
                  الأنشطة المتقدمة
                  {aheadActivities.length > 0 && (
                    <Badge className="mr-2 bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">{aheadActivities.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aheadActivities.length === 0 ? (
                  <div className="text-center py-8">
                    <TrendingDown className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">لا توجد أنشطة متقدمة عن الجدول</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {aheadActivities.map((activity: ActivityDeviation, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium text-sm">{activity.activityName}</span>
                          <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" dir="ltr">+{activity.deviation}%</Badge>
                        </div>
                        <div className="flex items-center gap-3">
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
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {(deviationData?.activitiesAnalysis ?? []).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  جدول تفصيلي لجميع الأنشطة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-3 px-3 text-right font-medium">النشاط</th>
                        <th className="py-3 px-3 text-center font-medium">المخطط</th>
                        <th className="py-3 px-3 text-center font-medium">الفعلي</th>
                        <th className="py-3 px-3 text-center font-medium">الانحراف</th>
                        <th className="py-3 px-3 text-center font-medium w-48">مؤشر الأداء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(deviationData.activitiesAnalysis as ActivityDeviation[]).map((a, idx) => {
                        const devColor = a.deviation < -10 ? 'text-red-600' : a.deviation < 0 ? 'text-amber-600' : a.deviation > 0 ? 'text-emerald-600' : 'text-muted-foreground';
                        const barColor = a.deviation < -10 ? 'bg-red-500' : a.deviation < 0 ? 'bg-amber-500' : 'bg-emerald-500';
                        return (
                          <tr key={idx} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-3 px-3 font-medium">{a.activityName}</td>
                            <td className="py-3 px-3 text-center" dir="ltr">{a.plannedProgress}%</td>
                            <td className="py-3 px-3 text-center" dir="ltr">{a.actualProgress}%</td>
                            <td className={`py-3 px-3 text-center font-bold ${devColor}`} dir="ltr">
                              {a.deviation > 0 ? '+' : ''}{a.deviation}%
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
            <p className="text-sm text-muted-foreground">يرجى التأكد من وجود أنشطة مسجلة في المشروع لعرض تحليل الانحراف.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

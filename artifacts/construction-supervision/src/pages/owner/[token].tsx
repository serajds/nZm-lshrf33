import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useVerifyOwnerAccess } from "@workspace/api-client-react";
import type { OwnerProjectView, Activity, Report, ProjectExtension, ProjectSuspension } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, MapPin, HardHat, Lock, Eye,
  CheckCircle2, AlertTriangle, Calendar, ArrowBigRightDash, Clock, PauseCircle, Printer,
  BarChart3, Activity as ActivityIcon, TrendingUp, TrendingDown, FileText,
  CalendarDays, Gauge, Timer, ShieldCheck, CircleDot
} from "lucide-react";
import { previewReport } from "@/lib/report-pdf";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie
} from "recharts";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

export default function OwnerPortal() {
  const params = useParams();
  const token = params.token ?? "";
  const { toast } = useToast();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ownerData, setOwnerData] = useState<OwnerProjectView | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [projectInfo, setProjectInfo] = useState<{ projectName: string; companyLogos: Record<string, { name: string; logoUrl: string | null }> } | null>(null);
  const verifyAccess = useVerifyOwnerAccess();

  useEffect(() => {
    fetch(`${API_BASE}/owner/access/${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setProjectInfo(data);
      })
      .catch(() => {});

    const savedJwt = sessionStorage.getItem(`owner_jwt_${token}`);
    if (!savedJwt) {
      setIsRestoring(false);
      return;
    }
    fetch(`${API_BASE}/owner/${token}/data`, {
      headers: { Authorization: `Bearer ${savedJwt}` }
    })
      .then(r => {
        if (!r.ok) throw new Error("expired");
        return r.json();
      })
      .then(data => {
        setOwnerData(data as OwnerProjectView);
      })
      .catch(() => {
        sessionStorage.removeItem(`owner_jwt_${token}`);
      })
      .finally(() => setIsRestoring(false));
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    try {
      const res = await verifyAccess.mutateAsync({
        data: { token, password }
      });
      const jwt = (res as any).ownerJwt;
      if (jwt) {
        sessionStorage.setItem(`owner_jwt_${token}`, jwt);
      }
      setOwnerData(res);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "الرجاء التأكد من كلمة المرور";
      toast({
        variant: "destructive",
        title: "رمز الدخول غير صحيح",
        description: errorMessage
      });
    }
  };

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
          <span className="text-muted-foreground text-sm">جاري التحميل...</span>
        </div>
      </div>
    );
  }

  if (!ownerData) {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const ownerLogo = projectInfo?.companyLogos?.owner;
    const supervisorLogo = projectInfo?.companyLogos?.supervisor;
    const hasLogos = !!(ownerLogo?.logoUrl || supervisorLogo?.logoUrl);

    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-slate-50 via-white to-emerald-50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950 p-4" dir="rtl">
        <div className="mb-8 flex flex-col items-center">
          {hasLogos ? (
            <div className="flex items-center justify-center gap-10 mb-6">
              {[
                { logo: supervisorLogo, label: "جهة الإشراف" },
                { logo: ownerLogo, label: "المالك" },
              ].map(({ logo, label }) => {
                if (!logo?.logoUrl) return null;
                return (
                  <div key={label} className="flex flex-col items-center gap-2">
                    <div className="w-20 h-20 rounded-2xl bg-white shadow-xl p-2.5 flex items-center justify-center border border-slate-100">
                      <img src={apiBase + logo.logoUrl} alt={logo.name} className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                    <span className="text-sm font-bold text-foreground max-w-[140px] text-center leading-tight">{logo.name}</span>
                    <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-3xl flex items-center justify-center shadow-2xl shadow-emerald-500/30 mb-5">
              <Building2 className="w-10 h-10" />
            </div>
          )}
          <h1 className="text-3xl font-bold text-foreground">{projectInfo?.projectName || "بوابة المالك"}</h1>
        </div>

        <Card className="w-full max-w-md shadow-2xl border-0 bg-card/80 backdrop-blur-sm">
          <CardHeader className="space-y-2 text-center pb-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
              <Lock className="w-6 h-6 text-emerald-600" />
            </div>
            <CardTitle className="text-xl">الوصول للمشروع</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9 pl-9 text-right"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-l from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                disabled={verifyAccess.isPending}
              >
                {verifyAccess.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    جاري التحقق...
                  </span>
                ) : "عرض المشروع"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-8 text-xs text-muted-foreground">نظام الإشراف الهندسي — بوابة آمنة للقراءة فقط</p>
      </div>
    );
  }

  const { project, activities, reports, extensions = [], suspensions = [], summary } = ownerData;
  const totalExtDays = extensions.reduce((s: number, e: ProjectExtension) => s + e.daysAdded, 0);
  const latestExt = extensions.length > 0 ? extensions[extensions.length - 1] : null;
  const totalSuspDays = (suspensions as ProjectSuspension[]).reduce((s: number, x: ProjectSuspension) => s + x.calendarDays, 0);

  const sm = summary as any;
  const progressDiff = (sm.overallProgress ?? 0) - (sm.plannedProgress ?? 0);

  const handlePreview = (report: Report) => {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    previewReport({
      projectName: project.name,
      ownerEntity: project.ownerEntity,
      contractor: project.contractor,
      supervisorEntity: project.supervisorEntity,
      location: project.location,
      reportType: report.type,
      reportDate: report.reportDate,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      progressPercentage: report.progressPercentage,
      workDescription: report.workDescription,
      technicalNotes: report.technicalNotes,
      recommendations: report.recommendations,
      imageUrls: report.imageUrls ?? [],
      reportId: report.id,
      reportNumber: report.reportNumber,
      contractValue: (project as any).contractValue ?? null,
      startDate: (project as any).startDate ?? null,
      expectedEndDate: (project as any).expectedEndDate ?? null,
      plannedProgress: (project as any).plannedProgress ?? null,
      companyLogos: (ownerData as any)?.companyLogos,
      apiBase,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-emerald-500 text-white gap-1"><CircleDot className="h-3 w-3" />نشط</Badge>;
      case 'completed': return <Badge className="bg-blue-500 text-white gap-1"><CheckCircle2 className="h-3 w-3" />مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />متأخر</Badge>;
      case 'suspended': return <Badge className="bg-amber-500 text-white gap-1"><PauseCircle className="h-3 w-3" />متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const ganttData = activities.map((a: Activity) => ({
    name: a.name.length > 18 ? a.name.substring(0, 16) + '...' : a.name,
    fullName: a.name,
    planned: a.plannedProgress,
    actual: a.actualProgress,
  }));

  const statusCounts = {
    active: activities.filter((a: Activity) => a.status === "active").length,
    completed: activities.filter((a: Activity) => a.status === "completed").length,
    delayed: activities.filter((a: Activity) => a.status === "delayed").length,
    not_started: activities.filter((a: Activity) => a.status === "not_started").length,
  };
  const pieData = [
    { name: "مكتمل", value: statusCounts.completed, fill: "hsl(160, 84%, 39%)" },
    { name: "نشط", value: statusCounts.active, fill: "hsl(217, 91%, 60%)" },
    { name: "متأخر", value: statusCounts.delayed, fill: "hsl(0, 84%, 60%)" },
    { name: "لم يبدأ", value: statusCounts.not_started, fill: "hsl(var(--muted-foreground))" },
  ].filter(d => d.value > 0);

  const companyLogos = (ownerData as any)?.companyLogos;
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" dir="rtl">
      <div className="bg-gradient-to-l from-slate-800 via-slate-900 to-slate-800 text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
          {companyLogos && (companyLogos.owner?.logoUrl || companyLogos.contractor?.logoUrl || companyLogos.supervisor?.logoUrl) && (
            <div className="flex items-center justify-center gap-8 mb-6 pb-5 border-b border-white/10">
              {[
                { key: 'supervisor', label: 'جهة الإشراف' },
                { key: 'owner', label: 'المالك' },
                { key: 'contractor', label: 'المقاول' },
              ].map(({ key, label }) => {
                const logo = companyLogos[key];
                if (!logo?.logoUrl) return null;
                return (
                  <div key={key} className="flex flex-col items-center gap-1.5">
                    <div className="w-16 h-16 rounded-xl bg-white/10 backdrop-blur-sm p-2 flex items-center justify-center border border-white/20">
                      <img src={apiBase + logo.logoUrl} alt={logo.name} className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                    <span className="text-xs text-white/90 font-semibold max-w-[120px] text-center leading-tight">{logo.name}</span>
                    <span className="text-[10px] text-white/50 font-medium">{label}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-white/50 font-medium">بوابة المالك</p>
                  <h1 className="text-2xl md:text-3xl font-bold">{project.name}</h1>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-white/70">
                <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {project.location}</span>
                <span className="flex items-center gap-1.5"><HardHat className="h-4 w-4" /> {project.contractor}</span>
                {project.supervisorEntity && (
                  <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> {project.supervisorEntity}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {getStatusBadge(project.status)}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 -mt-4">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-emerald-400 to-emerald-600" />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium">الإنجاز الفعلي</span>
              </div>
              <div className="text-3xl font-black text-emerald-600">{sm.overallProgress}%</div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${sm.overallProgress}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                <span>المخطط: {sm.plannedProgress?.toFixed(0)}%</span>
                <span className={progressDiff >= 0 ? 'text-emerald-600' : 'text-red-500'} dir="ltr">
                  {progressDiff > 0 ? '+' : ''}{progressDiff.toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-1 ${sm.delayDays > 0 ? 'bg-gradient-to-l from-red-400 to-red-600' : 'bg-gradient-to-l from-blue-400 to-blue-600'}`} />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Timer className="h-4 w-4" />
                <span className="text-xs font-medium">الجدول الزمني</span>
              </div>
              {sm.delayDays > 0 ? (
                <>
                  <div className="text-3xl font-black text-red-600">{sm.delayDays} <span className="text-sm font-normal">يوم تأخير</span></div>
                  {sm.suspensionDays > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">صافي التأخير: {sm.netDelayDays} يوم (بعد خصم {sm.suspensionDays} يوم توقف)</p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-3xl font-black text-blue-600">{sm.daysRemaining} <span className="text-sm font-normal">يوم متبقي</span></div>
                  <p className="text-xs text-muted-foreground mt-1">من أصل {sm.totalDays} يوم</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-violet-400 to-violet-600" />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <ActivityIcon className="h-4 w-4" />
                <span className="text-xs font-medium">الأنشطة</span>
              </div>
              <div className="text-3xl font-black">{sm.activitiesCompleted}<span className="text-lg font-normal text-muted-foreground"> / {sm.activitiesTotal}</span></div>
              <div className="flex gap-2 mt-2 text-xs">
                {statusCounts.delayed > 0 && <span className="text-red-500">{statusCounts.delayed} متأخر</span>}
                {statusCounts.active > 0 && <span className="text-blue-500">{statusCounts.active} نشط</span>}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-l from-amber-400 to-amber-600" />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <FileText className="h-4 w-4" />
                <span className="text-xs font-medium">التقارير والمعلومات</span>
              </div>
              <div className="text-3xl font-black">{sm.reportsCount} <span className="text-sm font-normal">تقرير</span></div>
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                {extensions.length > 0 && <span>{extensions.length} تمديد</span>}
                {(suspensions as ProjectSuspension[]).length > 0 && <span>{(suspensions as ProjectSuspension[]).length} توقف</span>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 mb-6">
          <Card className="shadow-md border-0 bg-card/80 backdrop-blur-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-3">
                <CalendarDays className="h-4 w-4" />
                <span className="text-sm font-medium">المعلومات الزمنية</span>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-1.5 border-b border-dashed">
                  <span className="text-muted-foreground">تاريخ البدء</span>
                  <span className="font-medium tabular-nums" dir="ltr">{fmtDate((project as any).startDate)}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-dashed">
                  <span className="text-muted-foreground">تاريخ الانتهاء المتوقع</span>
                  <span className="font-medium tabular-nums" dir="ltr">{fmtDate((project as any).expectedEndDate)}</span>
                </div>
                {latestExt && (
                  <div className="flex justify-between items-center py-1.5 border-b border-dashed">
                    <span className="text-amber-600 font-medium">بعد التمديدات</span>
                    <span className="font-bold tabular-nums text-amber-600" dir="ltr">{fmtDate(latestExt.newEndDate)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-1.5 border-b border-dashed">
                  <span className="text-muted-foreground">المدة الإجمالية</span>
                  <span className="font-medium">{sm.totalDays} يوم</span>
                </div>
                <div className="flex justify-between items-center py-1.5">
                  <span className="text-muted-foreground">الأيام المنقضية</span>
                  <span className="font-medium">{sm.daysElapsed} يوم ({Math.round((sm.daysElapsed / sm.totalDays) * 100)}%)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-md border-0 bg-card/80 backdrop-blur-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-3">
                <BarChart3 className="h-4 w-4" />
                <span className="text-sm font-medium">توزيع حالات الأنشطة</span>
              </div>
              {pieData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="w-32 h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={55}
                          dataKey="value"
                          strokeWidth={2}
                          stroke="hsl(var(--card))"
                        >
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [v, 'عدد']} contentStyle={{ direction: 'rtl', fontSize: '12px', borderRadius: '8px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-2">
                    {pieData.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm inline-block" style={{ background: d.fill }} />
                          <span>{d.name}</span>
                        </div>
                        <span className="font-bold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">لا توجد أنشطة</div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-md border-0 bg-card/80 backdrop-blur-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-3">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-medium">مؤشرات الأداء</span>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">التقدم الزمني</span>
                    <span className="font-medium">{Math.round((sm.daysElapsed / sm.totalDays) * 100)}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, (sm.daysElapsed / sm.totalDays) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">الإنجاز الفعلي</span>
                    <span className="font-medium">{sm.overallProgress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${sm.overallProgress}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">الأنشطة المكتملة</span>
                    <span className="font-medium">{sm.activitiesTotal > 0 ? Math.round((sm.activitiesCompleted / sm.activitiesTotal) * 100) : 0}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${sm.activitiesTotal > 0 ? (sm.activitiesCompleted / sm.activitiesTotal) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">مؤشر الكفاءة (SPI)</span>
                    {(() => {
                      const spi = sm.plannedProgress > 0 ? (sm.overallProgress / sm.plannedProgress) : 1;
                      return (
                        <span className={`font-bold ${spi >= 1 ? 'text-emerald-600' : spi >= 0.8 ? 'text-amber-600' : 'text-red-600'}`}>
                          {spi.toFixed(2)}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="progress" className="w-full mb-8">
          <TabsList className="w-full justify-start mb-4 flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="progress" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />سير العمل</TabsTrigger>
            <TabsTrigger value="activities" className="gap-1.5"><ActivityIcon className="h-3.5 w-3.5" />الأنشطة</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />التقارير
              {reports.length > 0 && <Badge className="mr-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0">{reports.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="extensions" className="gap-1.5">
              <ArrowBigRightDash className="h-3.5 w-3.5" />التمديدات
              {extensions.length > 0 && <Badge className="mr-1 bg-amber-500 text-white text-[10px] px-1.5 py-0">{extensions.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="suspensions" className="gap-1.5">
              <PauseCircle className="h-3.5 w-3.5" />التوقفات
              {(suspensions as ProjectSuspension[]).length > 0 && <Badge className="mr-1 bg-violet-500 text-white text-[10px] px-1.5 py-0">{(suspensions as ProjectSuspension[]).length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="progress" className="space-y-4">
            <Card className="shadow-md border-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  مقارنة الإنجاز — المخطط مقابل الفعلي
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs mb-2 justify-end">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" /> المخطط
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> الفعلي
                  </span>
                </div>
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ganttData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} interval={0} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px' }}
                        formatter={(v: number, name: string) => [`${v}%`, name === 'planned' ? 'المخطط' : 'الفعلي']}
                        labelFormatter={(label: string) => {
                          const item = ganttData.find((c: any) => c.name === label);
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
          </TabsContent>

          <TabsContent value="activities">
            <Card className="shadow-md border-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ActivityIcon className="h-5 w-5 text-primary" />
                  جدول الأنشطة التفصيلي
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right w-8">#</TableHead>
                      <TableHead className="text-right">النشاط</TableHead>
                      <TableHead className="text-center">الحالة</TableHead>
                      <TableHead className="text-center">المخطط</TableHead>
                      <TableHead className="text-center">الفعلي</TableHead>
                      <TableHead className="text-center">الانحراف</TableHead>
                      <TableHead className="text-center w-40">مؤشر الأداء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activities.map((a: Activity, i: number) => {
                      const dev = a.actualProgress - a.plannedProgress;
                      const devColor = dev < -10 ? 'text-red-600' : dev < 0 ? 'text-amber-600' : dev > 0 ? 'text-emerald-600' : 'text-muted-foreground';
                      const barColor = dev < -10 ? 'bg-red-500' : dev < 0 ? 'bg-amber-500' : 'bg-emerald-500';
                      const statusBadge = (() => {
                        switch (a.status) {
                          case 'completed': return <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">مكتمل</Badge>;
                          case 'active': return <Badge className="bg-blue-100 text-blue-700 text-[10px]">نشط</Badge>;
                          case 'delayed': return <Badge className="bg-red-100 text-red-700 text-[10px]">متأخر</Badge>;
                          default: return <Badge variant="outline" className="text-[10px]">لم يبدأ</Badge>;
                        }
                      })();
                      return (
                        <TableRow key={a.id} className="hover:bg-muted/50">
                          <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                          <TableCell className="font-medium text-sm">{a.name}</TableCell>
                          <TableCell className="text-center">{statusBadge}</TableCell>
                          <TableCell className="text-center text-sm" dir="ltr">{a.plannedProgress}%</TableCell>
                          <TableCell className="text-center text-sm" dir="ltr">{a.actualProgress}%</TableCell>
                          <TableCell className={`text-center text-sm font-bold ${devColor}`} dir="ltr">{dev > 0 ? '+' : ''}{dev}%</TableCell>
                          <TableCell>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, a.actualProgress)}%` }} />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports">
            <div className="space-y-4">
              {reports.length === 0 ? (
                <Card className="shadow-md border-0">
                  <CardContent className="py-16 text-center">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-1">لا توجد تقارير</h3>
                    <p className="text-sm text-muted-foreground">لم يتم إصدار أي تقارير دورية بعد</p>
                  </CardContent>
                </Card>
              ) : (
                reports.map((report: Report) => (
                  <Card key={report.id} className="shadow-md border-0 overflow-hidden">
                    <CardHeader className="pb-3 bg-muted/30">
                      <div className="flex justify-between items-center gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${report.type === 'weekly' ? 'bg-blue-100 text-blue-600' : 'bg-violet-100 text-violet-600'}`}>
                            <FileText className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-base">
                              تقرير {report.type === 'weekly' ? 'أسبوعي' : 'شهري'} #{report.reportNumber}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums" dir="ltr">{fmtDate(report.reportDate)}</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-violet-600 hover:bg-violet-50 hover:text-violet-700 border-violet-200 gap-1.5 shadow-sm"
                          onClick={() => handlePreview(report)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          معاينة وطباعة
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-muted-foreground">نسبة الإنجاز للفترة</span>
                            <span className="text-sm font-bold text-primary">{report.progressPercentage}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${report.progressPercentage}%` }} />
                          </div>
                        </div>
                        {report.periodStart && report.periodEnd && (
                          <div className="text-xs text-muted-foreground border-r pr-4">
                            <div>من: <span className="tabular-nums" dir="ltr">{fmtDate(report.periodStart)}</span></div>
                            <div>إلى: <span className="tabular-nums" dir="ltr">{fmtDate(report.periodEnd)}</span></div>
                          </div>
                        )}
                      </div>

                      {report.workDescription && (
                        <div>
                          <h4 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> وصف الأعمال المنجزة
                          </h4>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{report.workDescription}</p>
                        </div>
                      )}

                      {(report.technicalNotes || report.recommendations) && (
                        <div className="grid md:grid-cols-2 gap-3">
                          {report.technicalNotes && (
                            <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
                              <h4 className="text-sm font-semibold text-amber-600 mb-1.5 flex items-center gap-1.5">
                                <AlertTriangle className="h-4 w-4" /> ملاحظات فنية
                              </h4>
                              <p className="text-sm text-muted-foreground leading-relaxed">{report.technicalNotes}</p>
                            </div>
                          )}
                          {report.recommendations && (
                            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20">
                              <h4 className="text-sm font-semibold text-emerald-600 mb-1.5 flex items-center gap-1.5">
                                <CheckCircle2 className="h-4 w-4" /> التوصيات
                              </h4>
                              <p className="text-sm text-muted-foreground leading-relaxed">{report.recommendations}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="extensions">
            <div className="space-y-4">
              {extensions.length === 0 ? (
                <Card className="shadow-md border-0">
                  <CardContent className="py-16 text-center">
                    <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-1">لا توجد تمديدات</h3>
                    <p className="text-sm text-muted-foreground">المشروع يسير وفق الجدول الزمني الأصلي</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="shadow-md border-0 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-slate-400" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" /> التاريخ الأصلي للإنهاء
                        </p>
                        <p className="text-lg font-bold tabular-nums" dir="ltr">
                          {fmtDate(project.expectedEndDate)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-md border-0 relative overflow-hidden border-amber-200">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <ArrowBigRightDash className="h-3.5 w-3.5 text-amber-500" /> بعد التمديدات
                        </p>
                        <p className="text-lg font-bold tabular-nums text-amber-600" dir="ltr">
                          {latestExt ? fmtDate(latestExt.newEndDate) : "—"}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-md border-0 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-amber-400" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" /> إجمالي أيام التمديد
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-amber-600">
                          {totalExtDays} <span className="text-sm font-normal">يوم</span>
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="shadow-md border-0">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ArrowBigRightDash className="h-5 w-5 text-amber-500" />
                        سجل التمديدات الرسمية
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table className="min-w-[580px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">تاريخ الاتفاقية</TableHead>
                            <TableHead className="text-center">الأيام المضافة</TableHead>
                            <TableHead className="text-right">تاريخ الإنهاء الجديد</TableHead>
                            <TableHead className="text-right">السبب</TableHead>
                            <TableHead className="text-right">رقم الخطاب</TableHead>
                            <TableHead className="text-right">الجهة الموافِقة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extensions.map((ext: ProjectExtension, i: number) => (
                            <TableRow key={ext.id}>
                              <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(ext.extensionDate)}</TableCell>
                              <TableCell className="text-center">
                                <Badge className="bg-amber-500 text-white">+{ext.daysAdded} يوم</Badge>
                              </TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums font-medium text-amber-700">
                                {fmtDate(ext.newEndDate)}
                              </TableCell>
                              <TableCell className="text-sm max-w-[160px] truncate" title={ext.reason ?? undefined}>
                                {ext.reason ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-sm font-mono">
                                {ext.documentRef ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-sm">
                                {ext.approvedBy ?? <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="suspensions">
            <div className="space-y-4">
              {(suspensions as ProjectSuspension[]).length === 0 ? (
                <Card className="shadow-md border-0">
                  <CardContent className="py-16 text-center">
                    <PauseCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-1">لا توجد توقفات</h3>
                    <p className="text-sm text-muted-foreground">لا توجد توقفات مسجلة للمشروع</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card className="shadow-md border-0 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-violet-500" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <PauseCircle className="h-3.5 w-3.5 text-violet-500" /> عدد التوقفات المسجلة
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-violet-600">
                          {(suspensions as ProjectSuspension[]).length}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-md border-0 relative overflow-hidden">
                      <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
                      <CardContent className="pt-5">
                        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-amber-500" /> إجمالي أيام التوقف
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-amber-600">
                          {totalSuspDays} <span className="text-sm font-normal">يوم</span>
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="shadow-md border-0">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <PauseCircle className="h-5 w-5 text-violet-500" />
                        سجل التوقفات الرسمية
                      </CardTitle>
                      <CardDescription>العطل الرسمية والظروف القاهرة والتوقفات المعتمدة</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0 overflow-x-auto">
                      <Table className="min-w-[560px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">#</TableHead>
                            <TableHead className="text-right">النوع</TableHead>
                            <TableHead className="text-right">العنوان</TableHead>
                            <TableHead className="text-right">تاريخ البدء</TableHead>
                            <TableHead className="text-right">تاريخ الانتهاء</TableHead>
                            <TableHead className="text-center">الأيام</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(suspensions as ProjectSuspension[]).map((susp: ProjectSuspension, i: number) => (
                            <TableRow key={susp.id}>
                              <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                              <TableCell>
                                {susp.type === "official_holiday" ? (
                                  <Badge className="bg-violet-100 text-violet-700 border border-violet-300 text-xs">عطلة رسمية</Badge>
                                ) : susp.type === "force_majeure" ? (
                                  <Badge className="bg-red-100 text-red-700 border border-red-300 text-xs">ظرف قاهر</Badge>
                                ) : (
                                  <Badge className="bg-orange-100 text-orange-700 border border-orange-300 text-xs">توقف مقاول</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-sm font-medium">{susp.title}</TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(susp.startDate)}</TableCell>
                              <TableCell dir="ltr" className="text-sm tabular-nums">{fmtDate(susp.endDate)}</TableCell>
                              <TableCell className="text-center">
                                <Badge className="bg-amber-500 text-white">{susp.calendarDays} يوم</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="text-center pb-8">
          <p className="text-xs text-muted-foreground">نظام الإشراف الهندسي — بوابة المالك (قراءة فقط)</p>
        </div>
      </div>
    </div>
  );
}

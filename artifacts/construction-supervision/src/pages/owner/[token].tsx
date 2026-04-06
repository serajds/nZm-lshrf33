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
  CalendarDays, Gauge, Timer, ShieldCheck, CircleDot, ChevronLeft, ChevronRight, X, ZoomIn
} from "lucide-react";
import { previewReport, type ActivityForReport } from "@/lib/report-pdf";

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
  const [projectInfo, setProjectInfo] = useState<{ projectName: string; hasPassword?: boolean; companyLogos: Record<string, { name: string; logoUrl: string | null }> } | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const verifyAccess = useVerifyOwnerAccess();

  useEffect(() => {
    const name = ownerData?.project?.name || projectInfo?.projectName;
    document.title = name ? `${name} | بوابة المالك` : "بوابة المالك";
  }, [ownerData, projectInfo]);

  const autoLogin = async () => {
    try {
      const res = await fetch(`${API_BASE}/owner/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      if (data.ownerJwt) {
        sessionStorage.setItem(`owner_jwt_${token}`, data.ownerJwt);
      }
      setOwnerData(data as OwnerProjectView);
    } catch {
      setIsRestoring(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      let info: any = null;
      try {
        const r = await fetch(`${API_BASE}/owner/access/${token}`);
        if (r.ok) {
          info = await r.json();
          setProjectInfo(info);
        }
      } catch {}

      const savedJwt = sessionStorage.getItem(`owner_jwt_${token}`);
      if (savedJwt) {
        try {
          const r = await fetch(`${API_BASE}/owner/${token}/data`, {
            headers: { Authorization: `Bearer ${savedJwt}` }
          });
          if (!r.ok) throw new Error("expired");
          const data = await r.json();
          setOwnerData(data as OwnerProjectView);
          setIsRestoring(false);
          return;
        } catch {
          sessionStorage.removeItem(`owner_jwt_${token}`);
        }
      }

      if (info && !info.hasPassword) {
        await autoLogin();
        return;
      }

      setIsRestoring(false);
    };
    init();
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
      <div className="min-h-screen flex" dir="rtl">
        <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 30%, #d1fae5 60%, #a7f3d0 100%)' }}>
          <div className="absolute inset-0 opacity-[0.4]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%2310b981' fill-opacity='0.06'%3E%3Cpath d='M0 0h40v40H0V0zm40 40h40v40H40V40zm0-40h2l-2 2V0zm0 4l4-4h2l-6 6V4zm0 4l8-8h2L40 10V8zm0 4L52 0h2L40 14v-2zm0 4L56 0h2L40 18v-2zm0 4L60 0h2L40 22v-2zm0 4L64 0h2L40 26v-2zm0 4L68 0h2L40 30v-2zm0 4L72 0h2L40 34v-2zm0 4L76 0h2L40 38v-2zm0 4L80 0v2L42 40h-2zm4 0L80 4v2L46 40h-2zm4 0L80 8v2L50 40h-2zm4 0l28-28v2L54 40h-2zm4 0l24-24v2L58 40h-2zm4 0l20-20v2L62 40h-2zm4 0l16-16v2L66 40h-2zm4 0l12-12v2L70 40h-2zm4 0l8-8v2l-6 6h-2zm4 0l4-4v2l-2 2h-2z'/%3E%3C/g%3E%3C/svg%3E")` }} />

          <div className="relative z-10 flex flex-col items-center justify-center w-full p-12 xl:p-16">
            {hasLogos && (
              <div className="flex items-center gap-4 mb-12">
                {[ownerLogo, supervisorLogo].map((logo, i, arr) => {
                  if (!logo?.logoUrl) return null;
                  return (
                    <div key={i} className="flex items-center gap-4">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-[100px] h-[100px] rounded-2xl bg-white p-3 flex items-center justify-center shadow-lg shadow-emerald-900/[0.06] border border-emerald-200/50">
                          <img src={apiBase + logo.logoUrl} alt={logo.name} className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                        <div className="text-center">
                          <p className="text-[13px] font-bold text-emerald-950/80 max-w-[140px] leading-snug">{logo.name}</p>
                          <p className="text-[11px] text-emerald-700/50 font-medium mt-0.5">{i === 0 ? "المالك" : "جهة الإشراف"}</p>
                        </div>
                      </div>
                      {i === 0 && arr.filter(l => l?.logoUrl).length > 1 && (
                        <div className="w-[1px] h-20 bg-emerald-300/40 mx-4 self-start mt-5" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!hasLogos && (
              <div className="w-20 h-20 rounded-3xl bg-white shadow-lg shadow-emerald-900/[0.06] border border-emerald-200/50 flex items-center justify-center mb-10">
                <Building2 className="w-10 h-10 text-emerald-600" />
              </div>
            )}

            <div className="text-center max-w-sm">
              <h1 className="text-[36px] xl:text-[42px] font-black text-emerald-950 leading-[1.2] mb-4 tracking-tight">
                {projectInfo?.projectName || "بوابة المالك"}
              </h1>
              <div className="h-[3px] w-12 bg-emerald-500 rounded-full mx-auto mb-5" />
              <p className="text-emerald-800/50 text-[15px] leading-relaxed">
                بوابة إلكترونية لمتابعة سير العمل<br />والاطلاع على التقارير الدورية
              </p>
            </div>

            <div className="absolute bottom-8 flex items-center gap-2 text-emerald-700/30 text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>إدارة الإشراف والمتابعة</span>
            </div>
          </div>
        </div>

        <div className="w-full lg:w-[45%] bg-white flex flex-col">
          <div className="lg:hidden bg-gradient-to-b from-emerald-50 to-white border-b border-emerald-100/50 px-6 py-8 text-center">
            {hasLogos && (
              <div className="flex items-center justify-center gap-6 mb-5">
                {[ownerLogo, supervisorLogo].map((logo, i) => {
                  if (!logo?.logoUrl) return null;
                  return (
                    <div key={i} className="flex flex-col items-center gap-2">
                      <div className="w-14 h-14 rounded-xl bg-white border border-emerald-200/50 p-1.5 flex items-center justify-center shadow-sm">
                        <img src={apiBase + logo.logoUrl} alt={logo.name} className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                      <span className="text-[11px] font-bold text-emerald-900/70 max-w-[90px] text-center leading-tight">{logo.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <h1 className="text-2xl font-black text-emerald-950">{projectInfo?.projectName || "بوابة المالك"}</h1>
          </div>

          <div className="flex-1 flex items-center justify-center px-6 sm:px-10 py-12">
            <div className="w-full max-w-[380px]">
              <div className="mb-10">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-6">
                  <Lock className="w-5 h-5 text-emerald-600" />
                </div>
                <h2 className="text-[22px] font-bold text-gray-900 mb-2">تسجيل الدخول</h2>
                <p className="text-gray-400 text-[14px]">أدخل كلمة المرور المزودة من قبل جهة الإشراف</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2.5">
                  <Label className="text-[13px] font-semibold text-gray-500 tracking-wide">كلمة المرور</Label>
                  <div className="relative group">
                    <Lock className="absolute end-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300 pointer-events-none transition-colors group-focus-within:text-emerald-500" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-[52px] pe-11 ps-11 text-right rounded-xl border-gray-200 bg-gray-50/60 text-gray-800 placeholder:text-gray-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 focus:bg-white transition-all text-[15px]"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute start-4 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-[52px] rounded-xl text-[15px] font-bold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/25 transition-all duration-200"
                  disabled={verifyAccess.isPending}
                >
                  {verifyAccess.isPending ? (
                    <span className="flex items-center gap-2.5">
                      <span className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-white/30 border-t-white" />
                      جاري التحقق...
                    </span>
                  ) : "الدخول للمشروع"}
                </Button>
              </form>

              <div className="mt-10 pt-6 border-t border-gray-100 flex items-center justify-center text-gray-300 text-[12px]">
                <a href="https://about.me/seraj" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-500 transition-colors">Developed By : Eng. Seraj Elajtel</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { project, activities, reports, extensions = [], suspensions = [], summary } = ownerData;
  const totalExtDays = extensions.reduce((s: number, e: ProjectExtension) => s + e.daysAdded, 0);
  const latestExt = extensions.length > 0 ? extensions[extensions.length - 1] : null;
  const totalSuspDays = (suspensions as ProjectSuspension[]).reduce((s: number, x: ProjectSuspension) => s + x.calendarDays, 0);

  const sm = summary as any;
  const progressDiff = (sm.overallProgress ?? 0) - (sm.plannedProgress ?? 0);

  const ownerJwt = sessionStorage.getItem(`owner_jwt_${token}`) ?? "";

  const openLightbox = (images: string[], index: number) => setLightbox({ images, index });
  const closeLightbox = () => setLightbox(null);
  const lightboxPrev = () => setLightbox(prev => prev ? { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length } : null);
  const lightboxNext = () => setLightbox(prev => prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : null);

  const handlePreview = (report: Report) => {
    const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const imageUrls = (report.imageUrls ?? []).map((url) =>
      url.includes("?") ? url : `${url}?token=${ownerJwt}`
    );
    const snapshotActivities = (report as any).activitiesSnapshot as any[] | null;
    const sourceActivities = snapshotActivities ?? (activities as Activity[]);
    const activityList: ActivityForReport[] = sourceActivities.map((a: any) => ({
      name: a.name,
      plannedProgress: a.plannedProgress ?? 0,
      actualProgress: a.actualProgress ?? 0,
      status: a.status ?? "not_started",
    }));
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
      imageUrls,
      reportId: report.id,
      reportNumber: report.reportNumber,
      activities: activityList,
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
    in_progress: activities.filter((a: Activity) => a.status === "in_progress").length,
    completed: activities.filter((a: Activity) => a.status === "completed").length,
    delayed: activities.filter((a: Activity) => a.status === "delayed").length,
    not_started: activities.filter((a: Activity) => a.status === "not_started").length,
  };
  const pieData = [
    { name: "مكتمل", value: statusCounts.completed, fill: "hsl(160, 84%, 39%)" },
    { name: "قيد التنفيذ", value: statusCounts.in_progress, fill: "hsl(217, 91%, 60%)" },
    { name: "متأخر", value: statusCounts.delayed, fill: "hsl(0, 84%, 60%)" },
    { name: "لم يبدأ", value: statusCounts.not_started, fill: "hsl(var(--muted-foreground))" },
  ].filter(d => d.value > 0);

  const companyLogos = (ownerData as any)?.companyLogos;
  const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-screen bg-gradient-to-bl from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950" dir="rtl">
      <div className="bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 text-white">
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
                {(project as any).ownerEntity && (
                  <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" /> الجهة المالكة: {(project as any).ownerEntity}</span>
                )}
                {project.supervisorEntity && (
                  <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> جهة الإشراف: {project.supervisorEntity}</span>
                )}
                <span className="flex items-center gap-1.5"><HardHat className="h-4 w-4" /> المقاول: {project.contractor}</span>
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
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-emerald-400 to-emerald-600" />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <Gauge className="h-4 w-4" />
                <span className="text-xs font-medium">الإنجاز الفعلي</span>
              </div>
              <div className="text-3xl font-black text-emerald-600">{sm.overallProgress}%</div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden" dir="ltr">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${sm.overallProgress}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                <span>المخطط: {sm.plannedProgress?.toFixed(0)}%</span>
                <span className={progressDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {progressDiff > 0 ? '+' : ''}{progressDiff.toFixed(1)}%
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className={`absolute top-0 inset-x-0 h-1 ${sm.delayDays > 0 ? 'bg-gradient-to-l from-red-400 to-red-600' : 'bg-gradient-to-l from-blue-400 to-blue-600'}`} />
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
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-violet-400 to-violet-600" />
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-2">
                <ActivityIcon className="h-4 w-4" />
                <span className="text-xs font-medium">الأنشطة</span>
              </div>
              <div className="text-3xl font-black">{sm.activitiesCompleted}<span className="text-lg font-normal text-muted-foreground"> / {sm.activitiesTotal}</span></div>
              <div className="flex gap-2 mt-2 text-xs">
                {statusCounts.delayed > 0 && <span className="text-red-500">{statusCounts.delayed} متأخر</span>}
                {statusCounts.in_progress > 0 && <span className="text-blue-500">{statusCounts.in_progress} قيد التنفيذ</span>}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-lg border-0 bg-card/80 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-l from-amber-400 to-amber-600" />
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
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden" dir="ltr">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, (sm.daysElapsed / sm.totalDays) * 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">الإنجاز الفعلي</span>
                    <span className="font-medium">{sm.overallProgress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden" dir="ltr">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${sm.overallProgress}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">الأنشطة المكتملة</span>
                    <span className="font-medium">{sm.activitiesTotal > 0 ? Math.round((sm.activitiesCompleted / sm.activitiesTotal) * 100) : 0}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden" dir="ltr">
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

        <Tabs defaultValue="progress" className="w-full mb-8" dir="rtl">
          <TabsList className="w-full justify-start mb-4 flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="progress" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" />سير العمل</TabsTrigger>
            <TabsTrigger value="activities" className="gap-1.5"><ActivityIcon className="h-3.5 w-3.5" />الأنشطة</TabsTrigger>
            <TabsTrigger value="reports" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />التقارير
              {reports.length > 0 && <Badge className="ms-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0">{reports.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="extensions" className="gap-1.5">
              <ArrowBigRightDash className="h-3.5 w-3.5" />التمديدات
              {extensions.length > 0 && <Badge className="ms-1 bg-amber-500 text-white text-[10px] px-1.5 py-0">{extensions.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="suspensions" className="gap-1.5">
              <PauseCircle className="h-3.5 w-3.5" />التوقفات
              {(suspensions as ProjectSuspension[]).length > 0 && <Badge className="ms-1 bg-violet-500 text-white text-[10px] px-1.5 py-0">{(suspensions as ProjectSuspension[]).length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="progress" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="shadow-md border-0 lg:col-span-2">
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
                        <XAxis dataKey="name" angle={-40} textAnchor="end" height={80} interval={0} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} reversed />
                        <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} tick={{ fill: 'hsl(var(--muted-foreground))' }} orientation="right" />
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

              <Card className="shadow-md border-0">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ActivityIcon className="h-5 w-5 text-primary" />
                    توزيع حالة الأنشطة
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {pieData.length > 0 ? (
                    <>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                              {pieData.map((entry: any, index: number) => (
                                <Cell key={index} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ textAlign: 'right', direction: 'rtl', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: '12px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-wrap gap-3 justify-center mt-2">
                        {pieData.map((d: any) => (
                          <span key={d.name} className="flex items-center gap-1.5 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: d.fill }} />
                            {d.name}: {d.value}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground text-sm">لا توجد أنشطة</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-md border-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  ملخص التقدم الزمني
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="text-center p-4 rounded-lg bg-blue-50 border border-blue-100">
                    <div className="text-3xl font-black text-blue-600">{sm.plannedProgress?.toFixed(0) ?? 0}%</div>
                    <div className="text-sm text-blue-600/80 mt-1">الإنجاز المخطط</div>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-emerald-50 border border-emerald-100">
                    <div className="text-3xl font-black text-emerald-600">{sm.overallProgress ?? 0}%</div>
                    <div className="text-sm text-emerald-600/80 mt-1">الإنجاز الفعلي</div>
                  </div>
                  <div className={`text-center p-4 rounded-lg ${progressDiff >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                    <div className={`text-3xl font-black ${progressDiff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {progressDiff > 0 ? '+' : ''}{progressDiff.toFixed(1)}%
                    </div>
                    <div className={`text-sm mt-1 ${progressDiff >= 0 ? 'text-emerald-600/80' : 'text-red-600/80'}`}>
                      {progressDiff >= 0 ? 'متقدم عن الخطة' : 'متأخر عن الخطة'}
                    </div>
                  </div>
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
                            <div className="h-2 rounded-full bg-muted overflow-hidden" dir="ltr">
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
                          <div className="h-2 bg-muted rounded-full overflow-hidden" dir="ltr">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${report.progressPercentage}%` }} />
                          </div>
                        </div>
                        {report.periodStart && report.periodEnd && (
                          <div className="text-xs text-muted-foreground border-s ps-4">
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

                      {(() => {
                        const reportActivities = (report.activitiesSnapshot as any[] | null) ?? activities;
                        if (reportActivities.length === 0) return null;
                        return (
                          <div className="pt-3 border-t">
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                              <ActivityIcon className="h-4 w-4 text-blue-500" /> الأنشطة ({reportActivities.length})
                              {!report.activitiesSnapshot && (
                                <span className="text-[10px] text-muted-foreground font-normal">(بيانات حالية)</span>
                              )}
                            </h4>
                            <div className="overflow-x-auto rounded-lg border">
                              <Table className="min-w-[500px]">
                                <TableHeader>
                                  <TableRow className="bg-muted/40">
                                    <TableHead className="text-right text-xs py-2">النشاط</TableHead>
                                    <TableHead className="text-center text-xs py-2 w-24">المخطط %</TableHead>
                                    <TableHead className="text-center text-xs py-2 w-24">الفعلي %</TableHead>
                                    <TableHead className="text-center text-xs py-2 w-28">الحالة</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {reportActivities.map((act: any) => (
                                    <TableRow key={act.id}>
                                      <TableCell className="text-sm py-1.5">{act.name}</TableCell>
                                      <TableCell className="text-center text-sm py-1.5 tabular-nums">{act.plannedProgress}%</TableCell>
                                      <TableCell className="text-center text-sm py-1.5 tabular-nums font-medium">{act.actualProgress}%</TableCell>
                                      <TableCell className="text-center py-1.5">
                                        {act.status === "completed" ? (
                                          <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-300 text-[10px] px-1.5">مكتمل</Badge>
                                        ) : act.status === "in_progress" ? (
                                          <Badge className="bg-blue-100 text-blue-700 border border-blue-300 text-[10px] px-1.5">قيد التنفيذ</Badge>
                                        ) : act.status === "delayed" ? (
                                          <Badge className="bg-red-100 text-red-700 border border-red-300 text-[10px] px-1.5">متأخر</Badge>
                                        ) : (
                                          <Badge className="bg-gray-100 text-gray-600 border border-gray-300 text-[10px] px-1.5">لم يبدأ</Badge>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        );
                      })()}

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

                      {report.imageUrls && report.imageUrls.length > 0 && (() => {
                        const authImages = report.imageUrls!.map(url => url.includes("?") ? url : `${url}?token=${ownerJwt}`);
                        return (
                          <div className="pt-3 border-t">
                            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                              <ZoomIn className="h-4 w-4 text-muted-foreground" />
                              صور الموقع
                              <span className="text-xs text-muted-foreground font-normal">({report.imageUrls!.length} صورة)</span>
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {authImages.map((authUrl, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => openLightbox(authImages, idx)}
                                  className="group relative w-16 h-16 rounded-lg overflow-hidden border bg-muted cursor-pointer flex-shrink-0 hover:ring-2 hover:ring-emerald-500 transition-all"
                                >
                                  <img
                                    src={authUrl}
                                    alt={`صورة ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                  />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                    <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
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
                      <div className="absolute top-0 inset-x-0 h-1 bg-slate-400" />
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
                      <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
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
                      <div className="absolute top-0 inset-x-0 h-1 bg-amber-400" />
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
                      <div className="absolute top-0 inset-x-0 h-1 bg-violet-500" />
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
                      <div className="absolute top-0 inset-x-0 h-1 bg-amber-500" />
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
          <p className="text-xs text-muted-foreground">إدارة الإشراف والمتابعة — بوابة المالك (قراءة فقط)</p>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeLightbox();
            if (e.key === "ArrowLeft") lightboxNext();
            if (e.key === "ArrowRight") lightboxPrev();
          }}
          tabIndex={0}
          ref={(el) => el?.focus()}
          role="dialog"
          aria-modal="true"
          aria-label={`عرض صورة ${lightbox.index + 1} من ${lightbox.images.length}`}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            className="absolute top-4 start-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="absolute top-4 end-4 z-10 bg-white/10 text-white text-sm px-3 py-1.5 rounded-full" dir="ltr">
            {lightbox.index + 1} / {lightbox.images.length}
          </div>

          {lightbox.images.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                aria-label="الصورة السابقة"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                aria-label="الصورة التالية"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            </>
          )}

          <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.images[lightbox.index]}
              alt={`صورة ${lightbox.index + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useGetProjectSummary,
  useGenerateOwnerLink,
  useListActivities,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, MapPin, Calendar, ActivitySquare, CheckCircle2,
  AlertTriangle, ArrowRight, Share2, Copy, Clock, ArrowBigRightDash, PauseCircle, FileText
} from "lucide-react";
import { ProjectNav } from "@/components/project-nav";
import { ProjectMembers } from "@/components/project-members";
import { previewExecutiveSummary, type ActivityForReport } from "@/lib/report-pdf";

interface ProjectExtension {
  id: number;
  extensionDate: string;
  daysAdded: number;
  newEndDate: string;
  reason: string | null;
  documentRef: string | null;
}

function authFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

export default function ProjectDetails() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerSlug, setOwnerSlug] = useState("");
  const [ownerLink, setOwnerLink] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);

  const { data: project, isLoading: isProjectLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId }
  });
  const { data: summary, isLoading: isSummaryLoading } = useGetProjectSummary(projectId, {
    query: { enabled: !!projectId }
  });
  const { data: activities = [] } = useListActivities(projectId, { query: { enabled: !!projectId } });
  const { data: extensions = [] } = useQuery<ProjectExtension[]>({
    queryKey: [`/api/projects/${projectId}/extensions`],
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/extensions`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  const totalExtDays = extensions.reduce((s, e) => s + e.daysAdded, 0);
  const latestEndDate = extensions.length > 0
    ? extensions[extensions.length - 1].newEndDate
    : null;

  const generateLink = useGenerateOwnerLink();

  const handleExecutiveSummary = async () => {
    if (!project) return;
    const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
    const token = localStorage.getItem("auth_token");
    let companyLogos: any;
    try {
      const r = await fetch(`${API_BASE}/projects/${projectId}/company-logos`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (r.ok) companyLogos = await r.json();
    } catch {}
    const actList: ActivityForReport[] = (activities as any[]).map((a: any) => ({
      name: a.name,
      plannedProgress: a.plannedProgress ?? 0,
      actualProgress: a.actualProgress ?? 0,
      status: a.status ?? "not_started",
    }));
    previewExecutiveSummary({
      projectName: project.name,
      ownerEntity: project.ownerEntity,
      contractor: project.contractor,
      supervisorEntity: project.supervisorEntity,
      location: project.location,
      startDate: project.startDate,
      expectedEndDate: project.expectedEndDate,
      actualEndDate: (project as any).actualEndDate,
      status: project.status,
      overallProgress: summary?.overallProgress ?? project.overallProgress ?? 0,
      plannedProgress: summary?.plannedProgress ?? 0,
      activities: actList,
      reportsCount: summary?.reportsCount ?? 0,
      contractValue: (project as any).contractValue,
      companyLogos,
      apiBase: import.meta.env.BASE_URL.replace(/\/$/, ""),
      suspensionDays: summary?.suspensionDays ?? 0,
      extensionDays: totalExtDays,
    });
  };

  const handleGenerateLink = async () => {
    try {
      const payload: any = {};
      if (ownerPassword) payload.password = ownerPassword;
      if (ownerSlug.trim()) {
        payload.customSlug = ownerSlug.trim();
      }
      const res = await generateLink.mutateAsync({ projectId, data: payload });
      setOwnerLink(`${window.location.origin}/owner/${res.token}`);
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      toast({ title: "تم إنشاء الرابط بنجاح" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "فشل إنشاء الرابط";
      toast({ variant: "destructive", title: msg });
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(ownerLink);
    toast({ title: "تم نسخ الرابط" });
  };

  if (isProjectLoading || isSummaryLoading)
    return <div className="flex h-40 items-center justify-center text-muted-foreground">جاري التحميل...</div>;
  if (!project)
    return <div className="flex h-40 items-center justify-center text-muted-foreground">المشروع غير موجود</div>;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-primary text-primary-foreground">نشط</Badge>;
      case "completed": return <Badge className="bg-emerald-600 text-white">مكتمل</Badge>;
      case "delayed": return <Badge variant="destructive">متأخر</Badge>;
      case "suspended": return <Badge className="bg-orange-500 text-white">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mt-0.5"
          onClick={() => setLocation("/projects")}
        >
          <ArrowRight className="h-5 w-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {getStatusBadge(project.status)}
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {project.location}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          <Dialog open={isLinkDialogOpen} onOpenChange={(open) => {
            setIsLinkDialogOpen(open);
            if (open) {
              setOwnerLink("");
              setOwnerPassword("");
              setShowRegenerateForm(!(project as any)?.ownerAccessToken);
              setOwnerSlug((project as any)?.ownerAccessToken || "");
            }
          }}>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExecutiveSummary}>
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">ملخص تنفيذي</span>
            </Button>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Share2 className="h-4 w-4" />
                <span className="hidden sm:inline">رابط المالك</span>
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>{(project as any)?.ownerAccessToken ? "رابط المالك" : "إنشاء رابط للمالك"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                {(project as any)?.ownerAccessToken && !ownerLink && (
                  <div className="space-y-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                    <Label className="text-sm font-medium text-emerald-700 dark:text-emerald-400">الرابط الحالي</Label>
                    <div className="flex gap-2">
                      <Input value={`${window.location.origin}/owner/${(project as any).ownerAccessToken}`} readOnly dir="ltr" className="text-left text-xs" />
                      <Button variant="secondary" onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/owner/${(project as any).ownerAccessToken}`);
                        toast({ title: "تم نسخ الرابط" });
                      }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">شارك هذا الرابط مع المالك لمتابعة حالة المشروع</p>
                  </div>
                )}

                {ownerLink && (
                  <div className="space-y-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                    <Label className="text-sm font-medium text-emerald-700 dark:text-emerald-400">الرابط الجديد</Label>
                    <div className="flex gap-2">
                      <Input value={ownerLink} readOnly dir="ltr" className="text-left text-xs" />
                      <Button variant="secondary" onClick={copyLink}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      شارك هذا الرابط مع المالك لمتابعة حالة المشروع.
                    </p>
                  </div>
                )}

                {!ownerLink && (project as any)?.ownerAccessToken && !showRegenerateForm && (
                  <Button variant="outline" onClick={() => setShowRegenerateForm(true)} className="w-full text-muted-foreground">
                    تغيير الرابط أو كلمة المرور
                  </Button>
                )}

                {(showRegenerateForm && !ownerLink) && (
                  <>
                    {(project as any)?.ownerAccessToken && (
                      <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">تنبيه: إنشاء رابط جديد سيلغي الرابط الحالي ولن يعمل بعد ذلك.</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>اسم الرابط المخصص (اختياري)</Label>
                      <div className="flex items-center gap-2" dir="ltr">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">/owner/</span>
                        <Input
                          value={ownerSlug}
                          onChange={(e) => setOwnerSlug(e.target.value)}
                          placeholder="مثال: project-name"
                          dir="ltr"
                          className="text-left"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">اتركه فارغاً لإنشاء رابط تلقائي</p>
                    </div>
                    <div className="space-y-2">
                      <Label>كلمة مرور للرابط (اختياري)</Label>
                      <Input
                        type="password"
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        placeholder="اتركه فارغاً للدخول بدون كلمة مرور"
                      />
                    </div>
                    <Button onClick={handleGenerateLink} disabled={generateLink.isPending} className="w-full">
                      {(project as any)?.ownerAccessToken ? "تحديث الرابط" : "إنشاء الرابط"}
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Project Navigation ── */}
      <ProjectNav projectId={project.id} />

      {/* ── Summary Content ── */}
      <div className="space-y-5">
        {/* Progress + KPIs */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">نسبة الإنجاز</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-3">
                <div className="text-4xl font-bold tabular-nums">
                  {summary?.overallProgress ?? 0}%
                </div>
                <div className="text-sm text-muted-foreground">
                  المخطط: {summary?.plannedProgress ?? 0}%
                </div>
              </div>
              <div className="relative w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="absolute top-0 right-0 h-full bg-primary/25 rounded-full"
                  style={{ width: `${summary?.plannedProgress ?? 0}%` }}
                />
                <div
                  className="absolute top-0 right-0 h-full bg-primary rounded-full"
                  style={{ width: `${summary?.overallProgress ?? 0}%` }}
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <p className={`text-sm flex items-center gap-1.5 font-medium ${(summary?.delayDays ?? 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {(summary?.delayDays ?? 0) > 0 ? (
                    <><AlertTriangle className="h-4 w-4 shrink-0" /> تأخير إجمالي: {summary!.delayDays} يوم</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 shrink-0" /> لا تأخير إجمالي</>
                  )}
                </p>
                <p className="text-sm text-amber-600 flex items-center gap-1.5 font-medium">
                  <PauseCircle className="h-4 w-4 shrink-0" />
                  توقفات مشروعة: {summary?.suspensionDays ?? 0} يوم
                </p>
                <p className={`text-sm flex items-center gap-1.5 font-semibold ${(summary?.netDelayDays ?? 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                  {(summary?.netDelayDays ?? 0) > 0 ? (
                    <><AlertTriangle className="h-4 w-4 shrink-0" /> صافي التأخير: {summary!.netDelayDays} يوم</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 shrink-0" /> لا تأخير صافي</>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مؤشرات الأداء</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">الأنشطة المكتملة</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.activitiesCompleted ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {summary?.activitiesTotal ?? 0}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">أنشطة متأخرة</p>
                <p className="text-xl font-bold tabular-nums text-destructive">
                  {summary?.activitiesDelayed ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">الأيام المنقضية</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.daysElapsed ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {summary?.totalDays ?? 0}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">تقارير / ملفات</p>
                <p className="text-xl font-bold tabular-nums">
                  {summary?.reportsCount ?? 0}
                  <span className="text-muted-foreground font-normal"> / </span>
                  {summary?.filesCount ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Contract Details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">تفاصيل العقد</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { icon: Building2, label: "الجهة المالكة", value: project.ownerEntity },
                { icon: Building2, label: "المقاول المنفذ", value: project.contractor },
                { icon: ActivitySquare, label: "الجهة المشرفة", value: project.supervisorEntity },
                { icon: MapPin, label: "الموقع", value: project.location },
                {
                  icon: Calendar, label: "تاريخ البداية",
                  value: fmtDate(project.startDate),
                  ltr: true,
                },
                {
                  icon: Calendar, label: "النهاية التعاقدية الأصلية",
                  value: fmtDate(project.expectedEndDate),
                  ltr: true,
                },
                ...(latestEndDate ? [{
                  icon: ArrowBigRightDash, label: `النهاية بعد التمديد (+${totalExtDays} يوم)`,
                  value: fmtDate(latestEndDate),
                  ltr: true,
                  highlight: true,
                }] : []),
                ...(project.actualEndDate ? [{
                  icon: Clock, label: "النهاية الفعلية",
                  value: fmtDate(project.actualEndDate),
                  ltr: true,
                }] : []),
              ].map((item, i) => (
                <div key={i} className={`space-y-1 ${(item as { highlight?: boolean }).highlight ? "rounded-md bg-amber-50 border border-amber-200 px-2 py-1" : ""}`}>
                  <p className={`text-xs font-medium flex items-center gap-1.5 ${(item as { highlight?: boolean }).highlight ? "text-amber-700" : "text-muted-foreground"}`}>
                    <item.icon className="h-3.5 w-3.5 shrink-0" />
                    {item.label}
                  </p>
                  <p className={`text-sm ${(item as { highlight?: boolean }).highlight ? "text-amber-800 font-semibold" : "text-foreground"}`} dir={item.ltr ? "ltr" : undefined}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Team Members */}
        <ProjectMembers projectId={project.id} />
      </div>
    </div>
  );
}

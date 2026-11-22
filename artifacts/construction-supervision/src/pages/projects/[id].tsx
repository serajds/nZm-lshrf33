import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  useGetProjectSummary,
  useGenerateOwnerLink,
  fetchWithSession,
} from "@workspace/api-client-react";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2, MapPin, Calendar, ActivitySquare, CheckCircle2,
  AlertTriangle, ArrowRight, Share2, Copy, Clock, PauseCircle, FileText, Presentation,
  Settings2, LayoutDashboard, History, Link2, ChevronDown, Users
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectNav } from "@/components/project-nav";
import { ProjectMembers } from "@/components/project-members";
import { ProjectQuickViewDialog } from "@/components/project-quick-view-dialog";
import { AttendanceQuickActions } from "@/components/attendance-quick-actions";
import { ProjectProgressHistoryBackfill } from "@/components/project-progress-history-backfill";
import { LinkedSourceHistoryRepair } from "@/components/linked-source-history-repair";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
// PERFORMANCE (dev): leaflet + react-leaflet pull a large dependency tree
// that Vite must transform on first navigation, blocking the project page
// for several seconds. The map is rendered well below the fold and isn't
// needed for the initial loading state, so load it lazily.
const SiteGeofenceMap = lazy(() =>
  import("@/components/site-geofence-map").then((m) => ({ default: m.SiteGeofenceMap }))
);
// PERFORMANCE: jspdf is only needed when the user clicks "تنزيل الملخص"
// — defer loading until the click handler runs.
import { useAuth } from "@/hooks/use-auth";
import { loadExecutiveSummaryData } from "@/lib/executive-summary-data";

interface ProjectExtension {
  id: number;
  extensionDate: string;
  daysAdded: number;
  newEndDate: string;
  reason: string | null;
  documentRef: string | null;
}

interface SummaryWidget {
  id: string;
  label: string;
  templateId: number | null;
  fieldId: string | null;
  value?: any;
  fieldLabel?: string;
  reportDate?: string;
  submittedAt?: string;
}

interface FormTemplateOption {
  id: number;
  name: string;
  fields: { id: string; label: string; type: string }[];
}

export default function ProjectDetails() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const { user } = useAuth();
  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;
  const queryClient = useQueryClient();
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerSlug, setOwnerSlug] = useState("");
  const [ownerLink, setOwnerLink] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingSlides, setIsGeneratingSlides] = useState(false);
  const [activeHistoryTool, setActiveHistoryTool] = useState<"history" | "linked-sources" | null>(null);
  const [isSiteSectionOpen, setIsSiteSectionOpen] = useState(false);
  const [isTeamSectionOpen, setIsTeamSectionOpen] = useState(false);

  // The project record itself rarely changes during a session and is read
  // by every project sub-page (overview, reports, activities, files…). A
  // 5-minute staleTime + previous-data fallback keeps tab-switching from
  // re-fetching it and from flashing an empty header on every navigation.
  const { data: project, isLoading: isProjectLoading, error: projectError } = useGetProject(projectId, {
    query: {
      enabled: !!projectId,
      staleTime: 1000 * 60 * 5,
    } as any,
  });
  usePageTitle(project?.name ?? "تفاصيل المشروع");
  // Project summary aggregates progress + activities + recent reports —
  // it's the heaviest query on this page. Same treatment: keep the prior
  // payload visible so the overview never blanks while revalidating.
  const { data: summary, isLoading: isSummaryLoading, isError: summaryError, refetch: refetchSummary } = useGetProjectSummary(projectId, {
    query: {
      enabled: !!projectId,
      staleTime: 1000 * 60 * 5,
    } as any,
  });

  // Start the permissions request with the project page. Requests for each
  // tab's data wait until visibility is known, then run in parallel; React
  // Query deduplicates them when child components mount.
  const { data: myPermissions } = useMyProjectPermissions(projectId);
  const tabPermissions = myPermissions?.tabPermissions;
  const canViewTab = (tab: string) =>
    !!tabPermissions && tabPermissions[tab as keyof typeof tabPermissions] !== "hidden";
  // Member data is loaded by ProjectMembers only when the user opens its
  // collapsed section, avoiding unnecessary requests on the overview page.
  useQuery<unknown[]>({
    queryKey: [`/api/projects/${projectId}/activity-groups`],
    queryFn: async () => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups`);
      if (!r.ok) throw Object.assign(new Error("تعذّر تحميل المجموعات"), { status: r.status });
      return r.json();
    },
    enabled: !!projectId && !isContractor && canViewTab("activities"),
    staleTime: 1000 * 60 * 5,
  });
  useQuery<unknown[]>({
    queryKey: ["/api/attendance/my-status"],
    queryFn: async () => {
      const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
      const r = await fetchWithSession(`${API_BASE}/attendance/my-status`);
      if (!r.ok) throw Object.assign(new Error("تعذّر قراءة حالة الحضور"), { status: r.status });
      return r.json();
    },
    enabled: !!user && !isContractor && user.role !== "owner" && canViewTab("attendance"),
  });
  // These three lists rarely change during a session; trust the cache for
  // 5 minutes so navigating between project tabs doesn't re-hit the API.
  const { data: extensions = [] } = useQuery<ProjectExtension[]>({
    queryKey: [`/api/projects/${projectId}/extensions`],
    queryFn: async () => {
      const r = await fetchWithSession(`/api/projects/${projectId}/extensions`);
      if (!r.ok) throw Object.assign(new Error("تعذّر تحميل التمديدات"), { status: r.status });
      return r.json();
    },
    enabled: !!projectId && canViewTab("extensions"),
    staleTime: 1000 * 60 * 5,
  });

  const totalExtDays = extensions.reduce((s, e) => s + e.daysAdded, 0);
  const latestEndDate = extensions.length > 0
    ? extensions[extensions.length - 1].newEndDate
    : null;

  const { data: widgets = [], refetch: refetchWidgets } = useQuery<SummaryWidget[]>({
    queryKey: [`/api/projects/${projectId}/summary-widgets`],
    queryFn: async () => {
      const r = await fetchWithSession(`/api/projects/${projectId}/summary-widgets`);
      if (!r.ok) throw Object.assign(new Error("تعذّر تحميل أدوات الملخص"), { status: r.status });
      return r.json();
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
  });

  // IMPORTANT: share the same cache key as the forms tab so opening the
  // project overview AFTER the forms tab (or vice-versa) doesn't re-fetch
  // the same /form-templates endpoint a second time.
  const [widgetConfigOpen, setWidgetConfigOpen] = useState(false);
  const { data: formTemplates = [] } = useQuery<FormTemplateOption[]>({
    queryKey: [`/api/projects/${projectId}/form-templates`],
    queryFn: async () => {
      const r = await fetchWithSession(`/api/projects/${projectId}/form-templates`);
      if (!r.ok) throw Object.assign(new Error("تعذّر تحميل النماذج"), { status: r.status });
      return r.json();
    },
    enabled: !!projectId && canViewTab("forms"),
    staleTime: 1000 * 60 * 5,
  });

  const [editWidgets, setEditWidgets] = useState<SummaryWidget[]>([]);
  const isAdminOrPM = user?.role === "admin" || user?.role === "project_manager" || (user?.role === "engineer" && !isContractor);

  useEffect(() => {
    if (widgetConfigOpen) {
      if (widgets.length > 0) {
        setEditWidgets(widgets.map(w => ({ ...w })));
      } else {
        setEditWidgets([
          { id: "w1", label: "", templateId: null, fieldId: null },
          { id: "w2", label: "", templateId: null, fieldId: null },
        ]);
      }
    }
  }, [widgetConfigOpen]);

  const handleSaveWidgets = async () => {
    const r = await fetchWithSession(`/api/projects/${projectId}/summary-widgets`, {
      method: "PUT",
      body: JSON.stringify({ widgets: editWidgets.map(w => ({ id: w.id, templateId: w.templateId, fieldId: w.fieldId })) }),
    });
    if (r.ok) {
      toast({ title: "تم حفظ الأدوات" });
      refetchWidgets();
      setWidgetConfigOpen(false);
    } else {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  const generateLink = useGenerateOwnerLink();

  const handleExecutiveSummary = async () => {
    if (!project) return;
    setIsGeneratingSummary(true);
    try {
      const data = await loadExecutiveSummaryData(projectId);
      const logos = await fetchWithSession(`/api/projects/${projectId}/company-logos`);
      if (!logos.ok) throw new Error("تعذر تحميل شعارات الجهات");
      const { previewExecutiveSummary } = await import("@/lib/report-pdf");
      previewExecutiveSummary({...data, companyLogos:await logos.json(),apiBase:import.meta.env.BASE_URL.replace(/\/$/, "")});
    } catch (error) {
      toast({variant:"destructive",title:"تعذر إنشاء الملخص التنفيذي",description:error instanceof Error?error.message:undefined});
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleExecutiveSlides = async () => {
    if (!project) return;
    setIsGeneratingSlides(true);
    try {
      const data = await loadExecutiveSummaryData(projectId);
      const { previewExecutiveSlides } = await import("@/lib/report-pdf");
      previewExecutiveSlides({...data,apiBase:import.meta.env.BASE_URL.replace(/\/$/, "")});
    } catch (err) {
      console.error("Executive slides generation failed", err);
      toast({ variant: "destructive", title: "تعذر إنشاء العرض التقديمي" });
    } finally {
      setIsGeneratingSlides(false);
    }
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
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">جاري تحميل المشروع...</p>
        </div>
      </div>
    );
  if (!project) {
    // Distinguish a real "this project does not exist / you have no access"
    // (404 / 403) from a transient or auth-related failure. For 401, the
    // central handler already redirected to /login, so we just keep the
    // loading spinner up until the redirect happens.
    const status = (projectError as { status?: number } | undefined)?.status;
    if (status === 401) {
      return (
        <div className="flex h-[60vh] items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-muted-foreground text-sm">جاري إعادة توجيهك إلى تسجيل الدخول...</p>
          </div>
        </div>
      );
    }
    if (status === 404 || status === 403) {
      return <div className="flex h-40 items-center justify-center text-muted-foreground">المشروع غير موجود</div>;
    }
    return (
      <div className="flex h-40 items-center justify-center text-center text-muted-foreground">
        تعذّر تحميل المشروع. حاول التحديث بعد قليل.
      </div>
    );
  }
  if (!summary && summaryError) return (
    <div role="alert" className="rounded-lg border p-6 text-center">
      تعذّر تحميل ملخص المشروع. لم تُحتسب مؤشرات بديلة.
      <Button variant="outline" onClick={() => { void refetchSummary(); }}>إعادة المحاولة</Button>
    </div>
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-primary text-white">نشط</Badge>;
      case "completed": return <Badge className="bg-emerald-600 text-white">مكتمل</Badge>;
      case "delayed": return <Badge variant="destructive">متأخر</Badge>;
      case "suspended": return <Badge className="bg-orange-500 text-white">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <ProjectQuickViewDialog
        projectId={projectId}
        widgets={widgets}
        enabled={!!projectId}
      />
      {/* ── Header ── */}
      <div className="page-hero">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 mt-0.5 shrink-0 text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setLocation("/projects")}
              aria-label="العودة إلى المشاريع"
              title="العودة إلى المشاريع"
            >
              <ArrowRight className="h-5 w-5" />
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="relative z-10 break-words text-lg font-bold leading-tight text-white md:text-2xl">{project.name}</h1>
              <div className="relative z-10 mt-2 flex flex-wrap items-center gap-2">
                {getStatusBadge(project.status)}
                <span className="flex min-w-0 items-center gap-1 text-sm text-white/70">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{project.location}</span>
                </span>
              </div>
            </div>
          </div>

        {!isContractor && <div className="w-full shrink-0 sm:w-auto">
          <Dialog open={isLinkDialogOpen} onOpenChange={(open) => {
            setIsLinkDialogOpen(open);
            if (open) {
              setOwnerLink("");
              setOwnerPassword("");
              setShowRegenerateForm(!(project as any)?.ownerAccessToken);
              setOwnerSlug((project as any)?.ownerAccessToken || "");
            }
          }}>
            <div className="relative z-10 flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-white/20 bg-white text-primary shadow-sm hover:bg-white/90 hover:text-primary"
                onClick={handleExecutiveSummary}
                disabled={isGeneratingSummary}
                aria-label={isGeneratingSummary ? "جاري تجهيز الملخص التنفيذي" : "الملخص التنفيذي"}
                title={isGeneratingSummary ? "جاري تجهيز الملخص التنفيذي" : "الملخص التنفيذي"}
              >
                {isGeneratingSummary ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={handleExecutiveSlides}
                disabled={isGeneratingSlides}
                aria-label={isGeneratingSlides ? "جاري تجهيز العرض التقديمي" : "عرض تقديمي"}
                title={isGeneratingSlides ? "جاري تجهيز العرض التقديمي" : "عرض تقديمي"}
              >
                {isGeneratingSlides ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Presentation className="h-4 w-4" />}
              </Button>
              {(user?.role === "admin" || myPermissions?.projectRole === "project_manager") && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                      aria-label="أدوات السجل التاريخي"
                      title="أدوات السجل التاريخي"
                    >
                      <Settings2 className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60 text-right" style={{ direction: "rtl" }}>
                    <DropdownMenuLabel>أدوات السجل التاريخي</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="min-h-11 gap-2"
                      onSelect={() => setActiveHistoryTool("history")}
                    >
                      <History className="h-4 w-4 text-primary" />
                      إعدادات السجل التاريخي
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11 gap-2"
                      onSelect={() => setActiveHistoryTool("linked-sources")}
                    >
                      <Link2 className="h-4 w-4 text-primary" />
                      مصادر المقاول المرتبطة
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  aria-label="رابط المالك"
                  title="رابط المالك"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
            </div>
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
        </div>}
        </div>
      </div>

      <ProjectProgressHistoryBackfill
        projectId={project.id}
        showCard={false}
        open={activeHistoryTool === "history"}
        onOpenChange={open => { if (!open) setActiveHistoryTool(null); }}
      />
      <LinkedSourceHistoryRepair
        projectId={project.id}
        showCard={false}
        open={activeHistoryTool === "linked-sources"}
        onOpenChange={open => { if (!open) setActiveHistoryTool(null); }}
      />

      {/* ── Project Navigation ── */}
      <ProjectNav projectId={project.id} />

      {/* ── Quick attendance check-in/out (visible to non-owner staff) ── */}
      <AttendanceQuickActions
        projectId={project.id}
        project={{
          name: project.name,
          siteLatitude: project.siteLatitude,
          siteLongitude: project.siteLongitude,
          siteRadiusMeters: project.siteRadiusMeters,
        }}
      />

      {/* ── Summary Content ── */}
      <div className="space-y-5">
        {/* Progress + KPIs */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <Card className="surface-card surface-card-hover overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ActivitySquare className="h-4 w-4 text-primary" />
                تقدم المشروع
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border/70 bg-muted/20 p-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">الإنجاز الفعلي</p>
                  <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-primary">
                    {(summary?.overallProgress ?? 0).toFixed(1)}%
                  </p>
                </div>
                {!summary?.noSchedule && (
                  <div className="rounded-lg bg-background px-3 py-2 text-right">
                    <p className="text-[11px] text-muted-foreground">المخطط حتى اليوم</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {summary?.plannedProgress == null ? "—" : `${summary.plannedProgress.toFixed(1)}%`}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> فعلي</span>
                  {!summary?.noSchedule && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary/30" /> مخطط</span>}
                </div>
                <div
                  className="relative h-3 w-full overflow-hidden rounded-full bg-secondary/80"
                  role="img"
                  aria-label={`الإنجاز الفعلي ${(summary?.overallProgress ?? 0).toFixed(1)} بالمئة${summary?.noSchedule ? "" : `، والمخطط ${summary?.plannedProgress == null ? "غير متاح" : `${summary.plannedProgress.toFixed(1)} بالمئة`}`}`}
                >
                {!summary?.noSchedule && (
                  <div
                    className="absolute top-0 right-0 h-full bg-primary/25 rounded-full"
                    style={{ width: `${summary?.plannedProgress ?? 0}%` }}
                  />
                )}
                <div
                  className="absolute top-0 right-0 h-full bg-primary rounded-full"
                  style={{ width: `${summary?.overallProgress ?? 0}%` }}
                />
              </div>
              </div>
              {summary?.noSchedule ? (
                <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    مشروع بدون جدول زمني معتمد — لا يُحسب الانحراف عن الخطة ولا تجاوز المدة
                  </p>
                </div>
              ) : (
                <div className="space-y-2 border-t border-border/70 pt-3">
                  <p className="border-r-2 border-muted pr-2 text-[11px] leading-relaxed text-muted-foreground">
                    المكافئ الزمني تقدير لفجوة التقدم، وليس تأخيرًا تعاقديًا أو تحليل مسار حرج. التجاوز يُقاس مقابل النهاية المجدولة الحالية.
                  </p>
                  <p className={`flex items-center gap-1.5 text-sm font-medium ${(summary?.delayDays ?? 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {(summary?.delayDays ?? 0) > 0 ? (
                      <><AlertTriangle className="h-4 w-4 shrink-0" /> مكافئ فجوة التقدم التقديري: {summary!.delayDays} يوم</>
                    ) : summary?.delayDays==null ? (
                      <>مكافئ فجوة التقدم: غير متاح</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 shrink-0" /> لا يوجد انحراف عن الخطة</>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
                    <PauseCircle className="h-4 w-4 shrink-0" />
                    توقفات مسجلة دون تكرار: {summary?.suspensionDays ?? 0} يوم
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    صافي التأخر غير محسوب؛ لا يُخصم التوقف تلقائيًا دون إثبات أثره.
                  </p>
                  <p className={`flex items-center gap-1.5 border-t border-border/70 pt-2 text-sm font-semibold ${(summary?.overrunDays ?? 0) > 0 ? "text-destructive" : "text-emerald-600"}`}>
                    {(summary?.overrunDays ?? 0) > 0 ? (
                      <><AlertTriangle className="h-4 w-4 shrink-0" /> تجاوز النهاية المجدولة: {summary!.overrunDays} يوم</>
                    ) : summary?.overrunDays==null ? (
                      <>تجاوز النهاية المجدولة: غير متاح</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 shrink-0" /> لا يوجد تجاوز للنهاية المجدولة</>
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-card surface-card-hover">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutDashboard className="h-4 w-4 text-primary" />
                مؤشرات المشروع
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-[11px] text-muted-foreground">البنود المكتملة</p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {summary?.activitiesCompleted ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {summary?.activitiesTotal ?? 0}</span>
                </p>
              </div>
              {!summary?.noSchedule && (
                <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">بنود متأخرة</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-destructive">
                    {summary?.activitiesDelayed ?? 0}
                  </p>
                </div>
              )}
              {!summary?.noSchedule && (
                <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">الأيام المنقضية</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {summary?.daysElapsed ?? 0}
                    <span className="text-sm font-normal text-muted-foreground"> / {summary?.totalDays ?? 0}</span>
                  </p>
                </div>
              )}
              <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-3">
                <p className="text-[11px] text-muted-foreground">التقارير / الملفات</p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {summary?.reportsCount ?? 0}
                  <span className="text-muted-foreground font-normal"> / </span>
                  {summary?.filesCount ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary Widgets */}
        {(widgets.length > 0 || (isAdminOrPM && canViewTab("forms"))) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                أدوات الملخص
              </h3>
              {isAdminOrPM && canViewTab("forms") && (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setWidgetConfigOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" />
                  تخصيص
                </Button>
              )}
            </div>
            {widgets.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {widgets.map((w) => (
                  <Card key={w.id} className="border-2 border-dashed border-primary/20">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-2">{w.fieldLabel || w.label || "بدون عنوان"}</p>
                      {w.value != null ? (
                        <div className="space-y-1">
                          {String(w.value).split("\n").map((line, i) => (
                            <p key={i} className="text-sm font-semibold leading-relaxed">{line}</p>
                          ))}
                          {w.reportDate && (
                            <p className="text-[10px] text-muted-foreground mt-2" dir="ltr">
                              {w.reportDate}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">لا توجد بيانات</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : isAdminOrPM && canViewTab("forms") ? (
              <Card className="border-2 border-dashed border-muted-foreground/20">
                <CardContent className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">اضغط "تخصيص" لإعداد أدوات الملخص</p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}

        {/* Widget Config Dialog */}
        <Dialog open={widgetConfigOpen} onOpenChange={setWidgetConfigOpen}>
          <DialogContent className="sm:max-w-[600px]" dir="rtl">
            <DialogHeader>
              <DialogTitle>تخصيص أدوات الملخص</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-2">
              {editWidgets.map((w, idx) => {
                const selectedTemplate = formTemplates.find(t => t.id === w.templateId);
                const templateFields = (selectedTemplate?.fields as any[])?.filter((f: any) => f.type !== "section") || [];
                return (
                  <div key={w.id} className="space-y-3 p-4 border rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">أداة {idx + 1}</Badge>
                    </div>
                    <div>
                      <Label>النموذج</Label>
                      <Select
                        value={w.templateId ? String(w.templateId) : ""}
                        onValueChange={val => {
                          const copy = [...editWidgets];
                          copy[idx] = { ...copy[idx], templateId: val ? parseInt(val) : null, fieldId: null };
                          setEditWidgets(copy);
                        }}
                      >
                        <SelectTrigger className="mt-1"><SelectValue placeholder="اختر النموذج" /></SelectTrigger>
                        <SelectContent>
                          {formTemplates.map(t => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {w.templateId && (
                      <div>
                        <Label>الحقل</Label>
                        <Select
                          value={w.fieldId || ""}
                          onValueChange={val => {
                            const copy = [...editWidgets];
                            copy[idx] = { ...copy[idx], fieldId: val || null };
                            setEditWidgets(copy);
                          }}
                        >
                          <SelectTrigger className="mt-1"><SelectValue placeholder="اختر الحقل" /></SelectTrigger>
                          <SelectContent>
                            {templateFields.map((f: any) => (
                              <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setWidgetConfigOpen(false)}>إلغاء</Button>
                <Button onClick={handleSaveWidgets}>حفظ</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Contract Details */}
        <Card className="surface-card surface-card-hover">
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
                ...(project.startDate ? [{
                  icon: Calendar, label: "تاريخ البداية",
                  value: fmtDate(project.startDate),
                  ltr: true,
                }] : []),
                ...(!(project.noSchedule) && project.expectedEndDate ? [{
                  icon: Calendar, label: totalExtDays > 0 ? `النهاية المتوقعة (تشمل ${totalExtDays} يوم تمديد)` : "النهاية المتوقعة",
                  value: fmtDate(project.expectedEndDate),
                  ltr: true,
                  highlight: totalExtDays > 0,
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

        {/* Project Site Location (read-only map with geofence circle) */}
        {project.siteLatitude != null && project.siteLongitude != null && (
          <Collapsible open={isSiteSectionOpen} onOpenChange={setIsSiteSectionOpen}>
            <Card className="surface-card overflow-hidden">
              <CardHeader className="p-0">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-right transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
                    aria-label="فتح أو إغلاق موقع المشروع والنطاق المسموح"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">موقع المشروع والنطاق المسموح</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">عرض موقع المشروع وحدود الحضور الجغرافي</span>
                      </span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isSiteSectionOpen ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="border-t border-border/70 p-3 sm:p-4">
                  <Suspense fallback={<div className="flex h-64 items-center justify-center text-xs text-muted-foreground">جاري تحميل الخريطة...</div>}>
                    <SiteGeofenceMap
                      lat={project.siteLatitude}
                      lng={project.siteLongitude}
                      radius={project.siteRadiusMeters ?? 200}
                      className="h-64"
                    />
                  </Suspense>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

        {!isContractor && (
          <Collapsible open={isTeamSectionOpen} onOpenChange={setIsTeamSectionOpen}>
            <div className="space-y-3">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="surface-card flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-right transition-colors hover:border-primary/30 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
                  aria-label="فتح أو إغلاق فريق العمل"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Users className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">فريق العمل</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">عرض أعضاء المشروع وإدارة صلاحياتهم</span>
                    </span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isTeamSectionOpen ? "rotate-180" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ProjectMembers projectId={project.id} />
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

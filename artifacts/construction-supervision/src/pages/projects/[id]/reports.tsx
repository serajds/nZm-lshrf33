import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsMobile } from "@/hooks/use-mobile";
import { NewReportProgressField, useReportPeriodProgress } from "@/components/report-period-progress";
import { reportTypeLabel, suggestedReportPeriodEnd } from "@/lib/report-types";
import { 
  useListReports, 
  useCreateReport, 
  useUpdateReport, 
  useUpdateReportStatus,
  useDeleteReport,
  useGetProject,
  useGetReportAuditLog,
  getGetReportAuditLogQueryKey,
  getReport,
  getListReportsQueryKey,
  getGetReportQueryKey,
  useUpdateProject,
  getGetProjectQueryKey,
  fetchWithSession,
  customFetch,
  processFetchResponse,
} from "@workspace/api-client-react";
import type { ReportAuditLogEntry } from "@workspace/api-client-react";
import { useTabAccess, useMyProjectPermissions } from "@/hooks/use-tab-access";
import type { Report, Activity, CreateReportBody, UpdateReportBody, ReportActivitiesSnapshotItem, UpdateReportBodyActivitiesSnapshotItem } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Edit2, Trash2, ArrowRight, FileText, CheckCircle2, AlertTriangle, AlertCircle, Star, ImagePlus, X, Loader2, Calculator, Eye, Printer, FolderPlus, ChevronDown, RotateCcw, History, UserCircle2, Settings2, GripVertical, MoreHorizontal, MessageCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { Progress } from "@/components/ui/progress";
import { previewReport, type ActivityForReport, type CompanyLogo } from "@/lib/report-pdf";
import { loadReportPreview, openReportPreviewWindow, updateReportPreviewStatus, showReportPreviewError } from "@/lib/report-preview-loader";
import { getAuthToken } from "@/lib/auth-session";
import {
  ProtectedImage,
  openProtectedAsset,
  protectedAssetToPreviewUrl,
} from "@/components/protected-image";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

const imageGroupSchema = z.object({
  id: z.string().optional(),
  category: z.string().min(1),
  urls: z.array(z.string()).default([]),
});

const reportSchema = z.object({
  type: z.enum(["weekly", "monthly", "period"]),
  reportDate: z.string().min(1, "تاريخ التقرير مطلوب"),
  periodStart: z.string().min(1, "بداية الفترة مطلوبة"),
  periodEnd: z.string().min(1, "نهاية الفترة مطلوبة"),
  workDescription: z.string().optional().default(""),
  progressPercentage: z.preprocess(
    value => value === "" || value === null || value === undefined ? undefined : Number(value),
    z.number().min(0).max(100).optional(),
  ),
  technicalNotes: z.string().optional().nullable(),
  recommendations: z.string().optional().nullable(),
  imageGroups: z.array(imageGroupSchema).default([]),
});

type ReportFormValues = z.infer<typeof reportSchema>;
type ImageGroup = z.infer<typeof imageGroupSchema> & {
  shareStatus?: "pending" | "uploading" | "completed";
  shareExpiresAt?: string;
  shareId?: number;
};

const LEGACY_DEFAULT_CATEGORY = "صور عامة";
const newImageGroupId = () => crypto.randomUUID();
const PRESET_CATEGORIES: string[] = [
  "الأعمال الإنشائية",
  "الأعمال الكهربائية",
  "الأعمال الميكانيكية",
  "أعمال التكييف المركزي",
  "أعمال أنظمة إطفاء الحرائق",
  "الأعمال الصحية",
  "أعمال السباكة",
  "أعمال الواجهات",
  "التشطيبات",
  "أعمال العزل",
  "أعمال الأرضيات",
  "أعمال الدهانات",
  "أعمال الألمنيوم والزجاج",
  "أعمال المصاعد",
  "أعمال البنية التحتية",
  "أعمال الموقع العام",
];

function AddImageGroupButton({
  onAdd,
  suggestions = [],
}: {
  onAdd: (cat: string) => void;
  suggestions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const handleCustom = () => {
    const v = customName.trim();
    if (!v) return;
    onAdd(v);
    setOpen(false);
    setCustomName("");
  };
  const handlePick = (cat: string) => {
    onAdd(cat);
    setOpen(false);
    setCustomName("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <FolderPlus className="h-4 w-4" /> إضافة قسم جديد
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end" dir="rtl">
        <div className="space-y-2">
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground px-2">اقتراحات:</div>
              <div className="flex flex-wrap gap-1.5 px-1 max-h-40 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handlePick(s)}
                    className="text-xs px-2.5 py-1 rounded-md border bg-background hover:bg-accent hover:border-primary/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="border-t my-1" />
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground px-2">اسم القسم:</div>
            <div className="flex items-center gap-2 px-1">
              <Input
                placeholder="مثال: الأعمال الكهربائية"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCustom(); } }}
                className="h-8 text-sm"
                autoFocus
              />
              <Button type="button" size="sm" className="shrink-0 h-8" onClick={handleCustom} disabled={!customName.trim()}>
                إضافة
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReportActivityLog({ projectId, reportId }: { projectId: number; reportId: number }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useGetReportAuditLog(projectId, reportId, {
    query: {
      queryKey: getGetReportAuditLogQueryKey(projectId, reportId),
      enabled: open,
      staleTime: 1000 * 30,
    },
  });

  const entries: ReportAuditLogEntry[] = data ?? [];

  const actionLabel = (entry: ReportAuditLogEntry) => {
    if (entry.action === "create") return "إنشاء التقرير";
    if (entry.action === "delete") return "حذف التقرير";
    // update — try to enrich from entityName which may include
    // status-change context like "(اعتماد)" or "(إرجاع لمسودة)".
    const name = entry.entityName ?? "";
    if (/اعتماد/.test(name)) return "اعتماد التقرير";
    if (/إرجاع لمسودة/.test(name)) return "إرجاع التقرير إلى مسودة";
    return "تعديل التقرير";
  };

  const actionStyle = (action: string) => {
    if (action === "create") return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (action === "delete") return "bg-red-100 text-red-800 border-red-300";
    return "bg-blue-100 text-blue-800 border-blue-300";
  };

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ar-SA-u-nu-latn", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="pt-3 border-t print:hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 text-right hover:bg-accent/40 rounded-md px-2 py-2 transition-colors"
            aria-expanded={open}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-muted-foreground" />
              سجل النشاط
              {entries.length > 0 && open && (
                <span className="text-xs text-muted-foreground font-normal">({entries.length})</span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 px-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل السجل...
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive py-2">تعذّر تحميل سجل النشاط.</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                لا توجد عمليات مسجَّلة لهذا التقرير.
              </p>
            ) : (
              <ol className="relative border-r-2 border-muted pr-4 space-y-3 py-1">
                {entries.map((entry) => {
                  const actor = entry.userFullName || entry.userName || "غير معروف";
                  return (
                    <li key={entry.id} className="relative">
                      <span
                        className="absolute -right-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background"
                        aria-hidden
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${actionStyle(entry.action)}`}
                        >
                          {actionLabel(entry)}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">
                          {fmtDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
                        <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{actor}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ReportSettingsDialog({ projectId }: { projectId: number }) {
  const [open, setOpen] = useState(false);
  const { data: project, isLoading } = useGetProject(projectId, { query: { enabled: open } });
  const updateProject = useUpdateProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [signatures, setSignatures] = useState<{ id: string; title: string; role: string; name: string }[]>([]);
  const [reportDisplayMode, setReportDisplayMode] = useState<"type_and_number" | "period_only">("type_and_number");

  useEffect(() => {
    if (open && project) {
      setReportDisplayMode(project.reportDisplayMode ?? "type_and_number");
      if (project.reportSignatures && Array.isArray(project.reportSignatures)) {
        setSignatures(project.reportSignatures as any);
      } else {
        // Fallback defaults
        setSignatures([
          { id: "1", role: "contractor", title: "المقاول المنفذ", name: project.contractor || "" },
          { id: "2", role: "supervisor", title: "الجهة المشرفة", name: project.supervisorEntity || "" },
          { id: "3", role: "owner", title: "الجهة المالكة", name: project.ownerEntity || "" },
        ]);
      }
    }
  }, [open, project]);

  const handleSave = async () => {
    try {
      await updateProject.mutateAsync({
        id: projectId,
        data: { reportSignatures: signatures, reportDisplayMode }
      });
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: "تم حفظ إعدادات التقارير بنجاح" });
      setOpen(false);
    } catch (err) {
      console.error("Save signatures error:", err);
      toast({ variant: "destructive", title: "حدث خطأ أثناء حفظ إعدادات التقارير" });
    }
  };

  const addSignature = () => {
    setSignatures([...signatures, { id: Date.now().toString(), role: "custom", title: "توقيع جديد", name: "" }]);
  };

  const removeSignature = (id: string) => {
    setSignatures(signatures.filter(s => s.id !== id));
  };

  const updateSignature = (id: string, field: string, value: string) => {
    setSignatures(signatures.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const resetToDefault = () => {
    if (!project) return;
    setSignatures([
      { id: "1", role: "contractor", title: "المقاول المنفذ", name: project.contractor || "" },
      { id: "2", role: "supervisor", title: "الجهة المشرفة", name: project.supervisorEntity || "" },
      { id: "3", role: "owner", title: "الجهة المالكة", name: project.ownerEntity || "" },
    ]);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 shrink-0">
          <Settings2 className="h-4 w-4" />
          إعدادات التقارير
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden p-0" dir="rtl">
        <div className="bg-muted/30 p-6 pb-4 border-b border-border/50">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-slate-500/10 rounded-xl">
                <Settings2 className="h-6 w-6 text-slate-600" />
              </div>
              <div>
                <DialogTitle className="text-xl">إعدادات التقارير</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  حدد طريقة عرض التقارير والتوقيعات الخاصة بهذا المشروع.
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-4">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <div className="space-y-2 rounded-lg border p-4">
                <label className="text-sm font-semibold">طريقة تعريف التقرير في العرض والمعاينة</label>
                <Select value={reportDisplayMode} onValueChange={(value) => setReportDisplayMode(value as "type_and_number" | "period_only")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="type_and_number">نوع التقرير ورقمه (الوضع الحالي)</SelectItem>
                    <SelectItem value="period_only">الفترة فقط (من — إلى)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  لا يغيّر هذا الخيار بيانات التقرير أو طريقة إنشائه؛ بل يحدد ما يظهر في القوائم والمعاينة فقط.
                </p>
              </div>
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold">التوقيعات</h3>
              </div>
              <div className="space-y-3">
                {signatures.map((sig, index) => (
                  <div key={sig.id} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center bg-accent/20 p-3 rounded-lg border">
                    <div className="flex-1 space-y-2 w-full">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs mb-1 block">الصفة / الجهة</label>
                          <Input value={sig.title} onChange={(e) => updateSignature(sig.id, "title", e.target.value)} placeholder="مثال: المهندس المشرف" className="h-8 text-sm" />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs mb-1 block">الاسم (اختياري)</label>
                          <Input value={sig.name || ""} onChange={(e) => updateSignature(sig.id, "name", e.target.value)} placeholder="الاسم" className="h-8 text-sm" />
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0 text-destructive mt-4 sm:mt-0" onClick={() => removeSignature(sig.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              
              {signatures.length === 0 && (
                <div className="text-center p-4 border border-dashed rounded-lg text-sm text-muted-foreground">
                  لا توجد توقيعات محددة. التقرير سيتم تصديره بدون مساحات توقيع.
                </div>
              )}
              
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={addSignature} className="gap-2">
                  <Plus className="h-4 w-4" /> إضافة موقع
                </Button>
                <Button variant="ghost" size="sm" onClick={resetToDefault} className="gap-2 text-muted-foreground hover:text-foreground">
                  <RotateCcw className="h-4 w-4" /> استعادة الافتراضي
                </Button>
              </div>
            </>
          )}
        </div>
        
        <div className="p-4 border-t bg-muted/20 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={isLoading || updateProject.isPending}>
            {updateProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ التغييرات"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectReports() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("التقارير");
  const tripoliToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const editOpenerRef = useRef<HTMLElement | null>(null);
  const [newReportManual, setNewReportManual] = useState(false);
  const [editingIncompleteDraft, setEditingIncompleteDraft] = useState(false);
  const [editingProgressManual, setEditingProgressManual] = useState(false);
  const [manualProgressEntered, setManualProgressEntered] = useState(false);
  const savedReportDatesRef = useRef<{ reportDate: string; periodStart: string; periodEnd: string } | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  type GroupUploadState = { loaded: number; total: number; doneCount: number; totalCount: number };
  const [uploadProgress, setUploadProgress] = useState<Record<number, GroupUploadState>>({});
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
  const [openGroupIdx, setOpenGroupIdx] = useState<number | null>(0);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const groupShareLinks = useRef(new Map<string, { url: string; expiresAt: number }>());
  const isAnyUploading = Object.keys(uploadProgress).length > 0;

  // Editable copy of the report's activities snapshot. Populated when
  // opening an existing report's edit dialog (see `handleEdit`). Edits
  // here only touch the report's snapshot — never the master activities
  // table. See task #45.
  const [snapshotRows, setSnapshotRows] = useState<(ReportActivitiesSnapshotItem & { actualManuallyApproved?: boolean; actualHistoricalUnverified?: boolean })[]>([]);
  const [referenceRows, setReferenceRows] = useState<(ReportActivitiesSnapshotItem & { actualHistoricalUnverified?: boolean })[]>([]);
  const [snapshotUpdateOpen, setSnapshotUpdateOpen] = useState(false);
  const originalSnapshotRows = useRef<ReportActivitiesSnapshotItem[]>([]);
  const aiDraftSnapshotFingerprint = useRef<string | null>(null);
  const aiApprovedContext = useRef<string | null>(null);
  const aiAnalyzedRows = useRef<string | null>(null);
  const analysisKey = () => JSON.stringify(snapshotRows.map(row => [row.id, row.actualProgress, row.status, row.actualManuallyApproved]));
  const approvalKey = (values: ReportFormValues) => JSON.stringify([
    values.reportDate, values.periodStart, values.periodEnd, Number(values.progressPercentage),
  ]);
  useEffect(() => { aiApprovedContext.current = null; aiAnalyzedRows.current = null; }, [isDialogOpen, editingId]);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  // When true, the user wants to type a manual overall %. Otherwise the
  // overall % is auto-recomputed from the snapshot rows using the
  // weighted-average formula.

  const { data: project, isLoading: isProjectLoading } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: myPermissions } = useMyProjectPermissions(projectId);
  const { canEdit: canEditReports, isHidden } = useTabAccess(projectId, "reports", { redirectIfHidden: true });
  const isViewer = !canEditReports;
  const canApprove = myPermissions?.projectRole === "admin" || myPermissions?.projectRole === "project_manager";

  const { refetch: refetchCompanyLogos } = useQuery<Record<string, CompanyLogo>>({
    queryKey: ["project-company-logos", projectId],
    queryFn: async () => {
      const response = await fetchWithSession(
        `${API_BASE}/projects/${projectId}/company-logos`,
      );
      if (!response.ok) throw new Error("فشل تحميل شعارات الشركات");
      return response.json() as Promise<Record<string, CompanyLogo>>;
    },
    enabled: !!projectId,
  });
  
  // `placeholderData` keeps the previous list rendered while a new
  // filter request is in flight, so changing the type / date filters
  // doesn't blank the screen for a round-trip. `staleTime` of 2 minutes
  // matches the global default but is set explicitly here for clarity
  // alongside the placeholder behaviour.
  const {
    data: reports,
    isLoading,
    isError: reportsLoadFailed,
    refetch: retryLoadReports,
  } = useListReports(projectId, {
    type: project?.reportDisplayMode === "period_only" || !typeFilter || typeFilter === "all" ? undefined : typeFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }, { query: { enabled: !!projectId, placeholderData: (prev: any) => prev } as any });

  const { data: allReportsForCategories } = useListReports(
    projectId,
    {},
    { query: { enabled: !!projectId, staleTime: 1000 * 60 * 5 } as any },
  );

  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const updateReportStatus = useUpdateReportStatus();
  const deleteReport = useDeleteReport();

  const handleApprove = (reportId: number, nextStatus: "draft" | "approved") => {
    updateReportStatus.mutate(
      { projectId, id: reportId, data: { status: nextStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId, { type: typeFilter && typeFilter !== "all" ? typeFilter : undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }) });
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
          queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(projectId, reportId) });
          queryClient.invalidateQueries({ queryKey: getGetReportAuditLogQueryKey(projectId, reportId) });
          toast({ title: nextStatus === "approved" ? "تم اعتماد التقرير" : "أُعيد التقرير إلى المسودة" });
        },
        onError: () => toast({ title: "تعذّر تغيير الحالة", variant: "destructive" }),
      }
    );
  };

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      type: "weekly",
      reportDate: new Date().toISOString().split('T')[0],
      periodStart: "",
      periodEnd: "",
      workDescription: "",
      progressPercentage: undefined,
      technicalNotes: "",
      recommendations: "",
      imageGroups: [],
    }
  });

  const watchedType = form.watch("type");
  const watchedPeriodStart = form.watch("periodStart");
  const watchedPeriodEnd = form.watch("periodEnd");
  const watchedReportDate = form.watch("reportDate");
  const watchedTargetDate = watchedPeriodEnd || watchedReportDate;
  const hasFutureReportDate = watchedReportDate > tripoliToday;
  const hasFuturePeriodEnd = watchedPeriodEnd > tripoliToday;
  const needsFutureDraft = hasFutureReportDate || hasFuturePeriodEnd;
  const futureDraftNotice = hasFuturePeriodEnd && hasFutureReportDate
    ? "تاريخ التقرير ونهاية الفترة ما زالا مستقبليين. تُقرأ النسبة حتى نهاية الفترة، ولا تظهر قبل أن يصبح التاريخان حاضرين أو سابقين."
    : hasFuturePeriodEnd
      ? "نهاية الفترة ما زالت مستقبلية. تغيير تاريخ التقرير وحده لا يكفي؛ تُقرأ النسبة حتى نهاية الفترة، فحدّث نهايتها إلى تاريخ حاضر أو سابق."
      : "تاريخ التقرير ما زال مستقبلياً. غيّره إلى تاريخ حاضر أو سابق أولاً؛ النسبة تُقرأ حتى نهاية الفترة.";
  const periodProgress = useReportPeriodProgress(
    projectId,
    watchedPeriodEnd,
    isDialogOpen && !needsFutureDraft,
    watchedPeriodStart,
  );
  useEffect(() => {
    if (editingId) return;
    setNewReportManual(false);
    setManualProgressEntered(false);
  }, [watchedPeriodEnd, editingId, isDialogOpen]);
  useEffect(() => {
    if (!needsFutureDraft && !editingId && !newReportManual && periodProgress.data?.available) {
      form.setValue("progressPercentage", periodProgress.data.overallProgress!);
    }
  }, [editingId, newReportManual, needsFutureDraft, periodProgress.data, form]);
  useEffect(() => {
    if (!editingId || !editingIncompleteDraft || editingProgressManual || needsFutureDraft
      || form.getValues("progressPercentage") !== undefined
      || !periodProgress.data?.available) return;
    form.setValue("progressPercentage", periodProgress.data.overallProgress!);
  }, [editingId, editingIncompleteDraft, editingProgressManual, needsFutureDraft, periodProgress.data, form]);
  const watchedImageGroups = form.watch("imageGroups");

  const projectCategoryHistory = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of allReportsForCategories ?? []) {
      const groups = (r.imageGroups as ImageGroup[] | null | undefined) ?? null;
      if (!groups) continue;
      for (const g of groups) {
        const cat = (g?.category ?? "").trim();
        if (!cat) continue;
        const key = cat.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        ordered.push(cat);
      }
    }
    return ordered;
  }, [allReportsForCategories]);

  const categorySuggestions = useMemo(() => {
    const usedKeys = new Set(
      (watchedImageGroups ?? [])
        .map(g => (g.category ?? "").trim().toLowerCase())
        .filter(Boolean)
    );
    const seen = new Set<string>();
    const out: string[] = [];
    for (const cat of [...PRESET_CATEGORIES, ...projectCategoryHistory]) {
      const key = cat.trim().toLowerCase();
      if (!key || key === LEGACY_DEFAULT_CATEGORY.toLowerCase() || seen.has(key) || usedKeys.has(key)) continue;
      seen.add(key);
      out.push(cat);
    }
    return out;
  }, [projectCategoryHistory, watchedImageGroups]);

  useEffect(() => {
    if (editingId || !watchedPeriodStart) return;
    const endDate = suggestedReportPeriodEnd(watchedType, watchedPeriodStart);
    if (endDate !== null) form.setValue("periodEnd", endDate);
  }, [watchedType, watchedPeriodStart, editingId]);

  const handleEdit = async (r: Report, opener?: HTMLElement) => {
    editOpenerRef.current = opener ?? null;
    setSelectedReportId(null);
    setEditingId(r.id);
    const listDates = {
      reportDate: String(r.reportDate).slice(0, 10),
      periodStart: String(r.periodStart).slice(0, 10),
      periodEnd: String(r.periodEnd).slice(0, 10),
    };
    const incomplete = r.status === "draft"
      && (r.progressPercentage == null || !r.workDescription?.trim());
    setEditingIncompleteDraft(incomplete);
    setEditingProgressManual(false);
    setManualProgressEntered(false);
    savedReportDatesRef.current = listDates;
    setSnapshotUpdateOpen(false);
    aiDraftSnapshotFingerprint.current = null;
    const existingGroups = (r.imageGroups as ImageGroup[] | null | undefined) ?? null;
    const preservedGroups = existingGroups?.filter(g =>
      g.category.trim() !== LEGACY_DEFAULT_CATEGORY || (g.urls?.length ?? 0) > 0
    );
    const initialGroups: ImageGroup[] = preservedGroups && preservedGroups.length > 0
      ? preservedGroups.map(g => ({ id: g.id || newImageGroupId(), category: g.category, urls: g.urls ?? [] }))
      : (r.imageUrls?.length ?? 0) > 0
        ? [{ id: newImageGroupId(), category: "مرفقات سابقة", urls: r.imageUrls ?? [] }]
        : [];
    form.reset({
      type: r.type as ReportFormValues["type"],
      reportDate: new Date(r.reportDate).toISOString().split('T')[0],
      periodStart: new Date(r.periodStart).toISOString().split('T')[0],
      periodEnd: new Date(r.periodEnd).toISOString().split('T')[0],
      workDescription: r.workDescription,
      progressPercentage: r.progressPercentage ?? undefined,
      technicalNotes: r.technicalNotes ?? "",
      recommendations: r.recommendations ?? "",
      imageGroups: initialGroups,
    });
    setOpenGroupIdx(0);
    setSnapshotRows([]);
    setReferenceRows([]);
    originalSnapshotRows.current = [];
    setIsDialogOpen(true);

    // The list endpoint strips `activitiesSnapshot` to keep payloads small,
    // so fetch the full report (cached) to populate the editable timeline.
    setIsLoadingSnapshot(true);
    try {
      const full = await queryClient.fetchQuery({
        queryKey: getGetReportQueryKey(projectId, r.id),
        queryFn: ({ signal }) => getReport(projectId, r.id, { signal }),
        staleTime: 0,
      }) as Report;
      const savedDates = {
        reportDate: String(full.reportDate).slice(0, 10),
        periodStart: String(full.periodStart).slice(0, 10),
        periodEnd: String(full.periodEnd).slice(0, 10),
      };
      savedReportDatesRef.current = savedDates;
      const currentDates = form.getValues();
      if (currentDates.reportDate === listDates.reportDate
        && currentDates.periodStart === listDates.periodStart
        && currentDates.periodEnd === listDates.periodEnd) {
        form.setValue("reportDate", savedDates.reportDate, { shouldDirty: false });
        form.setValue("periodStart", savedDates.periodStart, { shouldDirty: false });
        form.setValue("periodEnd", savedDates.periodEnd, { shouldDirty: false });
      }
      setEditingIncompleteDraft(full.status === "draft"
        && (full.progressPercentage == null || !full.workDescription?.trim()));
      const existingManualProgress = full.progressSource === "manual"
        || (full.progressPercentage != null && full.progressSource == null);
      setEditingProgressManual(existingManualProgress);
      setManualProgressEntered(existingManualProgress && full.progressPercentage != null);
      const snap = (full.activitiesSnapshot ?? (full as Report & { referenceActivities?: ReportActivitiesSnapshotItem[] }).referenceActivities ?? []) as ReportActivitiesSnapshotItem[];
      setReferenceRows((full as Report & { referenceActivities?: typeof referenceRows }).referenceActivities ?? []);
      const sorted = [...snap].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      setSnapshotRows(sorted);
      originalSnapshotRows.current = sorted;
    } catch {
      toast({ title: "تعذّر تحميل بنود التقرير", variant: "destructive" });
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  const handleDuplicate = async (report: Report, opener?: HTMLElement) => {
    if (copyingId !== null) return;
    setCopyingId(report.id);
    try {
      const copy = await customFetch<Report>(
        `/api/projects/${projectId}/reports/${report.id}/duplicate`,
        { method: "POST" },
      );
      queryClient.setQueryData(getGetReportQueryKey(projectId, copy.id), copy);
      await queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      setSelectedReportId(null);
      toast({
        title: project?.reportDisplayMode === "period_only"
          ? `تم إنشاء نسخة مستقلة للفترة ${fmtDate(copy.periodStart)} — ${fmtDate(copy.periodEnd)}`
          : `تم إنشاء نسخة مستقلة برقم ${copy.reportNumber}`,
        description: "حُفظت كمسودة. يمكنك تعديل بياناتها وتواريخها الآن.",
      });
      await handleEdit(copy, opener);
    } catch {
      toast({ title: "تعذّر نسخ التقرير", description: "يرجى التحقق من الاتصال والصلاحيات والمحاولة مجدداً.", variant: "destructive" });
    } finally {
      setCopyingId(null);
    }
  };

  const snapshotWeightedProgress = useMemo(() => {
    if (snapshotRows.length === 0) return null;
    if (snapshotRows.some(row => (row as { referenceOnly?: boolean }).referenceOnly)) return null;
    let totalWeight = 0;
    let weighted = 0;
    for (const row of snapshotRows) {
      const w = typeof row.weight === "number" && row.weight > 0 ? row.weight : 1;
      totalWeight += w;
      weighted += (row.actualProgress ?? 0) * w;
    }
    if (totalWeight === 0) return null;
    return Math.round((weighted / totalWeight) * 10) / 10;
  }, [snapshotRows]);

  const updateSnapshotRow = (id: number, patch: Partial<ReportActivitiesSnapshotItem>) => {
    setSnapshotRows(prev => prev.map(r => (r.id === id ? {
      ...r, ...patch,
      ...(patch.actualProgress !== undefined || (patch.status !== undefined && !r.actualHistoricalUnverified) ? {
        actualManuallyApproved: true, actualHistoricalUnverified: false,
      } : {}),
    } : r)));
  };

  const STATUS_LABELS: Record<string, string> = {
    not_started: "لم يبدأ",
    in_progress: "جارٍ",
    completed: "منجز",
    delayed: "متأخر",
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteReport.mutateAsync({ projectId, id: deletingId });
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      queryClient.removeQueries({ queryKey: getGetReportQueryKey(projectId, deletingId) });
      toast({ title: "تم حذف التقرير" });
    } catch {
      toast({ variant: "destructive", title: "فشل الحذف" });
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreview = async (report: Report) => {
    if (!project) return;
    const previewWindow = openReportPreviewWindow();
    if (!previewWindow) {
      toast({ title: "يرجى السماح بالنوافذ المنبثقة لفتح معاينة التقرير", variant: "destructive" });
      return;
    }
    setPreviewLoadingId(report.id);
    try {
      const { report: fullReport, companyLogos: previewLogos, imageUrls, imageGroups } = await loadReportPreview({
        loadReport: () => queryClient.fetchQuery({
          queryKey: getGetReportQueryKey(projectId, report.id),
          queryFn: ({ signal }) => getReport(projectId, report.id, { signal }),
          staleTime: 0,
        }),
        loadLogos: async () => {
          const result = await refetchCompanyLogos();
          if (result.error || !result.data) throw result.error ?? new Error("Missing company logos");
          return result.data;
        },
        loadSignedAssets: import.meta.env.DEV ? async () => {
          const response = await fetchWithSession(
            `/api/projects/${projectId}/reports/${report.id}/preview-image-links`,
          );
          if (!response.ok) throw new Error(`تعذّر تجهيز روابط صور التقرير (${response.status})`);
          const payload = await response.json() as { assets?: Record<string, string> };
          if (!payload.assets || typeof payload.assets !== "object") {
            throw new Error("استجابة روابط صور التقرير غير صالحة");
          }
          return payload.assets;
        } : undefined,
        loadAsset: url => protectedAssetToPreviewUrl(url, previewWindow),
        loadLogoAsset: url => protectedAssetToPreviewUrl(url, previewWindow, "logo"),
        onProgress: (done, total) => updateReportPreviewStatus(
          previewWindow, "جارٍ تحميل صور التقرير والشعارات", done, total,
        ),
      });
    // A historical report without a saved snapshot cannot be reconstructed
    // from today's activities; show that limitation instead of implying that
    // current activity values describe the report date.
    const snapshotActivities = fullReport.activitiesSnapshot
      ?? (fullReport as Report & { referenceActivities?: ReportActivitiesSnapshotItem[] }).referenceActivities ?? null;
    const hasSnapshot = Array.isArray(snapshotActivities);
    const hasSavedSnapshot = Array.isArray(fullReport.activitiesSnapshot);
    const sourceActivities: ReportActivitiesSnapshotItem[] = hasSnapshot ? snapshotActivities : [];
    const activityList: ActivityForReport[] = sourceActivities.map((a) => ({
      name: a.name ?? "",
      plannedProgress: a.plannedProgress ?? 0,
      actualProgress: a.actualProgress ?? 0,
      actualValueMissing: typeof a.actualProgress !== "number" || !Number.isFinite(a.actualProgress)
        || ((a as { referenceOnly?: boolean }).referenceOnly === true
          && (a as { actualHistoricalUnverified?: boolean }).actualHistoricalUnverified === true),
      plannedValueMissing: typeof a.plannedProgress !== "number" || !Number.isFinite(a.plannedProgress)
        || (!hasSavedSnapshot && (a as { plannedHistoricalUnverified?: boolean }).plannedHistoricalUnverified === true),
      status: (a.status as ActivityForReport["status"]) ?? "not_started",
      plannedStartDate: a.plannedStartDate,
      plannedEndDate: a.plannedEndDate,
      actualHistoricalUnverified: (a as ReportActivitiesSnapshotItem & { actualHistoricalUnverified?: boolean }).actualHistoricalUnverified,
      plannedAsOfDate: (a as ReportActivitiesSnapshotItem & { plannedAsOfDate?: string }).plannedAsOfDate,
      plannedHistoricalUnverified: (a as ReportActivitiesSnapshotItem & { plannedHistoricalUnverified?: boolean }).plannedHistoricalUnverified,
    }));
    const weightedSnapshotProgress = (field: "plannedProgress" | "actualProgress") => {
      if (!hasSnapshot) return null;
      if (!Array.isArray(fullReport.activitiesSnapshot)) return null;
      if (!sourceActivities.length || sourceActivities.some(row =>
        typeof row[field] !== "number" || !Number.isFinite(row[field])
        || (row as { referenceOnly?: boolean }).referenceOnly === true)) return null;
      let totalWeight = 0;
      let weighted = 0;
      for (const row of sourceActivities) {
        const weight = typeof row.weight === "number" && row.weight > 0 ? row.weight : 1;
        totalWeight += weight;
        weighted += (row[field] ?? 0) * weight;
      }
      return totalWeight > 0 ? weighted / totalWeight : 0;
    };
    const hasUnverifiedPlan = sourceActivities.some(row =>
      (row as ReportActivitiesSnapshotItem & { plannedHistoricalUnverified?: boolean }).plannedHistoricalUnverified === true
    );
    const snapshotPlanned = weightedSnapshotProgress("plannedProgress");
    const snapshotActual = weightedSnapshotProgress("actualProgress");
    const createdAt = fullReport.createdAt ? new Date(fullReport.createdAt) : null;
    const createdUtcDay = createdAt && Number.isFinite(createdAt.getTime())
      ? createdAt.toISOString().slice(0, 10)
      : null;
    const periodSource = (fullReport as Report & { progressSource?: string }).progressSource;
    const actualHistoricalUnverified = hasSnapshot && (periodSource
      ? periodSource === "manual" || sourceActivities.some(row =>
          (row as ReportActivitiesSnapshotItem & { actualAsOfDate?: string; actualHistoricalUnverified?: boolean }).actualHistoricalUnverified === true
          || (row as ReportActivitiesSnapshotItem & { actualAsOfDate?: string }).actualAsOfDate !== fullReport.periodEnd)
      : (
      !createdUtcDay
      || fullReport.reportDate < createdUtcDay
      || sourceActivities.some(row => {
        if (typeof row.actualProgress !== "number" || !Number.isFinite(row.actualProgress)) return true;
        const recordedAt = (row as ReportActivitiesSnapshotItem & { actualRecordedAt?: string }).actualRecordedAt;
        if (!recordedAt) return false;
        const recordedDate = new Date(recordedAt);
        return !Number.isFinite(recordedDate.getTime())
          || fullReport.reportDate < recordedDate.toISOString().slice(0, 10);
      })
    ));
    const apiBase = API_BASE.replace("/api", "");
    previewReport({
      projectName: project.name,
      ownerEntity: project.ownerEntity,
      contractor: project.contractor,
      supervisorEntity: project.supervisorEntity,
      location: project.location,
      reportType: fullReport.type,
      reportDate: fullReport.reportDate,
      periodStart: fullReport.periodStart,
      periodEnd: fullReport.periodEnd,
      progressPercentage: fullReport.progressPercentage,
      workDescription: fullReport.workDescription,
      technicalNotes: fullReport.technicalNotes,
      recommendations: fullReport.recommendations,
      imageUrls,
      imageGroups,
      reportId: fullReport.id,
      reportNumber: fullReport.reportNumber,
      activities: activityList,
      snapshotAvailable: hasSnapshot,
      contractValue: (project as any).contractValue ?? null,
      startDate: (project as any).startDate ?? null,
      expectedEndDate: (project as any).expectedEndDate ?? null,
      noSchedule: project.noSchedule === true,
      plannedProgress: snapshotPlanned,
      actualProgress: snapshotActual,
      approvedProgress: periodSource === "manual",
      actualHistoricalUnverified,
      plannedHistoricalUnverified: hasUnverifiedPlan,
      spi: (!actualHistoricalUnverified || periodSource === "manual") && !hasUnverifiedPlan && snapshotPlanned != null && snapshotPlanned > 0 && snapshotActual != null
        ? (periodSource === "manual" ? fullReport.progressPercentage! : snapshotActual) / snapshotPlanned
        : null,
      companyLogos: previewLogos,
      apiBase,
      reportSignatures: (project as any).reportSignatures ?? null,
      reportDisplayMode: project.reportDisplayMode,
      actualProgressUnavailable: fullReport.progressPercentage == null,
    }, previewWindow);
    } catch {
      showReportPreviewError(previewWindow);
      toast({
        title: "تعذّر تجهيز معاينة التقرير",
        description: "لم تُصدر معاينة ناقصة. تحقق من الاتصال وأعد المحاولة.",
        variant: "destructive",
      });
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleImageUpload = async (files: File[], groupIndex: number) => {
    const fileList = files.filter(file => file.type.startsWith("image/"));
    if (fileList.length !== files.length) {
      toast({ variant: "destructive", title: "يمكن إضافة ملفات الصور فقط" });
    }
    if (fileList.length === 0) return;
    setOpenGroupIdx(groupIndex);
    const token = getAuthToken();
    const totalBytes = fileList.reduce((s, f) => s + f.size, 0);

    // Track per-file loaded bytes so the aggregated progress for this
    // group reflects every file in the batch. Uploads from different
    // groups run independently — a slow upload in one tab never blocks
    // adding photos to another tab.
    const perFileLoaded = new Array(fileList.length).fill(0);
    setUploadProgress(prev => ({
      ...prev,
      [groupIndex]: {
        loaded: (prev[groupIndex]?.loaded ?? 0),
        total: (prev[groupIndex]?.total ?? 0) + totalBytes,
        doneCount: (prev[groupIndex]?.doneCount ?? 0),
        totalCount: (prev[groupIndex]?.totalCount ?? 0) + fileList.length,
      },
    }));

    const uploadOne = (file: File, idx: number): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("description", "صورة تقرير");
        const xhr = new XMLHttpRequest();
        // Dedicated report-uploads endpoint that's gated by the "reports"
        // tab permission. Engineers who can edit reports but don't have
        // edit access to the "files" tab were getting a 403 from the old
        // /files endpoint.
        xhr.open("POST", `/api/projects/${projectId}/reports/uploads`);
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const delta = ev.loaded - perFileLoaded[idx];
          perFileLoaded[idx] = ev.loaded;
          setUploadProgress(prev => {
            const cur = prev[groupIndex];
            if (!cur) return prev;
            return { ...prev, [groupIndex]: { ...cur, loaded: cur.loaded + delta } };
          });
        };
        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status <= 599) {
            const responseHeaders = new Headers();
            const renewed = xhr.getResponseHeader("X-Renewed-Token");
            if (renewed) responseHeaders.set("X-Renewed-Token", renewed);
            await processFetchResponse(
              new Response(xhr.responseText, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: responseHeaders,
              }),
              token,
            );
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText) as { fileUrl?: string };
              resolve(data.fileUrl ?? null);
            } catch {
              resolve(null);
            }
          } else {
            toast({ variant: "destructive", title: `فشل رفع ${file.name}` });
            resolve(null);
          }
        };
        xhr.onerror = () => {
          toast({ variant: "destructive", title: `خطأ في رفع ${file.name}` });
          resolve(null);
        };
        xhr.send(formData);
      }).then((url) => {
        // Push each finished URL into the form immediately so the user
        // sees thumbnails appear as files complete instead of waiting
        // for the whole batch.
        if (url) {
          const groups = [...(form.getValues("imageGroups") ?? [])];
          if (groups[groupIndex]) {
            groups[groupIndex] = {
              ...groups[groupIndex],
              urls: [...(groups[groupIndex].urls ?? []), url],
            };
            form.setValue("imageGroups", groups, { shouldDirty: true });
          }
        }
        setUploadProgress(prev => {
          const cur = prev[groupIndex];
          if (!cur) return prev;
          return { ...prev, [groupIndex]: { ...cur, doneCount: cur.doneCount + 1 } };
        });
        return url;
      });

    await Promise.all(fileList.map((f, i) => uploadOne(f, i)));

    // Clear this group's progress once everything for this batch finished.
    // If another batch was queued in the meantime its own state entry
    // will already exist with the additional totals; we only clear when
    // the counters caught up with the totals.
    setUploadProgress(prev => {
      const cur = prev[groupIndex];
      if (!cur) return prev;
      if (cur.doneCount >= cur.totalCount) {
        const { [groupIndex]: _drop, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  };

  const onSubmit = async (values: ReportFormValues) => {
    try {
      const futureDraft = values.reportDate > tripoliToday || values.periodEnd > tripoliToday;
      if (!futureDraft && (values.progressPercentage === undefined
        || !Number.isFinite(values.progressPercentage)
        || values.progressPercentage < 0 || values.progressPercentage > 100)) {
        toast({ variant: "destructive", title: "أدخل نسبة الإنجاز قبل حفظ التقرير" });
        return;
      }
      if (aiApprovedContext.current && aiApprovedContext.current !== approvalKey(values)) {
        toast({ variant: "destructive", title: "تغيرت النسبة أو الفترة بعد الصياغة؛ أعد الصياغة قبل الحفظ" });
        return;
      }
      if (editingId && aiAnalyzedRows.current && aiAnalyzedRows.current !== analysisKey()) {
        toast({ variant: "destructive", title: "تغيرت بنود التقرير بعد تحليلها؛ أعد الصياغة قبل الحفظ" });
        return;
      }
      const cleanedGroups = (values.imageGroups ?? [])
        .map(g => ({ id: g.id || newImageGroupId(), category: g.category.trim(), urls: g.urls ?? [] }))
        .filter(g => g.category.length > 0);
      const flatImageUrls = Array.from(new Set(cleanedGroups.flatMap(g => g.urls)));
      const { imageGroups: _omit, ...rest } = values;
      const groupsForApi = cleanedGroups.length > 0 ? cleanedGroups : null;
      if (editingId) {
        // Only send snapshot rows that actually have an id (defensive — the
        // generated type marks `id` as required, and rows without one
        // wouldn't match anything server-side anyway).
        const snapshotPayload: UpdateReportBodyActivitiesSnapshotItem[] = (futureDraft ? [] : snapshotRows)
          .filter((r): r is typeof r & { id: number } => typeof r.id === "number")
          .filter(r => r.actualManuallyApproved || originalSnapshotRows.current.some(o =>
            o.id === r.id && (o.actualProgress !== r.actualProgress || o.status !== r.status)))
          .map(r => ({
            id: r.id,
            actualProgress: r.actualProgress ?? 0,
            status: r.status ?? "not_started",
            actualManuallyApproved: r.actualManuallyApproved === true,
          }));
        const updateBody: UpdateReportBody = {
          ...rest,
          ...(futureDraft ? { progressPercentage: null } : {}),
          imageUrls: flatImageUrls,
          imageGroups: groupsForApi,
        };
        if (editingIncompleteDraft && !futureDraft && values.progressPercentage !== undefined) {
          const progressSource = editingProgressManual
            ? "manual"
            : periodProgress.data?.available ? "history" : undefined;
          if (progressSource) {
            (updateBody as UpdateReportBody & { progressSource?: "manual" | "history"; historyFingerprint?: string })
              .progressSource = progressSource;
            if (progressSource === "history" && periodProgress.data?.fingerprint) {
              (updateBody as UpdateReportBody & { historyFingerprint?: string }).historyFingerprint =
                periodProgress.data.fingerprint;
            }
          }
        } else if (futureDraft) {
          (updateBody as UpdateReportBody & { progressSource?: "manual" | "history" }).progressSource = undefined;
        }
        if (snapshotPayload.length > 0) {
          updateBody.activitiesSnapshot = snapshotPayload;
        }
        await updateReport.mutateAsync({ projectId, id: editingId, data: updateBody });
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(projectId, editingId) });
        queryClient.invalidateQueries({ queryKey: getGetReportAuditLogQueryKey(projectId, editingId) });
        toast({ title: "تم التحديث" });
      } else {
        if (!futureDraft) {
          if (newReportManual ? !manualProgressEntered : !periodProgress.data?.available || periodProgress.isFetching) {
            toast({ variant: "destructive", title: newReportManual
              ? "أدخل النسبة الموثّقة لهذه الفترة قبل الحفظ"
              : "لا تتوفر نسبة تاريخية جاهزة؛ انتظر تحميل السجل أو اختر الإدخال اليدوي الموثّق" });
            return;
          }
        }
        const createBody: CreateReportBody & {
          progressSource?: "manual" | "history";
          historyFingerprint?: string;
        } = {
          ...rest,
          workDescription: values.workDescription.trim(),
          imageUrls: flatImageUrls,
          imageGroups: groupsForApi,
          ...(futureDraft ? {} : {
            progressSource: newReportManual ? "manual" : "history",
            ...(!newReportManual && periodProgress.data?.fingerprint ? { historyFingerprint: periodProgress.data.fingerprint } : {}),
          }),
        };
        if (aiDraftSnapshotFingerprint.current) {
          (createBody as CreateReportBody & { aiDraftSnapshotFingerprint?: string }).aiDraftSnapshotFingerprint =
            aiDraftSnapshotFingerprint.current;
        }
        await createReport.mutateAsync({ projectId, data: createBody });
        toast({ title: "تمت الإضافة" });
      }
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
      setEditingIncompleteDraft(false);
      setEditingProgressManual(false);
      setManualProgressEntered(false);
      savedReportDatesRef.current = null;
    } catch (error) {
      if (!editingId) void periodProgress.refetch();
      const errorMessage = error instanceof Error ? error.message : "";
      const isHtmlError = /<!doctype html|<html[\s>]/i.test(errorMessage);
      toast({
        variant: "destructive",
        title: "فشل الحفظ",
        description: isHtmlError
          ? "تعذر الحفظ بسبب خطأ في الخادم. لم يتم حفظ التقرير؛ أعد المحاولة بعد تحديث النظام."
          : errorMessage || undefined,
      });
    }
  };

  const refreshReportLists = (reportId: number) => {
    queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(projectId, reportId) });
  };

  const groupShareCacheKey = (reportId: number, groupIndex: number) => `${reportId}:${groupIndex}`;

  const createGroupShareLink = async (reportId: number, groupIndex: number) => {
    const response = await fetchWithSession(
      `/api/projects/${projectId}/reports/${reportId}/image-groups/${groupIndex}/share`,
      { method: "POST" },
    );
    const result = await response.json().catch(() => ({})) as {
      publicToken?: string;
      expiresAt?: string;
      error?: string;
    };
    if (!response.ok || !result.publicToken || !result.expiresAt) {
      throw new Error(result.error || "تعذّر إنشاء رابط القسم");
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const link = `${window.location.origin}${base}/report-image-upload?token=${encodeURIComponent(result.publicToken)}`;
    groupShareLinks.current.set(groupShareCacheKey(reportId, groupIndex), {
      url: link,
      expiresAt: new Date(result.expiresAt).getTime(),
    });
    refreshReportLists(reportId);
    return link;
  };

  const getOrCreateGroupShareLink = async (
    reportId: number,
    groupIndex: number,
    shareStatus?: ImageGroup["shareStatus"],
  ) => {
    const key = groupShareCacheKey(reportId, groupIndex);
    const cached = groupShareLinks.current.get(key);
    if (cached && cached.expiresAt > Date.now() && shareStatus !== "completed") return cached.url;
    return createGroupShareLink(reportId, groupIndex);
  };

  const createGroupShare = async (reportId: number, groupIndex: number, shareStatus?: ImageGroup["shareStatus"]) => {
    try {
      const link = await getOrCreateGroupShareLink(reportId, groupIndex, shareStatus);
      try {
        await navigator.clipboard.writeText(link);
        toast({ title: "تم إنشاء الرابط ونسخه", description: "الرابط صالح لمدة 7 أيام، ويمكن إلغاؤه من التقرير." });
      } catch {
        window.prompt("انسخ رابط رفع الصور للقسم", link);
      }
    } catch (error) {
      toast({
        title: "تعذّر إنشاء رابط القسم",
        description: error instanceof Error ? error.message : "تحقق من الاتصال ثم حاول مرة أخرى.",
        variant: "destructive",
      });
    }
  };

  const shareGroupViaWhatsApp = async (
    report: Report,
    groupIndex: number,
    group: ImageGroup,
  ) => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const link = await getOrCreateGroupShareLink(report.id, groupIndex, group.shareStatus);
      const message = [
        "السلام عليكم،",
        `يرجى رفع صور قسم «${group.category}» في التقرير.`,
        `فترة التقرير من ${fmtDate(report.periodStart)} إلى ${fmtDate(report.periodEnd)}.`,
        "",
        "طريقة الرفع:",
        "1. افتح الرابط أدناه.",
        "2. اسحب الصور وأفلتها أو اخترها من جهازك.",
        "3. بعد رفع جميع الصور اضغط «إنهاء الرفع» لتأكيد اكتمال القسم.",
        "",
        `رابط رفع الصور: ${link}`,
      ].join("\n");
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
      if (popup) {
        popup.location.href = whatsappUrl;
        toast({ title: "جهزت رسالة المشاركة عبر واتساب" });
      } else {
        try {
          await navigator.clipboard.writeText(message);
          toast({
            title: "تعذّر فتح واتساب تلقائياً",
            description: "نسخت رسالة المشاركة كاملة؛ افتح واتساب والصقها.",
          });
        } catch {
          window.prompt("انسخ رسالة المشاركة إلى واتساب", message);
        }
      }
    } catch (error) {
      popup?.close();
      toast({
        title: "تعذّر تجهيز مشاركة واتساب",
        description: error instanceof Error ? error.message : "تحقق من الاتصال ثم حاول مرة أخرى.",
        variant: "destructive",
      });
    }
  };

  const cancelGroupShare = async (reportId: number, groupIndex: number) => {
    try {
      const response = await fetchWithSession(
        `/api/projects/${projectId}/reports/${reportId}/image-groups/${groupIndex}/share`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || "تعذّر إلغاء الرابط");
      }
      groupShareLinks.current.delete(groupShareCacheKey(reportId, groupIndex));
      toast({ title: "تم إلغاء رابط القسم" });
      refreshReportLists(reportId);
    } catch (error) {
      toast({
        title: "تعذّر إلغاء الرابط",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const getReportShareState = (report: Report) => {
    const groups = (report.imageGroups as ImageGroup[] | null | undefined) ?? [];
    const statuses = groups.map(group => group.shareStatus).filter(Boolean);
    if (statuses.includes("pending")) return "pending";
    if (statuses.includes("uploading")) return "uploading";
    if (statuses.includes("completed")) return "completed";
    return null;
  };

  const getReportPendingGroupNames = (report: Report) => {
    const groups = (report.imageGroups as ImageGroup[] | null | undefined) ?? [];
    return groups.filter(group => group.shareStatus === "pending" || group.shareStatus === "uploading")
      .map(group => group.category);
  };

  const shareStateLabel = (status: string) => status === "pending"
    ? "بانتظار الرفع" : status === "uploading" ? "جارٍ الرفع" : "مكتمل";

  const addImageGroup = (category: string) => {
    const cat = category.trim();
    if (!cat) return;
    const current = form.getValues("imageGroups") ?? [];
    if (current.some(g => g.category === cat)) {
      toast({ variant: "destructive", title: "هذا القسم موجود مسبقاً" });
      return;
    }
    form.setValue("imageGroups", [...current, { id: newImageGroupId(), category: cat, urls: [] }], { shouldDirty: true });
  };

  const removeImageGroup = (groupIndex: number) => {
    const current = form.getValues("imageGroups") ?? [];
    const updated = current.filter((_, i) => i !== groupIndex);
    form.setValue("imageGroups", updated, { shouldDirty: true });
  };

  const removeImageFromGroup = (groupIndex: number, imageIndex: number) => {
    const current = [...(form.getValues("imageGroups") ?? [])];
    if (!current[groupIndex]) return;
    current[groupIndex] = {
      ...current[groupIndex],
      urls: current[groupIndex].urls.filter((_, i) => i !== imageIndex),
    };
    form.setValue("imageGroups", current, { shouldDirty: true });
  };

  const handleAiDraft = async () => {
    try {
      const values = form.getValues();
      if (values.reportDate > tripoliToday || values.periodEnd > tripoliToday) {
        toast({
          variant: "destructive",
          title: "لا تتوفر بيانات إنجاز لفترة مستقبلية",
          description: "عدّل تاريخ التقرير ونهاية الفترة إلى تاريخ حاضر أو سابق أولاً.",
        });
        return;
      }
      const savedDates = savedReportDatesRef.current;
      if (editingId && savedDates && (
        values.reportDate !== savedDates.reportDate
        || values.periodStart !== savedDates.periodStart
        || values.periodEnd !== savedDates.periodEnd
      )) {
        toast({
          variant: "destructive",
          title: "احفظ تواريخ التقرير والفترة أولاً",
          description: "بعد حفظ التواريخ افتح التقرير مجدداً ثم أعد الصياغة لتطابق لقطة البنود الفترة المحدّثة.",
        });
        return;
      }
      if (!values.periodStart || !values.periodEnd) {
        toast({ variant: "destructive", title: "حدد فترة التقرير أولاً", description: "يرجى تحديد تاريخ بداية ونهاية الفترة قبل الصياغة بالذكاء الاصطناعي" });
        return;
      }
      if (editingId && isLoadingSnapshot) {
        toast({ variant: "destructive", title: "انتظر تحميل بنود التقرير قبل الصياغة" });
        return;
      }
      if (typeof values.progressPercentage !== "number"
        || !Number.isFinite(values.progressPercentage)
        || values.progressPercentage < 0 || values.progressPercentage > 100
        || (!editingId && (newReportManual ? !manualProgressEntered : !periodProgress.data?.available || periodProgress.isFetching))
        || (editingIncompleteDraft && (editingProgressManual
          ? !manualProgressEntered
          : !periodProgress.data?.available || periodProgress.isFetching))) {
        toast({ variant: "destructive", title: "اعتمد نسبة الإنجاز حتى نهاية الفترة أولاً", description: "يمكنك إدخال نسبة التقرير يدوياً إذا لم يكفِ السجل." });
        return;
      }
      const originalById = new Map(originalSnapshotRows.current.map(row => [row.id, row]));
      const snapshotOverrides = snapshotRows.flatMap(row => {
        const original = originalById.get(row.id);
        if (!original || typeof row.id !== "number") return [];
        const changed: { id: number; actualProgress?: number; status?: string; actualManuallyApproved?: boolean } = { id: row.id };
        if (row.actualManuallyApproved) {
          changed.actualProgress = row.actualProgress ?? 0;
          changed.status = row.status;
          changed.actualManuallyApproved = true;
        }
        if (row.actualProgress !== original.actualProgress) changed.actualProgress = row.actualProgress ?? 0;
        if (row.status !== original.status) changed.status = row.status ?? "not_started";
        return Object.keys(changed).length > 1 ? [changed] : [];
      });
      setIsAiDrafting(true);
      const data = await customFetch<{
        workDescription?: string;
        technicalNotes?: string;
        recommendations?: string;
        snapshotFingerprint?: string;
      }>(`${API_BASE}/projects/${projectId}/reports/ai-draft`, {
        method: "POST",
        body: JSON.stringify({
          approvedReportInputs: true,
          progressPercentage: values.progressPercentage,
          workDescription: values.workDescription,
          imageGroups: values.imageGroups,
          technicalNotes: values.technicalNotes,
          recommendations: values.recommendations,
          periodStart: values.periodStart,
          periodEnd: values.periodEnd,
          reportDate: values.reportDate,
          ...(editingId ? {
            reportId: editingId,
            snapshotOverrides,
          } : {}),
        }),
        responseType: "json",
      });
      if (JSON.stringify(form.getValues()) !== JSON.stringify(values)) {
        throw new Error("تغيرت مدخلات التقرير أثناء الصياغة؛ أعد المحاولة بالبيانات الحالية");
      }
      aiApprovedContext.current = approvalKey(values);
      aiAnalyzedRows.current = editingId ? analysisKey() : null;
      if (!editingId) aiDraftSnapshotFingerprint.current = data.snapshotFingerprint ?? null;
      
      if (data.workDescription) form.setValue("workDescription", data.workDescription, { shouldDirty: true });
      if (data.technicalNotes) form.setValue("technicalNotes", data.technicalNotes, { shouldDirty: true });
      if (data.recommendations) form.setValue("recommendations", data.recommendations, { shouldDirty: true });
      
      toast({ title: "تمت صياغة التقرير بنجاح بواسطة الذكاء الاصطناعي" });
    } catch (err) {
      console.error("AI Draft error:", err);
      toast({
        variant: "destructive",
        title: "فشل الذكاء الاصطناعي في صياغة التقرير",
        description: err instanceof Error ? err.message : "تعذر الاتصال بخدمة الذكاء الاصطناعي",
      });
    } finally {
      setIsAiDrafting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="page-hero flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="relative z-10 mt-0.5 shrink-0 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="relative z-10 text-lg font-bold leading-tight text-white md:text-2xl">{project?.name}</h1>
          <p className="relative z-10 mt-1 text-sm text-white/65">التقارير</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      <div className="surface-card space-y-3 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          {project?.reportDisplayMode !== "period_only" && (
            <div className="w-full sm:w-40">
              <Select value={typeFilter ?? "all"} onValueChange={(v) => setTypeFilter(v)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="نوع التقرير" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="weekly">أسبوعي</SelectItem>
                  <SelectItem value="monthly">شهري</SelectItem>
                  <SelectItem value="period">بالفترة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">من</span>
            <Input type="date" className="h-11 min-w-0 flex-1 rounded-xl text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">إلى</span>
            <Input type="date" className="h-11 min-w-0 flex-1 rounded-xl text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح</Button>
            )}
          </div>
        </div>
        
        {canEditReports && (
        <div className="flex items-center gap-2">
          {canApprove && <ReportSettingsDialog projectId={projectId} />}
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            setOpenGroupIdx(0);
            if (!open) {
              form.reset();
              setEditingId(null);
              setEditingIncompleteDraft(false);
              setEditingProgressManual(false);
              savedReportDatesRef.current = null;
              setManualProgressEntered(false);
              setSnapshotRows([]);
              aiDraftSnapshotFingerprint.current = null;
            }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => {
              if (!editingId) {
                setNewReportManual(false);
                setEditingIncompleteDraft(false);
                setEditingProgressManual(false);
                savedReportDatesRef.current = null;
                setManualProgressEntered(false);

                const allReports = reports ?? [];
                let latestDate: Date | null = null;
                for (const r of allReports) {
                  const s = new Date(r.periodStart);
                  const e = new Date(r.periodEnd);
                  const maxDate = s > e ? s : e;
                  if (!latestDate || maxDate > latestDate) latestDate = maxDate;
                }
                if (latestDate) {
                  const nextStart = new Date(latestDate);
                  nextStart.setDate(nextStart.getDate() + 1);
                  const startStr = nextStart.toISOString().split("T")[0];
                  form.setValue("periodStart", startStr);

                  const currentType = form.getValues("type");
                  const endDate = suggestedReportPeriodEnd(currentType, startStr);
                  if (endDate !== null) form.setValue("periodEnd", endDate);
                }
              }
            }}>
              <Plus className="h-4 w-4" /> إضافة تقرير
            </Button>
          </DialogTrigger>
          <DialogContent
            className="sm:max-w-[750px] max-h-[90vh] overflow-hidden p-0"
            dir="rtl"
            onCloseAutoFocus={(event) => {
              const opener = editOpenerRef.current;
              editOpenerRef.current = null;
              if (opener?.isConnected) {
                event.preventDefault();
                opener.focus({ preventScroll: true });
              }
            }}
          >
            <div className="bg-gradient-to-br from-indigo-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 rounded-xl">
                    <FileText className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">{editingId ? "تعديل التقرير" : "إضافة تقرير جديد"}</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {needsFutureDraft
                        ? futureDraftNotice
                        : editingId ? "تحديث بيانات التقرير ونسب الإنجاز والملاحظات." : "أدخل تفاصيل الإنجاز الفنية والنسب للتقرير الجديد."}
                    </p>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="px-6 py-4 space-y-8">
                  
                  {/* Section 1: Basic Info */}
                  <div className="space-y-4">
                    {needsFutureDraft && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
                        {futureDraftNotice} هذه مسودة عادية غير قابلة للاعتماد حالياً، بلا نسبة أو لقطة مستقبلية.
                      </div>
                    )}
                    <h3 className="text-sm font-semibold text-indigo-600/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                      معلومات التقرير
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>نوع التقرير</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent dir="rtl">
                            <SelectItem value="weekly">أسبوعي</SelectItem>
                            <SelectItem value="monthly">شهري</SelectItem>
                            <SelectItem value="period">بالفترة</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reportDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ التقرير</FormLabel>
                        <FormControl><Input type="date" {...field} onChange={event => {
                          field.onChange(event);
                          if (editingIncompleteDraft) {
                            form.setValue("progressPercentage", undefined, { shouldDirty: true });
                            setEditingProgressManual(false);
                            setManualProgressEntered(false);
                          }
                        }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="periodStart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>بداية الفترة</FormLabel>
                        <FormControl><Input type="date" {...field} onChange={event => {
                          field.onChange(event);
                          if (editingIncompleteDraft) {
                            form.setValue("progressPercentage", undefined, { shouldDirty: true });
                            setEditingProgressManual(false);
                            setManualProgressEntered(false);
                          }
                        }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="periodEnd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>نهاية الفترة</FormLabel>
                        <FormControl><Input type="date" {...field} onChange={event => {
                          field.onChange(event);
                          if (editingIncompleteDraft) {
                            form.setValue("progressPercentage", undefined, { shouldDirty: true });
                            setEditingProgressManual(false);
                            setManualProgressEntered(false);
                          }
                        }} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="progressPercentage"
                    render={({ field }) => {
                      if (needsFutureDraft) return (
                        <FormItem className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                          <FormLabel>نسبة الإنجاز</FormLabel>
                          <p>{futureDraftNotice} بعد تحديث التواريخ، اختر نسبة السجل أو أدخل النسبة الموثقة يدوياً.</p>
                        </FormItem>
                      );
                      if (!editingId) return (
                        <NewReportProgressField
                          periodStart={watchedPeriodStart}
                          periodEnd={watchedPeriodEnd}
                          data={periodProgress.data}
                          loading={periodProgress.isFetching}
                          failed={periodProgress.isError}
                          manual={newReportManual}
                          value={field.value}
                          onChange={value => { field.onChange(value); setManualProgressEntered(value.trim() !== ""); }}
                          onManualChange={() => { setNewReportManual(v => !v); setManualProgressEntered(false); }}
                        />
                      );
                      if (editingIncompleteDraft) return (
                        <NewReportProgressField
                          periodStart={watchedPeriodStart}
                          periodEnd={watchedPeriodEnd}
                          data={periodProgress.data}
                          loading={periodProgress.isFetching}
                          failed={periodProgress.isError}
                          manual={editingProgressManual}
                          value={field.value}
                          onChange={value => {
                            field.onChange(value === "" ? undefined : Number(value));
                            setManualProgressEntered(value.trim() !== "");
                          }}
                          onManualChange={() => setEditingProgressManual(value => !value)}
                        />
                      );
                      // When editing an existing report with a loaded
                      // snapshot, the overall % is derived from the table
                      const hasSnapshot = !!editingId && snapshotRows.length > 0;
                      const isDerivedReadOnly = false;
                      return (
                        <FormItem className="sm:col-span-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                            <FormLabel className="mb-0">
                              نسبة الإنجاز حتى نهاية الفترة (%)
                            </FormLabel>
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                {...field}
                                value={field.value ?? ""}
                                onChange={event => {
                                  const raw = event.target.value;
                                  field.onChange(raw === "" ? undefined : Number(raw));
                                }}
                                disabled={isDerivedReadOnly}
                                className="pl-8"
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">%</span>
                            </div>
                          </FormControl>
                          {hasSnapshot ? (
                            <p className="text-xs text-muted-foreground mt-1">
                              {isDerivedReadOnly
                                ? `محتسب تلقائياً من المتوسط الموزون لبنود التقرير (${snapshotRows.length} بند)`
                                : "نسبة التقرير مستقلة؛ تعديل البنود لا يغيّرها تلقائياً"}
                            </p>
                          ) : null}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                    </div>
                  </div>

                  <div className="h-px bg-border/50 w-full" />

                  {/* Section 2: Text Fields */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-indigo-600/80 uppercase tracking-wide flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                        التفاصيل والملاحظات
                      </h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 dark:border-indigo-900/30 dark:bg-indigo-950/20 dark:text-indigo-400"
                        onClick={handleAiDraft}
                        disabled={isAiDrafting || needsFutureDraft}
                      >
                        {isAiDrafting ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            جاري الصياغة...
                          </>
                        ) : (
                          <>
                            <Star className="h-3.5 w-3.5 fill-current" />
                            {editingId ? "إعادة الصياغة بناءً على تعديلات البنود" : "صياغة بالذكاء الاصطناعي"}
                          </>
                        )}
                      </Button>
                    </div>
                    
                    <div className="p-4 sm:p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm space-y-5">
                      <FormField
                        control={form.control}
                        name="workDescription"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base text-foreground/90 flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              وصف الأعمال المنجزة خلال الفترة (اختياري عند الحفظ)
                            </FormLabel>
                            <FormControl><Textarea className="min-h-28 text-base bg-background shadow-inner" placeholder="أضف ما نُفّذ خلال الفترة، أو اطلب تحليل البنود التاريخية وصياغة التقرير..." {...field} value={field.value ?? ""} /></FormControl>
                            <p className="text-xs text-muted-foreground">
                              {needsFutureDraft
                                ? "يمكن ترك وصف الأعمال فارغاً الآن وإكماله لاحقاً؛ لن تتاح صياغة الذكاء الاصطناعي قبل تثبيت بيانات الفترة."
                                : "يمكن حفظ التقرير كمسودة دون وصف، لكن يجب استكماله قبل الاعتماد. الصياغة تحلل البنود والمخطط الموثّقين حتى نهاية الفترة."}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="technicalNotes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base text-foreground/90 flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-amber-500" />
                              الملاحظات الفنية والعوائق (اختياري)
                            </FormLabel>
                            <FormControl><Textarea className="min-h-24 bg-background" placeholder="أي ملاحظات، صعوبات، أو تأخيرات..." {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="recommendations"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base text-foreground/90 flex items-center gap-2">
                              <Star className="h-4 w-4 text-indigo-500" />
                              التوصيات والمقترحات (اختياري)
                            </FormLabel>
                            <FormControl><Textarea className="min-h-24 bg-background" placeholder="ما هي خطوات العمل القادمة المقترحة؟" {...field} value={field.value ?? ''} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                {/* Editable activities snapshot (edit mode only). */}
                {!!editingId && (
                  <>
                    <div className="h-px bg-border/50 w-full" />
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-indigo-600/80 uppercase tracking-wide flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                        نسب إنجاز البنود
                      </h3>
                      <Collapsible open={snapshotUpdateOpen} onOpenChange={setSnapshotUpdateOpen}>
                        <div className="border rounded-2xl overflow-hidden shadow-sm">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              aria-expanded={snapshotUpdateOpen}
                              aria-controls="report-snapshot-update-content"
                              className="w-full bg-muted/30 px-4 py-3 flex items-center justify-between flex-wrap gap-2 border-b border-border/50 text-right hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                            >
                              <div className="flex items-center gap-2">
                                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${snapshotUpdateOpen ? "rotate-180" : ""}`} />
                                <h3 className="text-sm font-semibold">تحديث حالة البنود</h3>
                                {snapshotRows.length > 0 && (
                                  <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border shadow-sm">({snapshotRows.length} بند)</span>
                                )}
                              </div>
                              {snapshotWeightedProgress != null && (
                                <Badge variant="outline" className="font-mono bg-background shadow-sm border-primary/20 text-primary">
                                  متوسط الإنجاز الكلي: {snapshotWeightedProgress}%
                                </Badge>
                              )}
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent id="report-snapshot-update-content">
                        <p className="px-4 py-3 text-xs text-muted-foreground">
                          "التعديلات تخص هذا التقرير حتى نهاية فترته ولا تغيّر المشروع. أدخل نسبة البند لاعتمادها ثم أعد الصياغة. معلومات المصدر والمخطط غير الموثق للمراجعة الداخلية فقط؛ لا تظهر في التقرير الصادر، وتُستبعد المقارنات التي لا تتوفر بياناتها."
                        </p>
                        {isLoadingSnapshot ? (
                          <div className="p-8"><LoadingSpinner text="جاري تحميل البنود..." /></div>
                        ) : snapshotRows.length === 0 ? (
                          <div className="p-4 overflow-x-auto">
                            <p className="text-sm text-muted-foreground mb-3">بنود مرجعية مع الإنجاز الموثق حتى نهاية الفترة. الجدول المعروض مرجعي، ولا يغيّر نسبة التقرير المعتمدة.</p>
                            <table className="w-full text-sm">
                              <thead><tr><th>البند</th><th>البداية المخططة</th><th>النهاية المخططة</th><th>الإنجاز المسجل</th></tr></thead>
                              <tbody>{referenceRows.map(row => <tr key={row.id} className="border-b">
                                <td className="p-2">{row.name}</td><td>{row.plannedStartDate ?? "—"}</td><td>{row.plannedEndDate ?? "—"}</td>
                                <td>{row.actualHistoricalUnverified ? "غير موثق للفترة" : `${row.actualProgress}%`}</td>
                              </tr>)}</tbody>
                            </table>
                            {!referenceRows.length && <p className="text-sm">لا توجد بنود متاحة للعرض.</p>}
                          </div>
                        ) : (
                          <div className="overflow-x-auto bg-card">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/10 text-xs text-muted-foreground/80 font-medium">
                                <tr>
                                  <th className="text-right px-4 py-3 font-semibold">البند</th>
                                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">الوزن</th>
                                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">المخطط %</th>
                                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap w-32">الفعلي %</th>
                                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap w-36">الحالة</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {snapshotRows.map(row => {
                                  const rowId = row.id;
                                  if (typeof rowId !== "number") return null;
                                  const referenceRow = row as ReportActivitiesSnapshotItem & { referenceOnly?: boolean; actualHistoricalUnverified?: boolean };
                                  return (
                                    <tr key={rowId} className="hover:bg-muted/10 transition-colors">
                                      <td className="px-4 py-3 align-middle">
                                        <span className="font-medium text-foreground/90">{row.name ?? "—"}</span>
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground/70">
                                        {referenceRow.referenceOnly ? "—" : typeof row.weight === "number" ? row.weight : 1}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground/70">
                                        {typeof row.plannedProgress === "number" ? `${Math.round(row.plannedProgress * 10) / 10}%` : "غير متاح"}
                                        {referenceRow.referenceOnly && <span> (مرجعي)</span>}
                                      </td>
                                      <td className="px-4 py-3">
                                        <Input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={0.1}
                                          placeholder="أدخل نسبة الفترة"
                                          value={row.actualHistoricalUnverified && !row.actualManuallyApproved ? "" : row.actualProgress ?? 0}
                                          onChange={e => {
                                            const v = e.target.value === "" ? 0 : Number(e.target.value);
                                            const clamped = Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));
                                            updateSnapshotRow(rowId, { actualProgress: clamped });
                                          }}
                                          className="h-9 text-center font-mono text-sm bg-background border-input/60 shadow-inner"
                                        />
                                      </td>
                                      <td className="px-4 py-3">
                                          <Select
                                            value={row.status ?? "not_started"}
                                            onValueChange={(v) => updateSnapshotRow(rowId, { status: v })}
                                          >
                                            <SelectTrigger dir="rtl" className="h-9 text-xs bg-background">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent dir="rtl">
                                              {Object.entries(STATUS_LABELS).map(([v, label]) => (
                                                <SelectItem key={v} value={v}>{label}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    </div>
                  </>
                )}


                {/* Image Groups Section */}
                <div className="h-px bg-border/50 w-full" />

                {/* Section 4: Attachments */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-indigo-600/80 uppercase tracking-wide flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                    مرفقات التقرير
                  </h3>
                  
                  <FormField
                    control={form.control}
                    name="imageGroups"
                    render={({ field }) => {
                      const groups = field.value ?? [];
                      const totalImages = groups.reduce((s, g) => s + (g.urls?.length ?? 0), 0);
                      return (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2 text-base text-foreground/90">
                            <ImagePlus className="h-4 w-4 text-emerald-500" /> صور الموقع التوثيقية (اختياري)
                            {totalImages > 0 && (
                              <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">— {totalImages} صورة في {groups.filter(g => g.urls.length > 0).length} قسم</span>
                            )}
                          </FormLabel>
                          <div className="space-y-3 mt-3">
                            {groups.map((group, gIdx) => {
                              const groupProgress = uploadProgress[gIdx];
                              const isThisUploading = !!groupProgress;
                              const progressPct = groupProgress && groupProgress.total > 0
                                ? Math.min(100, Math.round((groupProgress.loaded / groupProgress.total) * 100))
                                : 0;
                              const isOpen = openGroupIdx === gIdx;
                              const isEmpty = group.urls.length === 0;
                              const canDelete = isEmpty && !isThisUploading;
                              return (
                                <Collapsible
                                  key={gIdx}
                                  open={isOpen}
                                  onOpenChange={(o) => setOpenGroupIdx(o ? gIdx : null)}
                                  className="border rounded-2xl bg-muted/10 overflow-hidden shadow-sm"
                                >
                                  <div className="flex items-center justify-between gap-2 flex-wrap p-4 hover:bg-muted/20 transition-colors">
                                    <CollapsibleTrigger asChild>
                                      <button type="button" className="flex items-center gap-2 flex-1 min-w-0 text-right">
                                        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                        <span className="text-sm font-semibold text-foreground truncate">{group.category}</span>
                                        <Badge variant="outline" className="text-xs text-muted-foreground shrink-0 bg-background">{group.urls.length} صورة</Badge>
                                      </button>
                                    </CollapsibleTrigger>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <label className="cursor-pointer">
                                        <input
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          className="hidden"
                                          onChange={(e) => {
                                            const files = Array.from(e.currentTarget.files ?? []);
                                            e.currentTarget.value = "";
                                            void handleImageUpload(files, gIdx);
                                          }}
                                        />
                                        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:border-primary/30 font-medium transition-all shadow-sm">
                                          {isThisUploading ? (
                                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> إضافة المزيد</>
                                          ) : (
                                            <><ImagePlus className="h-3.5 w-3.5" /> إضافة صور للقسم</>
                                          )}
                                        </span>
                                      </label>
                                      {canDelete && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                                          title="حذف هذا القسم الفارغ"
                                          onClick={() => removeImageGroup(gIdx)}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                      {!isEmpty && groups.length > 1 && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 rounded-lg text-muted-foreground/40 cursor-not-allowed"
                                          title="احذف الصور أولاً ثم يمكنك حذف القسم"
                                          disabled
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {isThisUploading && (
                                    <div className="px-4 pb-4 -mt-1">
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                                        <span className="flex items-center gap-1.5 font-medium">
                                          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                                          جاري رفع {groupProgress.doneCount} / {groupProgress.totalCount}
                                        </span>
                                        <span className="font-mono text-primary font-semibold">{progressPct}%</span>
                                      </div>
                                      <Progress value={progressPct} className="h-2 bg-primary/10" />
                                    </div>
                                  )}
                                  <CollapsibleContent>
                                    <div
                                      className={`px-4 pb-4 rounded-xl transition-colors ${dragOverGroupIdx === gIdx ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = "copy";
                                        setDragOverGroupIdx(gIdx);
                                      }}
                                      onDragLeave={(e) => {
                                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                          setDragOverGroupIdx(null);
                                        }
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDragOverGroupIdx(null);
                                        void handleImageUpload(Array.from(e.dataTransfer.files), gIdx);
                                      }}
                                    >
                                      {isEmpty ? (
                                        <div className="text-center p-6 border-2 border-dashed rounded-xl bg-background/50 text-muted-foreground/60 flex flex-col items-center gap-2">
                                          <ImagePlus className="h-8 w-8 opacity-50" />
                                          <p className="text-xs font-medium">اسحب وأفلت الصور هنا أو انقر على "إضافة صور للقسم"</p>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap gap-3">
                                          {group.urls.map((url, idx) => (
                                            <div key={idx} className="relative group w-24 h-24 rounded-xl overflow-hidden border-2 border-transparent hover:border-primary/50 shadow-sm transition-all">
                                              <ProtectedImage
                                                src={url}
                                                alt={`صورة ${idx + 1}`}
                                                loading="lazy"
                                                decoding="async"
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                              />
                                              <button
                                                type="button"
                                                onClick={() => removeImageFromGroup(gIdx, idx)}
                                                className="absolute top-1 right-1 bg-background/80 backdrop-blur-sm text-destructive hover:bg-destructive hover:text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md"
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              );
                            })}

                            <div className="pt-2">
                              <AddImageGroupButton
                                suggestions={categorySuggestions}
                                onAdd={(cat) => {
                                  addImageGroup(cat);
                                  setOpenGroupIdx((form.getValues("imageGroups") ?? []).length - 1);
                                }}
                              />
                            </div>
                          </div>
                        </FormItem>
                      );
                    }}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                  <Button
                    type="submit"
                    className="w-full sm:w-auto shadow-md"
                    disabled={createReport.isPending || updateReport.isPending || isAnyUploading}
                    title={isAnyUploading ? "يرجى الانتظار حتى اكتمال رفع الصور" : undefined}
                  >
                    {isAnyUploading ? <><Loader2 className="h-4 w-4 ml-2 animate-spin" /> جاري الرفع...</>
                      : editingId ? (needsFutureDraft ? "حفظ المسودة" : "حفظ وتحديث التقرير")
                        : needsFutureDraft ? "حفظ كمسودة" : "إنشاء التقرير"}
                  </Button>
                </div>
              </form>
            </Form>
            </div>
          </DialogContent>
        </Dialog>
        </div>
        )}
      </div>

      {(() => {
        const reportsList = reports ?? [];
        const periodOnly = project?.reportDisplayMode === "period_only";
        const selectedReport = reportsList.find((r) => r.id === selectedReportId) ?? null;

        const countImages = (report: Report) => {
          const groups = (report.imageGroups as ImageGroup[] | null | undefined) ?? null;
          if (groups && groups.length > 0) {
            return groups.reduce((s, g) => s + (g.urls?.length ?? 0), 0);
          }
          return report.imageUrls?.length ?? 0;
        };

        const renderActions = (report: Report, size: "row" | "panel" = "row") => {
          const rowMode = size === "row";
          const buttonSize = rowMode ? "h-9 px-2.5 text-xs sm:px-3 sm:text-sm" : "h-10 px-3 text-sm";
          const approvalIssue = report.reportDate > tripoliToday || report.periodEnd > tripoliToday
            ? "لا يمكن اعتماد المسودة قبل حلول تاريخ التقرير ونهاية الفترة"
            : report.periodStart > report.periodEnd
              ? "صحح تاريخ بداية ونهاية الفترة"
              : !report.workDescription?.trim()
                ? "أدخل وصف الأعمال قبل الاعتماد"
                : typeof report.progressPercentage !== "number"
                  ? "أدخل نسبة الإنجاز قبل الاعتماد"
                  : null;
          const actionLayout = rowMode
            ? "grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2"
            : "grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center";
          return (
            <div
              className={actionLayout}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Button
                variant="outline"
                size="sm"
                className={`col-span-2 w-full border-primary bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground sm:col-span-1 sm:w-auto ${buttonSize}`}
                onClick={() => handlePreview(report)}
                disabled={previewLoadingId === report.id}
                title="معاينة وحفظ PDF"
              >
                {previewLoadingId === report.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                معاينة وطباعة
              </Button>
              {canApprove && report.status === "draft" && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-full border-emerald-200 bg-emerald-50 font-semibold text-emerald-800 shadow-none hover:bg-emerald-100 hover:text-emerald-900 sm:w-auto ${buttonSize}`}
                onClick={() => handleApprove(report.id, "approved")}
                disabled={updateReportStatus.isPending || approvalIssue !== null}
                title={approvalIssue ?? "اعتماد التقرير وإظهاره في تقارير المالك"}
                >
                  <CheckCircle2 className="h-4 w-4" /> اعتماد
                </Button>
              )}
              {!isViewer && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`w-full rounded-lg border-border bg-background font-medium shadow-sm hover:bg-muted sm:w-auto ${buttonSize}`}
                      aria-label={periodOnly
                        ? `إجراءات تقرير الفترة من ${fmtDate(report.periodStart)} إلى ${fmtDate(report.periodEnd)}`
                        : `إجراءات التقرير ${report.reportNumber}`}
                      title="إجراءات التقرير"
                      onClick={(event) => { editOpenerRef.current = event.currentTarget; }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                      إجراءات
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" style={{ direction: "rtl" }} className="min-w-48 rounded-xl p-1.5 shadow-lg">
                    <DropdownMenuLabel className="px-2.5 pb-1 text-xs text-muted-foreground">إجراءات التقرير</DropdownMenuLabel>
                    {canApprove && report.status === "approved" && (
                      <DropdownMenuItem
                        className="gap-2 rounded-lg py-2 text-amber-700 focus:text-amber-800"
                        onClick={() => handleApprove(report.id, "draft")}
                        disabled={updateReportStatus.isPending}
                      >
                        <RotateCcw className="h-4 w-4" /> إرجاع إلى المسودة
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="gap-2 rounded-lg py-2"
                        onClick={() => handleEdit(report, editOpenerRef.current ?? undefined)}
                    >
                      <Edit2 className="h-4 w-4" /> تعديل التقرير
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 rounded-lg py-2"
                        onClick={() => handleDuplicate(report, editOpenerRef.current ?? undefined)}
                      disabled={copyingId !== null}
                    >
                      {copyingId === report.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Copy className="h-4 w-4" />}
                      نسخ كمسودة
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1.5" />
                    <DropdownMenuItem
                      className="gap-2 rounded-lg py-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                      onClick={() => setDeletingId(report.id)}
                    >
                      <Trash2 className="h-4 w-4" /> حذف التقرير
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        };

        const renderDetailsBody = (report: Report) => {
          const reportGroups = (report.imageGroups as ImageGroup[] | null | undefined) ?? null;
          const hasGroups = reportGroups && reportGroups.length > 0;
          const hasImages = (report.imageUrls && report.imageUrls.length > 0) || hasGroups;
          const totalImages = hasGroups
            ? reportGroups!.reduce((s, g) => s + (g.urls?.length ?? 0), 0)
            : (report.imageUrls?.length ?? 0);
          const displayGroups: ImageGroup[] = hasGroups
            ? reportGroups!
            : (report.imageUrls?.length ? [{ category: "صور الموقع", urls: report.imageUrls }] : []);
          let runningCounter = 0;
          return (
            <div className="space-y-5">
              {(report as Report & { historicalSnapshotAvailable?: boolean }).historicalSnapshotAvailable === false && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                  تعرض المعاينة بنود الأعمال ونسبها الموثقة في السجل، والجدول المتاح كمرجع؛ تبقى نسبة التقرير المعتمدة كما هي.
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {!periodOnly && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-0.5">النوع</div>
                    <div className="font-medium">{reportTypeLabel(report.type)}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">الحالة</div>
                  <div>
                    {report.status === "draft" ? (
                      <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">مسودة</Badge>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100">معتمد</Badge>
                    )}
                    {getReportShareState(report) && (
                      <Badge variant="outline" className="mt-1 border-amber-300 bg-amber-50 text-amber-900">
                        صور الأقسام: {shareStateLabel(getReportShareState(report)!)}
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">تاريخ التقرير</div>
                  <div className="font-mono">{fmtDate(report.reportDate)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">الإنجاز التراكمي</div>
                  {typeof report.progressPercentage === "number"
                    ? <Badge className="bg-primary text-white">{Math.round(report.progressPercentage * 10) / 10}%</Badge>
                    : <span className="text-xs text-amber-800">أكمل نسبة الإنجاز</span>}
                  {(report as any).progressHistorySource && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      المصدر: {(report as any).progressHistorySource === "estimated" ? "سجل تقديري مراجع" : "سجل فعلي"}
                    </p>
                  )}
                  {typeof report.progressPercentage === "number"
                    && typeof (report as any).progressStartPercentage === "number" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      التغير خلال الفترة: {((report.progressPercentage! - (report as any).progressStartPercentage) >= 0 ? "+" : "")}
                      {(report.progressPercentage - (report as any).progressStartPercentage).toFixed(1)} نقطة مئوية
                    </p>
                  )}
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <div className="text-xs text-muted-foreground mb-0.5">الفترة</div>
                  <div className="font-mono text-sm">
                    {fmtDate(report.periodStart)} — {fmtDate(report.periodEnd)}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t">
                <h4 className="text-sm font-semibold mb-1 text-foreground">وصف الأعمال</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{report.workDescription}</p>
              </div>

              {(report.technicalNotes || report.recommendations) && (
                <div className="grid md:grid-cols-2 gap-4 pt-3 border-t">
                  {report.technicalNotes && (
                    <div>
                      <h4 className="text-sm font-semibold text-destructive flex items-center gap-1 mb-1">
                        <AlertTriangle className="h-4 w-4" /> الملاحظات الفنية
                      </h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.technicalNotes}</p>
                    </div>
                  )}
                  {report.recommendations && (
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-600 flex items-center gap-1 mb-1">
                        <CheckCircle2 className="h-4 w-4" /> التوصيات
                      </h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.recommendations}</p>
                    </div>
                  )}
                </div>
              )}

              {hasImages && (
                <div className="pt-3 border-t space-y-4">
                  {displayGroups.some(group => group.shareStatus === "pending" || group.shareStatus === "uploading") && (
                    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      توجد أقسام صور مشتركة لم يكتمل رفعها بعد:
                      {" "}{displayGroups.filter(group => group.shareStatus === "pending" || group.shareStatus === "uploading")
                        .map(group => `${group.category} (${shareStateLabel(group.shareStatus!)})`).join("، ")}
                    </div>
                  )}
                  {displayGroups.map((group, gi) => (
                    <div key={group.id || gi} className="rounded-lg border p-3">
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                        <ImagePlus className="h-4 w-4 text-muted-foreground" />
                        {group.category}
                        <span className="text-xs text-muted-foreground font-normal">({group.urls.length} صورة)</span>
                        {group.shareStatus && (
                          <Badge variant="outline" className="text-xs border-amber-300 bg-amber-50 text-amber-900">
                            {shareStateLabel(group.shareStatus)}
                          </Badge>
                        )}
                      </h4>
                      {group.urls.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {group.urls.map((url, idx) => {
                            runningCounter += 1;
                            const positionLabel = `${runningCounter}/${totalImages}`;
                            return (
                              <button
                                type="button"
                                key={idx}
                                onClick={() => void openProtectedAsset(url)}
                                className="group relative aspect-video rounded-lg overflow-hidden border-2 border-muted hover:border-primary/40 transition-all shadow-sm hover:shadow-md block"
                              >
                                <ProtectedImage
                                  src={url}
                                  alt={`صورة ${idx + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                                  {positionLabel}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                          لا توجد صور في هذا القسم بعد.
                        </p>
                      )}
                      {canEditReports && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
                          <Button type="button" size="sm" variant="outline" className="gap-2"
                            onClick={() => void createGroupShare(report.id, gi, group.shareStatus)}>
                            <Copy className="h-4 w-4" /> إنشاء رابط ونسخه
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2 border-green-700 text-green-800 hover:bg-green-50 hover:text-green-900"
                            onClick={() => void shareGroupViaWhatsApp(report, gi, group)}
                          >
                            <MessageCircle className="h-4 w-4" /> مشاركة عبر واتساب
                          </Button>
                          {(group.shareStatus === "pending" || group.shareStatus === "uploading") && (
                            <>
                              <span className="text-xs text-muted-foreground">
                                الرابط صالح حتى {group.shareExpiresAt ? fmtDate(group.shareExpiresAt) : "انتهاء الصلاحية"}
                              </span>
                              <Button type="button" size="sm" variant="ghost" className="text-destructive"
                                onClick={() => void cancelGroupShare(report.id, gi)}>
                                إلغاء الرابط
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        };

        return (
          <>
            {isLoading || isProjectLoading || !project ? (
              <LoadingSpinner text="جاري تحميل التقارير..." />
            ) : reportsLoadFailed && !reports ? (
              <Card className="border-amber-300/70">
                <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                  <AlertCircle className="h-8 w-8 text-amber-600" />
                  <div>
                    <h3 className="font-semibold">تعذر تحميل التقارير</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      لم نتمكن من تأكيد عدم وجود تقارير. أعد المحاولة بعد قليل.
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => void retryLoadReports()}>
                    إعادة المحاولة
                  </Button>
                </CardContent>
              </Card>
            ) : reportsList.length === 0 ? (
              <Card className="border-dashed">
                <EmptyState
                  icon={<FileText className="h-7 w-7 text-muted-foreground/60" />}
                  title="لا توجد تقارير"
                  description="لم يتم إضافة أي تقارير لهذا المشروع بعد"
                />
              </Card>
            ) : (
              <>
                {/* Desktop: table view */}
                {!isMobile && <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr className="text-right">
                          {!periodOnly && <th className="px-3 py-2 font-medium">#</th>}
                          {!periodOnly && <th className="px-3 py-2 font-medium">النوع</th>}
                          <th className="px-3 py-2 font-medium">الحالة</th>
                          <th className="px-3 py-2 font-medium">التاريخ</th>
                          <th className="px-3 py-2 font-medium">الفترة</th>
                          <th className="px-3 py-2 font-medium">الإنجاز</th>
                          <th className="px-3 py-2 font-medium">الصور</th>
                          <th className="px-3 py-2 font-medium text-center">الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportsList.map((report) => {
                          const imgCount = countImages(report);
                          return (
                            <tr
                              key={report.id}
                              role="button"
                              tabIndex={0}
                              aria-label={periodOnly ? `فتح تفاصيل تقرير الفترة من ${fmtDate(report.periodStart)} إلى ${fmtDate(report.periodEnd)}` : `فتح تفاصيل التقرير رقم ${report.reportNumber}`}
                              className="border-t hover:bg-accent/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                              onClick={() => setSelectedReportId(report.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedReportId(report.id);
                                }
                              }}
                            >
                              {!periodOnly && (
                                <td className="px-3 py-2.5 font-bold whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1.5">
                                    <FileText className={`h-4 w-4 ${report.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                                    #{report.reportNumber}
                                  </span>
                                </td>
                              )}
                              {!periodOnly && (
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <Badge variant="outline" className="bg-background">
                                    {reportTypeLabel(report.type)}
                                  </Badge>
                                </td>
                              )}
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                {report.status === "draft" ? (
                                  <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">مسودة</Badge>
                                ) : (
                                  <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100">معتمد</Badge>
                                )}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{fmtDate(report.reportDate)}</td>
                              <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                                {fmtDate(report.periodStart)} — {fmtDate(report.periodEnd)}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                {typeof report.progressPercentage === "number"
                                  ? <Badge className="bg-primary text-white">{Math.round(report.progressPercentage * 10) / 10}%</Badge>
                                  : <span className="text-xs text-amber-800">غير مكتملة</span>}
                                {(report as any).progressHistorySource === "estimated" && (
                                  <p className="mt-1 text-[10px] text-amber-700">سجل تقديري</p>
                                )}
                                {typeof report.progressPercentage === "number"
                                  && typeof (report as any).progressStartPercentage === "number" && (
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    تغير الفترة {((report.progressPercentage - (report as any).progressStartPercentage) >= 0 ? "+" : "")}
                                    {(report.progressPercentage - (report as any).progressStartPercentage).toFixed(1)}%
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                <div className="flex flex-col items-start gap-1">
                                  <span className="inline-flex items-center gap-1">
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    {imgCount}
                                  </span>
                                  {getReportShareState(report) && (
                                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-900">
                                      صور: {shareStateLabel(getReportShareState(report)!)}
                                    </Badge>
                                  )}
                                  {getReportPendingGroupNames(report).length > 0 && (
                                    <span className="max-w-44 truncate text-[10px] text-amber-800"
                                      title={`أقسام لم يكتمل رفعها: ${getReportPendingGroupNames(report).join("، ")}`}>
                                      لم يكتمل: {getReportPendingGroupNames(report).join("، ")}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-left">
                                {renderActions(report)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>}

                {/* Mobile: compact cards */}
                {isMobile && <div className="grid gap-3">
                  {reportsList.map((report) => {
                    const imgCount = countImages(report);
                    return (
                      <Card
                        key={report.id}
                        role="button"
                        tabIndex={0}
                        aria-label={periodOnly ? `فتح تفاصيل تقرير الفترة من ${fmtDate(report.periodStart)} إلى ${fmtDate(report.periodEnd)}` : `فتح تفاصيل التقرير رقم ${report.reportNumber}`}
                        className="overflow-hidden cursor-pointer hover:bg-accent/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelectedReportId(report.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedReportId(report.id);
                          }
                        }}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className={`h-5 w-5 shrink-0 ${report.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                              {periodOnly ? (
                                <span className="font-bold text-sm">{fmtDate(report.periodStart)} — {fmtDate(report.periodEnd)}</span>
                              ) : (
                                <>
                                  <span className="font-bold">#{report.reportNumber}</span>
                                  <Badge variant="outline" className="bg-background text-xs">
                                    {reportTypeLabel(report.type)}
                                  </Badge>
                                </>
                              )}
                              {report.status === "draft" ? (
                                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100 text-xs">مسودة</Badge>
                              ) : (
                                <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 text-xs">معتمد</Badge>
                              )}
                            </div>
                            <div className="shrink-0 text-left">
                              {typeof report.progressPercentage === "number"
                                ? <Badge className="bg-primary text-white">{Math.round(report.progressPercentage * 10) / 10}%</Badge>
                                : <span className="text-xs text-amber-800">غير مكتملة</span>}
                              {(report as any).progressHistorySource === "estimated" && (
                                <p className="mt-1 text-[10px] text-amber-700">سجل تقديري</p>
                              )}
                              {typeof report.progressPercentage === "number"
                                && typeof (report as any).progressStartPercentage === "number" && (
                                <p className="mt-1 text-[10px] text-muted-foreground">
                                  تغير {((report.progressPercentage - (report as any).progressStartPercentage) >= 0 ? "+" : "")}
                                  {(report.progressPercentage - (report as any).progressStartPercentage).toFixed(1)}%
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-mono">{fmtDate(report.reportDate)}</span>
                            {!periodOnly && <span className="font-mono">{fmtDate(report.periodStart)} — {fmtDate(report.periodEnd)}</span>}
                            <span className="inline-flex items-center gap-1">
                              <ImagePlus className="h-3.5 w-3.5" /> {imgCount}
                            </span>
                          </div>
                          {getReportShareState(report) && (
                            <div className="space-y-1">
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                                صور الأقسام: {shareStateLabel(getReportShareState(report)!)}
                              </Badge>
                              {getReportPendingGroupNames(report).length > 0 && (
                                <p className="text-xs text-amber-800">
                                  لم يكتمل رفع: {getReportPendingGroupNames(report).join("، ")}
                                </p>
                              )}
                            </div>
                          )}
                          <div className="pt-1">
                            {renderActions(report)}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>}
              </>
            )}

            <Sheet
              open={!!selectedReport}
              onOpenChange={(open) => { if (!open) setSelectedReportId(null); }}
            >
              <SheetContent
                side="left"
                className="w-full sm:max-w-2xl overflow-y-auto"
                dir="rtl"
              >
                {selectedReport && (
                  <>
                    <SheetHeader className="text-right space-y-3 pr-10">
                      <SheetTitle className="flex items-center gap-2 flex-wrap">
                        <FileText className={`h-5 w-5 ${selectedReport.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                        {periodOnly ? (
                          <span>{fmtDate(selectedReport.periodStart)} — {fmtDate(selectedReport.periodEnd)}</span>
                        ) : (
                          <>
                            تقرير #{selectedReport.reportNumber}
                            <Badge variant="outline" className="bg-background font-normal">
                              {reportTypeLabel(selectedReport.type)}
                            </Badge>
                          </>
                        )}
                      </SheetTitle>
                      <div>{renderActions(selectedReport, "panel")}</div>
                    </SheetHeader>
                    <div className="mt-5">
                      {renderDetailsBody(selectedReport)}
                      <ReportActivityLog projectId={projectId} reportId={selectedReport.id} />
                    </div>
                  </>
                )}
              </SheetContent>
            </Sheet>
          </>
        );
      })()}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذا التقرير؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

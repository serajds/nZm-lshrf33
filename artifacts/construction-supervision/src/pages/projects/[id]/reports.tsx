import { useState, useRef, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { 
  useListReports, 
  useCreateReport, 
  useUpdateReport, 
  useDeleteReport,
  useGetProject,
  useListActivities,
  getListReportsQueryKey 
} from "@workspace/api-client-react";
import type { Report, Activity } from "@workspace/api-client-react";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, ArrowRight, FileText, CheckCircle2, AlertTriangle, ImagePlus, X, Loader2, Calculator, Eye, Printer } from "lucide-react";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { previewReport, type ActivityForReport, type CompanyLogo } from "@/lib/report-pdf";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetchJson(url: string) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.ok ? r.json() : {});
}

const reportSchema = z.object({
  type: z.enum(["weekly", "monthly"]),
  reportDate: z.string().min(1, "تاريخ التقرير مطلوب"),
  periodStart: z.string().min(1, "بداية الفترة مطلوبة"),
  periodEnd: z.string().min(1, "نهاية الفترة مطلوبة"),
  workDescription: z.string().min(1, "وصف الأعمال مطلوب"),
  progressPercentage: z.coerce.number().min(0).max(100),
  technicalNotes: z.string().optional().nullable(),
  recommendations: z.string().optional().nullable(),
  imageUrls: z.array(z.string()).default([]),
});

type ReportFormValues = z.infer<typeof reportSchema>;

export default function ProjectReports() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("التقارير");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });

  const { data: companyLogos } = useQuery<Record<string, CompanyLogo>>({
    queryKey: ["project-company-logos", projectId],
    queryFn: () => authFetchJson(`${API_BASE}/projects/${projectId}/company-logos`),
    enabled: !!projectId,
  });
  
  const { data: reports, isLoading } = useListReports(projectId, {
    type: typeFilter && typeFilter !== "all" ? typeFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }, { query: { enabled: !!projectId } });

  const { data: activities } = useListActivities(projectId, { query: { enabled: !!projectId } });
  
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();

  const calcAutoProgress = () => {
    const acts = (activities ?? []) as Activity[];
    if (acts.length === 0) return null;
    const totalWeight = acts.reduce((s, a) => s + ((a as any).progressWeight ?? 1), 0);
    if (totalWeight === 0) return null;
    const weighted = acts.reduce((s, a) => s + (a.actualProgress ?? 0) * ((a as any).progressWeight ?? 1), 0);
    return Math.round((weighted / totalWeight) * 10) / 10;
  };

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      type: "weekly",
      reportDate: new Date().toISOString().split('T')[0],
      periodStart: "",
      periodEnd: "",
      workDescription: "",
      progressPercentage: 0,
      technicalNotes: "",
      recommendations: "",
      imageUrls: [],
    }
  });

  const watchedType = form.watch("type");
  const watchedPeriodStart = form.watch("periodStart");

  useEffect(() => {
    if (editingId || !watchedPeriodStart) return;
    const startDate = new Date(watchedPeriodStart);
    if (isNaN(startDate.getTime())) return;
    const endDate = new Date(startDate);
    if (watchedType === "monthly") {
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(endDate.getDate() - 1);
    } else {
      endDate.setDate(endDate.getDate() + 6);
    }
    form.setValue("periodEnd", endDate.toISOString().split("T")[0]);
  }, [watchedType, watchedPeriodStart, editingId]);

  const handleEdit = (r: Report) => {
    setEditingId(r.id);
    form.reset({
      type: r.type as ReportFormValues["type"],
      reportDate: new Date(r.reportDate).toISOString().split('T')[0],
      periodStart: new Date(r.periodStart).toISOString().split('T')[0],
      periodEnd: new Date(r.periodEnd).toISOString().split('T')[0],
      workDescription: r.workDescription,
      progressPercentage: r.progressPercentage,
      technicalNotes: r.technicalNotes ?? "",
      recommendations: r.recommendations ?? "",
      imageUrls: r.imageUrls ?? [],
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteReport.mutateAsync({ projectId, id: deletingId });
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      toast({ title: "تم حذف التقرير" });
    } catch {
      toast({ variant: "destructive", title: "فشل الحذف" });
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreview = (report: Report) => {
    if (!project) return;
    const token = localStorage.getItem("auth_token");
    const imageUrls = (report.imageUrls ?? []).map((url) =>
      url.includes("?") ? url : `${url}?token=${token}`
    );
    const snapshotActivities = (report as any).activitiesSnapshot as any[] | null;
    const sourceActivities = snapshotActivities ?? ((activities ?? []) as Activity[]);
    const activityList: ActivityForReport[] = sourceActivities.map((a: any) => {
      let planned = a.plannedProgress ?? 0;
      if (a.plannedStartDate && a.plannedEndDate) {
        const start = new Date(a.plannedStartDate).getTime();
        const end = new Date(a.plannedEndDate).getTime();
        const now = new Date().getTime();
        const duration = end - start;
        if (duration <= 0) { planned = now >= end ? 100 : 0; }
        else {
          const elapsed = now - start;
          if (elapsed <= 0) planned = 0;
          else if (elapsed >= duration) planned = 100;
          else planned = Math.round((elapsed / duration) * 100);
        }
      }
      return {
        name: a.name,
        plannedProgress: planned,
        actualProgress: a.actualProgress ?? 0,
        status: a.status ?? "not_started",
      };
    });
    const apiBase = API_BASE.replace("/api", "");
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
      companyLogos: companyLogos as any,
      apiBase,
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const token = localStorage.getItem("auth_token");
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "image");
      formData.append("description", "صورة تقرير");
      try {
        const resp = await fetch(`/api/projects/${projectId}/files`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (resp.ok) {
          const data = await resp.json() as { fileUrl?: string };
          if (data.fileUrl) {
            newUrls.push(data.fileUrl);
          }
        } else {
          toast({ variant: "destructive", title: `فشل رفع ${file.name}` });
        }
      } catch {
        toast({ variant: "destructive", title: `خطأ في رفع ${file.name}` });
      }
    }
    const current = form.getValues("imageUrls") ?? [];
    form.setValue("imageUrls", [...current, ...newUrls]);
    setIsUploading(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const onSubmit = async (values: ReportFormValues) => {
    try {
      if (editingId) {
        await updateReport.mutateAsync({ projectId, id: editingId, data: values });
        toast({ title: "تم التحديث" });
      } else {
        await createReport.mutateAsync({ projectId, data: values });
        toast({ title: "تمت الإضافة" });
      }
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
    } catch {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">التقارير</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      <div className="bg-card p-3 sm:p-4 rounded-lg border shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <div className="w-full sm:w-40">
            <Select value={typeFilter ?? "all"} onValueChange={(v) => setTypeFilter(v)}>
              <SelectTrigger>
                <SelectValue placeholder="نوع التقرير" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="weekly">أسبوعي</SelectItem>
                <SelectItem value="monthly">شهري</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">من</span>
            <Input type="date" className="flex-1 min-w-0 text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground whitespace-nowrap">إلى</span>
            <Input type="date" className="flex-1 min-w-0 text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح</Button>
            )}
          </div>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { form.reset(); setEditingId(null); }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => {
              if (!editingId) {
                const auto = calcAutoProgress();
                if (auto !== null) form.setValue("progressPercentage", auto);

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
                  const endDate = new Date(nextStart);
                  if (currentType === "monthly") {
                    endDate.setMonth(endDate.getMonth() + 1);
                    endDate.setDate(endDate.getDate() - 1);
                  } else {
                    endDate.setDate(endDate.getDate() + 6);
                  }
                  form.setValue("periodEnd", endDate.toISOString().split("T")[0]);
                }
              }
            }}>
              <Plus className="h-4 w-4" /> إضافة تقرير
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>{editingId ? "تعديل تقرير" : "تقرير جديد"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
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
                        <FormControl><Input type="date" {...field} /></FormControl>
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
                        <FormControl><Input type="date" {...field} /></FormControl>
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
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="progressPercentage"
                    render={({ field }) => {
                      const autoVal = calcAutoProgress();
                      return (
                        <FormItem className="sm:col-span-2">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                            <FormLabel className="mb-0">نسبة الإنجاز حتى تاريخه (%)</FormLabel>
                            {autoVal !== null && (
                              <button
                                type="button"
                                onClick={() => field.onChange(autoVal)}
                                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium bg-primary/8 hover:bg-primary/15 rounded-md px-2.5 py-1 transition-colors border border-primary/20"
                              >
                                <Calculator className="h-3.5 w-3.5" />
                                احتساب تلقائي ({autoVal}%)
                              </button>
                            )}
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                {...field}
                                className="pl-8"
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">%</span>
                            </div>
                          </FormControl>
                          {autoVal !== null && (
                            <p className="text-xs text-muted-foreground mt-1">
                              محتسب من المتوسط الموزون لجميع بنود المشروع ({(activities ?? []).length} بند)
                            </p>
                          )}
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={form.control}
                    name="workDescription"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>وصف الأعمال المنجزة خلال الفترة</FormLabel>
                        <FormControl><Textarea className="min-h-24" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="technicalNotes"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>الملاحظات الفنية (اختياري)</FormLabel>
                        <FormControl><Textarea className="min-h-20" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="recommendations"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>التوصيات (اختياري)</FormLabel>
                        <FormControl><Textarea className="min-h-20" {...field} value={field.value ?? ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Image Upload Section */}
                <FormField
                  control={form.control}
                  name="imageUrls"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <ImagePlus className="h-4 w-4" /> صور الموقع (اختياري)
                      </FormLabel>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleImageUpload}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUploading}
                            onClick={() => imageInputRef.current?.click()}
                            className="gap-2"
                          >
                            {isUploading ? (
                              <><Loader2 className="h-4 w-4 animate-spin" /> جاري الرفع...</>
                            ) : (
                              <><ImagePlus className="h-4 w-4" /> إضافة صور</>
                            )}
                          </Button>
                          {(field.value ?? []).length > 0 && (
                            <span className="text-xs text-muted-foreground">{(field.value ?? []).length} صورة مرفقة</span>
                          )}
                        </div>
                        {(field.value ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {(field.value ?? []).map((url, idx) => (
                              <div key={idx} className="relative group w-20 h-20 rounded-md overflow-hidden border">
                                <img
                                  src={url.includes("?") ? url : `${url}?token=${localStorage.getItem("auth_token")}`}
                                  alt={`صورة ${idx + 1}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = (field.value ?? []).filter((_, i) => i !== idx);
                                    form.setValue("imageUrls", updated);
                                  }}
                                  className="absolute top-0.5 right-0.5 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4 sticky bottom-0 bg-background pb-2 mt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                  <Button type="submit" disabled={createReport.isPending || updateReport.isPending}>حفظ التقرير</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <LoadingSpinner text="جاري تحميل التقارير..." />
        ) : (reports ?? []).length === 0 ? (
          <Card className="border-dashed">
            <EmptyState
              icon={<FileText className="h-7 w-7 text-muted-foreground/60" />}
              title="لا توجد تقارير"
              description="لم يتم إضافة أي تقارير لهذا المشروع بعد"
            />
          </Card>
        ) : (
          (reports ?? []).map((report) => (
            <Card key={report.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="bg-muted p-4 md:w-48 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-l">
                  <FileText className={`h-8 w-8 mb-2 ${report.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                  <div className="text-lg font-bold mb-1">#{report.reportNumber}</div>
                  <Badge variant="outline" className="mb-2 bg-background">
                    {report.type === 'weekly' ? 'أسبوعي' : 'شهري'}
                  </Badge>
                  <div className="text-sm font-semibold font-mono">{fmtDate(report.reportDate)}</div>
                </div>
                <div className="flex-1 p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
                    <div>
                      <div className="text-xs sm:text-sm text-muted-foreground mb-1">
                        الفترة: <span className="font-mono">{fmtDate(report.periodStart)}</span> — <span className="font-mono">{fmtDate(report.periodEnd)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm font-medium">الإنجاز التراكمي:</span>
                        <Badge className="bg-primary">{report.progressPercentage}%</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-violet-600 hover:bg-violet-50 hover:text-violet-700 border-violet-200 gap-1 h-8 text-xs sm:text-sm sm:gap-1.5"
                        onClick={() => handlePreview(report)}
                        title="معاينة وطباعة"
                      >
                        <Printer className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">معاينة و</span>طباعة
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1 h-8 text-xs sm:text-sm sm:gap-1.5" onClick={() => handleEdit(report)}>
                        <Edit2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> تعديل
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white gap-1 h-8 text-xs sm:text-sm sm:gap-1.5" onClick={() => setDeletingId(report.id)}>
                        <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> حذف
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold mb-1 text-foreground">وصف الأعمال</h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{report.workDescription}</p>
                    </div>
                    
                    <div className="grid md:grid-cols-2 gap-4 pt-2 border-t">
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
                    {report.imageUrls && report.imageUrls.length > 0 && (
                      <div className="pt-3 border-t">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                          <ImagePlus className="h-4 w-4 text-muted-foreground" />
                          صور الموقع
                          <span className="text-xs text-muted-foreground font-normal">({report.imageUrls.length} صورة)</span>
                        </h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {report.imageUrls.map((url, idx) => {
                            const authUrl = url.includes("?") ? url : `${url}?token=${localStorage.getItem("auth_token")}`;
                            return (
                              <a
                                key={idx}
                                href={authUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group relative aspect-video rounded-lg overflow-hidden border-2 border-muted hover:border-primary/40 transition-all shadow-sm hover:shadow-md block"
                              >
                                <img
                                  src={authUrl}
                                  alt={`صورة ${idx + 1}`}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <Eye className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-xs px-1.5 py-0.5 rounded">
                                  {idx + 1}/{report.imageUrls!.length}
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
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

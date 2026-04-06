import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useListReports, 
  useCreateReport, 
  useUpdateReport, 
  useDeleteReport,
  useGetProject,
  getListReportsQueryKey 
} from "@workspace/api-client-react";
import type { Report } from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit2, Trash2, ArrowRight, FileText, CheckCircle2, AlertTriangle, Download, ImagePlus, X, Loader2 } from "lucide-react";
import { generateReportPDF } from "@/lib/report-pdf";

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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  
  const { data: reports, isLoading } = useListReports(projectId, {
    type: typeFilter && typeFilter !== "all" ? typeFilter : undefined
  }, { query: { enabled: !!projectId } });
  
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();

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

  const handleDelete = async (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذا التقرير؟")) {
      try {
        await deleteReport.mutateAsync({ projectId, id });
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
        toast({ title: "تم حذف التقرير" });
      } catch {
        toast({ variant: "destructive", title: "فشل الحذف" });
      }
    }
  };

  const handleDownloadPDF = async (report: Report) => {
    if (!project) return;
    setPdfLoadingId(report.id);
    try {
      const token = localStorage.getItem("auth_token");
      const imageUrls = (report.imageUrls ?? []).map((url) =>
        url.includes("?") ? url : `${url}?token=${token}`
      );
      await generateReportPDF({
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
      });
    } catch {
      toast({ variant: "destructive", title: "فشل تصدير PDF" });
    } finally {
      setPdfLoadingId(null);
    }
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

      <div className="flex flex-wrap justify-between items-center bg-card p-4 rounded-lg border shadow-sm gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40">
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
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { form.reset(); setEditingId(null); }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> إضافة تقرير
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>{editingId ? "تعديل تقرير" : "تقرير جديد"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
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
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>نسبة الإنجاز حتى تاريخه (%)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="workDescription"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
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
                      <FormItem className="col-span-2">
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
                      <FormItem className="col-span-2">
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
          <div className="text-center py-12">جاري التحميل...</div>
        ) : (reports ?? []).length === 0 ? (
          <div className="text-center py-12 bg-card rounded-lg border border-dashed">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
            <h3 className="text-lg font-medium">لا توجد تقارير</h3>
            <p className="text-muted-foreground text-sm mt-1">لم يتم إضافة أي تقارير لهذا المشروع بعد</p>
          </div>
        ) : (
          (reports ?? []).map((report) => (
            <Card key={report.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="bg-muted p-4 md:w-48 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-l">
                  <FileText className={`h-8 w-8 mb-2 ${report.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                  <Badge variant="outline" className="mb-2 bg-background">
                    {report.type === 'weekly' ? 'أسبوعي' : 'شهري'}
                  </Badge>
                  <div className="text-sm font-semibold font-mono">{fmtDate(report.reportDate)}</div>
                </div>
                <div className="flex-1 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">
                        الفترة: <span className="font-mono">{fmtDate(report.periodStart)}</span> — <span className="font-mono">{fmtDate(report.periodEnd)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm font-medium">الإنجاز التراكمي:</span>
                        <Badge className="bg-primary">{report.progressPercentage}%</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-blue-600 hover:bg-blue-50 hover:text-blue-700 border-blue-200"
                        onClick={() => handleDownloadPDF(report)}
                        disabled={pdfLoadingId === report.id}
                        title="تحميل PDF"
                      >
                        {pdfLoadingId === report.id
                          ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                          : <Download className="h-4 w-4 ml-1" />}
                        PDF
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleEdit(report)}>
                        <Edit2 className="h-4 w-4 ml-1" /> تعديل
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-white" onClick={() => handleDelete(report.id)}>
                        <Trash2 className="h-4 w-4 ml-1" /> حذف
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
                      <div className="pt-2 border-t">
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                          <ImagePlus className="h-4 w-4" /> صور الموقع ({report.imageUrls.length})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {report.imageUrls.map((url, idx) => {
                            const authUrl = url.includes("?") ? url : `${url}?token=${localStorage.getItem("auth_token")}`;
                            return (
                              <a
                                key={idx}
                                href={authUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-20 h-20 rounded-md overflow-hidden border block hover:opacity-80 transition-opacity"
                              >
                                <img
                                  src={authUrl}
                                  alt={`صورة ${idx + 1}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
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
    </div>
  );
}

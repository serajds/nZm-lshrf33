import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { 
  useListReports, 
  useCreateReport, 
  useUpdateReport, 
  useDeleteReport,
  useGetProject,
  getListReportsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Plus, Edit2, Trash2, ArrowRight, FileText, CheckCircle2, AlertTriangle } from "lucide-react";

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

export default function ProjectReports() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  
  const { data: reports, isLoading } = useListReports(projectId, {
    type: typeFilter && typeFilter !== "all" ? typeFilter : undefined
  }, { query: { enabled: !!projectId } });
  
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();

  const form = useForm<z.infer<typeof reportSchema>>({
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

  const handleEdit = (r: any) => {
    setEditingId(r.id);
    form.reset({
      type: r.type,
      reportDate: new Date(r.reportDate).toISOString().split('T')[0],
      periodStart: new Date(r.periodStart).toISOString().split('T')[0],
      periodEnd: new Date(r.periodEnd).toISOString().split('T')[0],
      workDescription: r.workDescription,
      progressPercentage: r.progressPercentage,
      technicalNotes: r.technicalNotes,
      recommendations: r.recommendations,
      imageUrls: r.imageUrls || [],
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذا التقرير؟")) {
      try {
        await deleteReport.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
        toast({ title: "تم حذف التقرير" });
      } catch (e) {
        toast({ variant: "destructive", title: "فشل الحذف" });
      }
    }
  };

  const onSubmit = async (values: z.infer<typeof reportSchema>) => {
    try {
      // API payload shape
      const payload: any = {
        projectId,
        ...values,
      };

      if (editingId) {
        await updateReport.mutateAsync({ id: editingId, data: payload });
        toast({ title: "تم التحديث" });
      } else {
        await createReport.mutateAsync({ data: payload });
        toast({ title: "تمت الإضافة" });
      }
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
    } catch (e) {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{project?.name} - التقارير</h1>
      </div>

      <Tabs defaultValue="reports" className="w-full" dir="rtl">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6">
          <TabsTrigger value="summary" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}`)}>ملخص المشروع</TabsTrigger>
          <TabsTrigger value="activities" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/activities`)}>الجدول الزمني</TabsTrigger>
          <TabsTrigger value="reports" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3">التقارير</TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/files`)}>الملفات</TabsTrigger>
          <TabsTrigger value="deviation" className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-2 py-3" onClick={() => setLocation(`/projects/${projectId}/deviation`)}>تحليل الانحراف</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex justify-between items-center bg-card p-4 rounded-lg border shadow-sm">
        <div className="w-full sm:w-48">
          <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v)}>
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
                        <FormControl><Textarea className="min-h-20" {...field} value={field.value || ''} /></FormControl>
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
                        <FormControl><Textarea className="min-h-20" {...field} value={field.value || ''} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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
        ) : reports?.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-lg border border-dashed">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
            <h3 className="text-lg font-medium">لا توجد تقارير</h3>
            <p className="text-muted-foreground text-sm mt-1">لم يتم إضافة أي تقارير لهذا المشروع بعد</p>
          </div>
        ) : (
          reports?.map((report: any) => (
            <Card key={report.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="bg-muted p-4 md:w-48 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-l">
                  <FileText className={`h-8 w-8 mb-2 ${report.type === 'weekly' ? 'text-blue-500' : 'text-primary'}`} />
                  <Badge variant="outline" className="mb-2 bg-background">
                    {report.type === 'weekly' ? 'أسبوعي' : 'شهري'}
                  </Badge>
                  <div className="text-sm font-semibold" dir="ltr">{new Date(report.reportDate).toLocaleDateString('ar-SA')}</div>
                </div>
                <div className="flex-1 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">
                        الفترة: <span dir="ltr">{new Date(report.periodStart).toLocaleDateString('ar-SA')}</span> - <span dir="ltr">{new Date(report.periodEnd).toLocaleDateString('ar-SA')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm font-medium">الإنجاز التراكمي:</span>
                        <Badge className="bg-primary">{report.progressPercentage}%</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
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

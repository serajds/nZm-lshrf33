import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProject } from "@workspace/api-client-react";
import { useTabAccess } from "@/hooks/use-tab-access";
import type { ProjectSuspension } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "@/components/project-nav";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowRight, Calendar, FileText, Umbrella, Wind, AlertTriangle, CalendarClock, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDate } from "@/lib/utils";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

const suspensionSchema = z.object({
  type: z.enum(["official_holiday", "force_majeure", "contractor_delay"]),
  title: z.string().min(1, "العنوان مطلوب"),
  startDate: z.string().min(1, "تاريخ البداية مطلوب"),
  endDate: z.string().min(1, "تاريخ النهاية مطلوب"),
  reason: z.string().optional(),
  documentRef: z.string().optional(),
  approvedBy: z.string().optional(),
  notes: z.string().optional(),
  shiftDates: z.boolean().default(true),
});

type SuspensionFormValues = z.infer<typeof suspensionSchema>;


function computeDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function TypeBadge({ type }: { type: "official_holiday" | "force_majeure" | "contractor_delay" }) {
  if (type === "official_holiday") {
    return (
      <Badge className="bg-violet-500 text-white gap-1">
        <Umbrella className="h-3 w-3" /> عطلة رسمية
      </Badge>
    );
  }
  if (type === "force_majeure") {
    return (
      <Badge className="bg-red-500 text-white gap-1">
        <Wind className="h-3 w-3" /> ظرف قاهر
      </Badge>
    );
  }
  return (
    <Badge className="bg-orange-500 text-white gap-1">
      <AlertTriangle className="h-3 w-3" /> توقف مقاول
    </Badge>
  );
}

export default function ProjectSuspensions() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("التوقفات");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { canEdit, isHidden } = useTabAccess(projectId, "suspensions", { redirectIfHidden: true });
  const isViewer = !canEdit;

  const queryKey = [`/api/projects/${projectId}/suspensions`];

  const { data: suspensions = [], isLoading } = useQuery<ProjectSuspension[]>({
    queryKey,
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/suspensions`);
      if (!r.ok) throw new Error("فشل تحميل التوقفات");
      return r.json();
    },
    enabled: !!projectId,
  });

  const createSusp = useMutation({
    mutationFn: async (data: SuspensionFormValues) => {
      const r = await authFetch(`/api/projects/${projectId}/suspensions`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "فشل إضافة التوقف");
      }
      return r.json();
    },
    onSuccess: (data: { activitiesShifted?: boolean }) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/activities`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      if (data?.activitiesShifted) {
        toast({ title: "تم إضافة التوقف وترحيل الجدول الزمني", description: "تم تأجيل تواريخ البنود اللاحقة وتاريخ نهاية المشروع" });
      } else {
        toast({ title: "تم إضافة التوقف بنجاح", description: "لم يتم ترحيل الجدول الزمني" });
      }
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const deleteSusp = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`/api/projects/${projectId}/suspensions/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("فشل حذف التوقف");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/activities`] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "تم حذف التوقف", description: "تم إعادة التواريخ لوضعها السابق إن كان الترحيل مفعّلاً" });
      setDeletingId(null);
    },
    onError: () => toast({ variant: "destructive", title: "فشل حذف التوقف" }),
  });

  const form = useForm<SuspensionFormValues>({
    resolver: zodResolver(suspensionSchema),
    defaultValues: {
      type: "official_holiday",
      title: "",
      startDate: "",
      endDate: "",
      reason: "",
      documentRef: "",
      approvedBy: "",
      notes: "",
      shiftDates: true,
    },
  });

  const watchedStart = form.watch("startDate");
  const watchedEnd = form.watch("endDate");
  const watchedType = form.watch("type");
  const previewDays = computeDays(watchedStart, watchedEnd);
  const isShiftable = watchedType !== "contractor_delay";

  const holidayDays = suspensions
    .filter(s => s.type === "official_holiday")
    .reduce((sum, s) => sum + s.calendarDays, 0);
  const forceMajeureDays = suspensions
    .filter(s => s.type === "force_majeure")
    .reduce((sum, s) => sum + s.calendarDays, 0);
  const contractorDays = suspensions
    .filter(s => s.type === "contractor_delay")
    .reduce((sum, s) => sum + s.calendarDays, 0);
  // Only official + force majeure count toward net delay deduction
  const totalDays = holidayDays + forceMajeureDays;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">التوقفات (العطل الرسمية والظروف القاهرة)</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Umbrella className="h-3.5 w-3.5 text-violet-500" /> العطل الرسمية
            </p>
            <p className={`text-2xl font-bold tabular-nums ${holidayDays > 0 ? "text-violet-600" : "text-muted-foreground"}`}>
              {holidayDays} <span className="text-sm font-normal">يوم</span>
            </p>
            <p className="text-[11px] text-emerald-600 mt-1">✓ يُخصم من التأخير</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Wind className="h-3.5 w-3.5 text-red-500" /> الظروف القاهرة
            </p>
            <p className={`text-2xl font-bold tabular-nums ${forceMajeureDays > 0 ? "text-red-600" : "text-muted-foreground"}`}>
              {forceMajeureDays} <span className="text-sm font-normal">يوم</span>
            </p>
            <p className="text-[11px] text-emerald-600 mt-1">✓ يُخصم من التأخير</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> توقف المقاول
            </p>
            <p className={`text-2xl font-bold tabular-nums ${contractorDays > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
              {contractorDays} <span className="text-sm font-normal">يوم</span>
            </p>
            <p className="text-[11px] text-destructive mt-1">✗ لا يُخصم من التأخير</p>
          </CardContent>
        </Card>

        <Card className={totalDays > 0 ? "border-emerald-400" : ""}>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> المخصوم من التأخير
            </p>
            <p className={`text-2xl font-bold tabular-nums ${totalDays > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
              {totalDays} <span className="text-sm font-normal">يوم</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Suspensions table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">سجل التوقفات الرسمية</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              أيام التوقف تُخصم من التأخير الإجمالي لحساب صافي التأخير الفعلي
            </p>
          </div>
          {!isViewer && (
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) form.reset();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 shrink-0">
                <Plus className="h-4 w-4" /> إضافة توقف
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[650px] p-0 overflow-hidden" dir="rtl">
              <div className="bg-gradient-to-br from-blue-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
                <DialogHeader>
                  <DialogTitle className="text-xl">تسجيل توقف جديد</DialogTitle>
                </DialogHeader>
              </div>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => createSusp.mutate(v))} className="overflow-y-auto max-h-[calc(90vh-140px)]">
                  <div className="p-6 pt-4 space-y-6">
                    <div className="p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm space-y-5">
                      <FormField control={form.control} name="type" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">نوع التوقف</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value} dir="rtl">
                            <FormControl>
                              <SelectTrigger className="h-11 bg-background">
                                <SelectValue placeholder="اختر النوع" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent dir="rtl">
                              <SelectItem value="official_holiday">
                                <span className="flex items-center gap-2"><Umbrella className="h-4 w-4 text-violet-500" /> عطلة رسمية (يُعيد حساب الجدول)</span>
                              </SelectItem>
                              <SelectItem value="force_majeure">
                                <span className="flex items-center gap-2"><Wind className="h-4 w-4 text-red-500" /> ظرف قاهر (يُعيد حساب الجدول)</span>
                              </SelectItem>
                              <SelectItem value="contractor_delay">
                                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-orange-500" /> توقف من المقاول (بدون تعديل الجدول)</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">العنوان</FormLabel>
                          <FormControl>
                            <Input className="h-11 bg-background" placeholder="مثال: عطلة عيد الأضحى، عاصفة مطرية..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                      <FormField control={form.control} name="startDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">تاريخ البداية</FormLabel>
                          <FormControl><Input type="date" className="h-11 bg-background" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="endDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">تاريخ النهاية</FormLabel>
                          <FormControl><Input type="date" className="h-11 bg-background" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      
                      {watchedStart && watchedEnd && (
                        <div className="sm:col-span-2 rounded-xl bg-background border border-border/50 px-4 py-3 text-sm text-foreground/90 shadow-sm flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="font-medium">المدة الإجمالية للتوقف:</span>
                          </div>
                          <Badge variant={previewDays > 0 ? "secondary" : "destructive"} className={previewDays > 0 ? "bg-primary/10 text-primary border-primary/20" : ""}>
                            {previewDays > 0 ? `${previewDays} يوم (شامل)` : "تاريخ النهاية قبل البداية"}
                          </Badge>
                        </div>
                      )}
                    </div>

                    {isShiftable && (
                      <FormField control={form.control} name="shiftDates" render={({ field }) => (
                        <FormItem className="rounded-2xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 transition-colors p-5 shadow-sm">
                          <div className="flex items-start gap-3">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                className="mt-1"
                              />
                            </FormControl>
                            <div className="space-y-1.5 leading-none flex-1">
                              <FormLabel className="text-base font-semibold cursor-pointer flex items-center gap-2 text-foreground/90">
                                <CalendarClock className="h-5 w-5 text-blue-600" />
                                ترحيل الجدول الزمني
                              </FormLabel>
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                تفعيل هذا الخيار سيؤدي إلى تأجيل جميع تواريخ البنود اللاحقة وتاريخ نهاية المشروع بمقدار أيام التوقف.
                              </p>
                            </div>
                          </div>
                        </FormItem>
                      )} />
                    )}

                    <div className="p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm space-y-5">
                      <FormField control={form.control} name="reason" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">السبب / الوصف <span className="text-muted-foreground text-[10px] font-normal px-1.5 py-0.5 bg-muted rounded">(اختياري)</span></FormLabel>
                          <FormControl><Input className="h-11 bg-background" placeholder="تفاصيل إضافية..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">ملاحظات <span className="text-muted-foreground text-[10px] font-normal px-1.5 py-0.5 bg-muted rounded">(اختياري)</span></FormLabel>
                          <FormControl><Input className="h-11 bg-background" placeholder="ملاحظات إضافية..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  
                  <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur-xl p-4 z-10">
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                    <Button type="submit" disabled={createSusp.isPending} className="w-full sm:w-auto shadow-md gap-2">
                      {createSusp.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري الحفظ...</> : <><Plus className="h-4 w-4" /> تأكيد إضافة التوقف</>}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          )}
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto hidden sm:block">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">#</TableHead>
                <TableHead className="text-right">النوع</TableHead>
                <TableHead className="text-right">العنوان</TableHead>
                <TableHead className="text-right">من</TableHead>
                <TableHead className="text-right">إلى</TableHead>
                <TableHead className="text-center">الأيام</TableHead>
                <TableHead className="text-center">الترحيل</TableHead>
                <TableHead className="text-left"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                      <span className="text-sm">جاري تحميل التوقفات...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : suspensions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    لا توجد توقفات مسجّلة — كل التأخير يُحسب على المقاول
                  </TableCell>
                </TableRow>
              ) : (
                suspensions.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                    <TableCell><TypeBadge type={s.type} /></TableCell>
                    <TableCell className="text-sm font-medium max-w-[160px] truncate" title={s.title}>
                      {s.title}
                    </TableCell>
                    <TableCell className="text-sm font-mono tabular-nums">{fmtDate(s.startDate)}</TableCell>
                    <TableCell className="text-sm font-mono tabular-nums">{fmtDate(s.endDate)}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="font-bold">{s.calendarDays}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {"datesShifted" in s && s.datesShifted ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                          <CalendarClock className="h-3 w-3" /> نعم
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">لا</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!isViewer && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setDeletingId(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        {/* Mobile card view */}
        <CardContent className="sm:hidden p-3 space-y-3">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
              <span className="text-sm">جاري تحميل التوقفات...</span>
            </div>
          ) : suspensions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              لا توجد توقفات مسجّلة — كل التأخير يُحسب على المقاول
            </div>
          ) : (
            suspensions.map((s, i) => (
              <div key={s.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0">#{i + 1}</span>
                    <TypeBadge type={s.type} />
                  </div>
                  {!isViewer && (
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                      onClick={() => setDeletingId(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
                <p className="text-sm font-medium">{s.title}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">من</p>
                    <p className="text-sm font-mono tabular-nums">{fmtDate(s.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">إلى</p>
                    <p className="text-sm font-mono tabular-nums">{fmtDate(s.endDate)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1 border-t">
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">الأيام:</span>
                    <Badge variant="secondary" className="font-bold">{s.calendarDays}</Badge>
                  </span>
                  <span className="text-sm">
                    {"datesShifted" in s && s.datesShifted ? (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                        <CalendarClock className="h-3 w-3" /> تم الترحيل
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">بدون ترحيل</span>
                    )}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التوقف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && deleteSusp.mutate(deletingId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

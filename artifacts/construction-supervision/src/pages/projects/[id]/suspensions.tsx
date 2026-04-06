import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProject } from "@workspace/api-client-react";
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
import { Plus, Trash2, ArrowRight, Calendar, FileText, Umbrella, Wind, AlertTriangle, CalendarClock } from "lucide-react";
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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });

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
        toast({ title: "تم إضافة التوقف وترحيل الجدول الزمني", description: "تم تأجيل تواريخ الأنشطة اللاحقة وتاريخ نهاية المشروع" });
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
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) form.reset();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 shrink-0">
                <Plus className="h-4 w-4" /> إضافة توقف
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[540px]" dir="rtl">
              <DialogHeader>
                <DialogTitle>تسجيل توقف جديد</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => createSusp.mutate(v))} className="space-y-4 pt-2">
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>نوع التوقف</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value} dir="rtl">
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="اختر النوع" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent dir="rtl">
                          <SelectItem value="official_holiday">
                            <span className="flex items-center gap-2"><Umbrella className="h-3.5 w-3.5 text-violet-500" /> عطلة رسمية (يُعيد حساب الجدول)</span>
                          </SelectItem>
                          <SelectItem value="force_majeure">
                            <span className="flex items-center gap-2"><Wind className="h-3.5 w-3.5 text-red-500" /> ظرف قاهر (يُعيد حساب الجدول)</span>
                          </SelectItem>
                          <SelectItem value="contractor_delay">
                            <span className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> توقف من المقاول (بدون تعديل الجدول)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>العنوان</FormLabel>
                      <FormControl>
                        <Input placeholder="مثال: عطلة عيد الأضحى، عاصفة مطرية..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="startDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ البداية</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="endDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>تاريخ النهاية</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {watchedStart && watchedEnd && (
                    <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      المدة:{" "}
                      <Badge variant="outline" className={previewDays > 0 ? "text-slate-800 font-bold" : "text-destructive"}>
                        {previewDays > 0 ? `${previewDays} يوم (شامل)` : "تاريخ النهاية يجب أن يكون بعد البداية"}
                      </Badge>
                    </div>
                  )}

                  {isShiftable && (
                    <FormField control={form.control} name="shiftDates" render={({ field }) => (
                      <FormItem className="rounded-md border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-3">
                        <div className="flex items-start gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              className="mt-0.5"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none flex-1">
                            <FormLabel className="text-sm font-medium cursor-pointer flex items-center gap-1.5">
                              <CalendarClock className="h-4 w-4 text-blue-600" />
                              ترحيل الجدول الزمني
                            </FormLabel>
                            <p className="text-xs text-muted-foreground">
                              تأجيل تواريخ الأنشطة اللاحقة وتاريخ نهاية المشروع بعدد أيام التوقف
                            </p>
                          </div>
                        </div>
                      </FormItem>
                    )} />
                  )}

                  <FormField control={form.control} name="reason" render={({ field }) => (
                    <FormItem>
                      <FormLabel>السبب / الوصف</FormLabel>
                      <FormControl><Input placeholder="تفاصيل إضافية..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="documentRef" render={({ field }) => (
                      <FormItem>
                        <FormLabel>رقم الوثيقة / الخطاب</FormLabel>
                        <FormControl><Input placeholder="مثال: خ/5001/2025" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="approvedBy" render={({ field }) => (
                      <FormItem>
                        <FormLabel>الجهة الموثِّقة</FormLabel>
                        <FormControl><Input placeholder="مثال: وزارة العدل" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>ملاحظات</FormLabel>
                      <FormControl><Input placeholder="ملاحظات إضافية..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                    <Button type="submit" disabled={createSusp.isPending}>
                      {createSusp.isPending ? "جاري الحفظ..." : "إضافة التوقف"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
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
                <TableHead className="text-right">الوثيقة</TableHead>
                <TableHead className="text-right">الجهة الموثِّقة</TableHead>
                <TableHead className="text-left"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell>
                </TableRow>
              ) : suspensions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
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
                    <TableCell className="text-sm font-mono">
                      {s.documentRef ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.approvedBy ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setDeletingId(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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

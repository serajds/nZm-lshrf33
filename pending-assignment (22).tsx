import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetProject } from "@workspace/api-client-react";
import { useTabAccess } from "@/hooks/use-tab-access";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, ArrowRight, Calendar, FileText, Clock, Loader2
} from "lucide-react";
import { fmtDate } from "@/lib/utils";

interface ProjectExtension {
  id: number;
  projectId: number;
  extensionDate: string;
  daysAdded: number;
  newEndDate: string;
  reason: string | null;
  documentRef: string | null;
  approvedBy: string | null;
  notes: string | null;
  createdAt: string;
}

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

const extensionSchema = z.object({
  extensionDate: z.string().min(1, "تاريخ التمديد مطلوب"),
  daysAdded: z.coerce.number().min(1, "يجب أن يكون عدد الأيام أكبر من صفر"),
  reason: z.string().optional(),
  documentRef: z.string().optional(),
  approvedBy: z.string().optional(),
  notes: z.string().optional(),
});

type ExtensionFormValues = z.infer<typeof extensionSchema>;


export default function ProjectExtensions() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("التمديدات");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { canEdit, isHidden } = useTabAccess(projectId, "extensions", { redirectIfHidden: true });
  const isViewer = !canEdit;

  const queryKey = [`/api/projects/${projectId}/extensions`];

  const { data: extensions = [], isLoading } = useQuery<ProjectExtension[]>({
    queryKey,
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/extensions`);
      if (!r.ok) throw new Error("فشل تحميل التمديدات");
      return r.json();
    },
    enabled: !!projectId,
  });

  const createExt = useMutation({
    mutationFn: async (data: ExtensionFormValues) => {
      const r = await authFetch(`/api/projects/${projectId}/extensions`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "فشل إضافة التمديد");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      toast({ title: "تم إضافة التمديد بنجاح" });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const deleteExt = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`/api/projects/${projectId}/extensions/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("فشل حذف التمديد");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
      toast({ title: "تم حذف التمديد" });
      setDeletingId(null);
    },
    onError: () => toast({ variant: "destructive", title: "فشل حذف التمديد" }),
  });

  const form = useForm<ExtensionFormValues>({
    resolver: zodResolver(extensionSchema),
    defaultValues: {
      extensionDate: "",
      daysAdded: 30,
      reason: "",
      documentRef: "",
      approvedBy: "",
      notes: "",
    },
  });

  const totalDaysAdded = extensions.reduce((s, e) => s + e.daysAdded, 0);
  const latestEndDate = extensions.length > 0
    ? extensions[extensions.length - 1].newEndDate
    : project?.expectedEndDate;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">التمديدات الزمنية</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className={totalDaysAdded > 0 ? "border-amber-400" : ""}>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> النهاية المتوقعة {totalDaysAdded > 0 && "(شاملة التمديدات)"}
            </p>
            <p className={`text-lg font-bold tabular-nums ${totalDaysAdded > 0 ? "text-amber-600" : ""}`} dir="ltr">
              {project?.expectedEndDate ? fmtDate(project.expectedEndDate) : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> إجمالي أيام التمديد
            </p>
            <p className={`text-2xl font-bold tabular-nums ${totalDaysAdded > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
              {totalDaysAdded} <span className="text-sm font-normal">يوم</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> عدد التمديدات
            </p>
            <p className="text-2xl font-bold tabular-nums">
              {extensions.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Extensions table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">سجل التمديدات الرسمية</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              كل تمديد يُحسب من تاريخ نهاية التمديد السابق أو من التاريخ الأصلي إذا لم يوجد
            </p>
          </div>
          {!isViewer && (
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) form.reset();
          }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2 shrink-0">
                <Plus className="h-4 w-4" /> إضافة تمديد
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden" dir="rtl">
              <div className="bg-gradient-to-br from-blue-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
                <DialogHeader>
                  <DialogTitle className="text-xl">تمديد زمني جديد</DialogTitle>
                </DialogHeader>
              </div>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => createExt.mutate(v))} className="p-6 pt-4 space-y-6">
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                    <FormField control={form.control} name="extensionDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground/90">تاريخ الاتفاقية</FormLabel>
                        <FormControl><Input type="date" className="h-11 bg-background" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="daysAdded" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground/90">عدد الأيام المضافة</FormLabel>
                        <FormControl><Input type="number" min={1} className="h-11 bg-background font-mono" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {latestEndDate && (
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-900 dark:text-amber-200 shadow-sm flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 font-medium">
                        <Calendar className="h-4 w-4" /> التأثير المتوقع على تاريخ الإنهاء:
                      </div>
                      <div>
                        التاريخ الحالي:{" "}
                        <span className="font-bold bg-background/50 px-1.5 rounded" dir="ltr">{fmtDate(latestEndDate)}</span>
                        {" "}← سيصبح بعد إضافة{" "}
                        <span className="font-bold text-amber-700 dark:text-amber-400">{form.watch("daysAdded") || 0}</span> يوم:{" "}
                        <span className="font-bold bg-background/50 px-1.5 rounded" dir="ltr">
                          {(() => {
                            const d = new Date(latestEndDate);
                            d.setDate(d.getDate() + (form.watch("daysAdded") || 0));
                            return fmtDate(d.toISOString().split("T")[0]);
                          })()}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm space-y-5">
                    <FormField control={form.control} name="reason" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground/90">سبب التمديد</FormLabel>
                        <FormControl><Input className="h-11 bg-background" placeholder="مثال: ظروف مناخية، أعمال إضافية..." {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <FormField control={form.control} name="documentRef" render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground/90">رقم الخطاب المرجعي</FormLabel>
                          <FormControl><Input className="h-11 bg-background" placeholder="مثال: خ/1234/2025" {...field} /></FormControl>
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

                  <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                    <Button type="submit" disabled={createExt.isPending} className="w-full sm:w-auto shadow-md gap-2">
                      {createExt.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري الحفظ...</> : <><Plus className="h-4 w-4" /> إضافة التمديد</>}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          )}
        </CardHeader>

        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">#</TableHead>
                <TableHead className="text-right">تاريخ الاتفاقية</TableHead>
                <TableHead className="text-center">الأيام المضافة</TableHead>
                <TableHead className="text-right">تاريخ الإنهاء الجديد</TableHead>
                <TableHead className="text-right">السبب</TableHead>
                <TableHead className="text-right">رقم الخطاب</TableHead>
                <TableHead className="text-left"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                      <span className="text-sm">جاري تحميل التمديدات...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : extensions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    لا توجد تمديدات مسجّلة — المشروع يسير وفق الجدول الأصلي
                  </TableCell>
                </TableRow>
              ) : (
                extensions.map((ext, i) => (
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
                    <TableCell>
                      {!isViewer && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => setDeletingId(ext.id)}
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
      </Card>

      {/* Delete confirm */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التمديد</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف هذا التمديد؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && deleteExt.mutate(deletingId)}
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

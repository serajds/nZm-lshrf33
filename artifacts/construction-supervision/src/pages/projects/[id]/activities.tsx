import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useListActivities, 
  useCreateActivity, 
  useUpdateActivity, 
  useDeleteActivity,
  useGetProject,
  getListActivitiesQueryKey 
} from "@workspace/api-client-react";
import type { Activity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, Edit2, Trash2, ArrowRight, ChevronDown,
  CheckCircle2, Clock, AlertTriangle, PlayCircle, 
  TrendingUp, TrendingDown, Minus
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

const STATUS_OPTIONS = [
  { value: "not_started",  label: "لم يبدأ",      icon: Clock,         cls: "text-muted-foreground" },
  { value: "in_progress",  label: "قيد التنفيذ",   icon: PlayCircle,    cls: "text-blue-500" },
  { value: "completed",    label: "مكتمل",          icon: CheckCircle2,  cls: "text-emerald-600" },
  { value: "delayed",      label: "متأخر",          icon: AlertTriangle, cls: "text-destructive" },
] as const;

const activitySchema = z.object({
  name: z.string().min(1, "اسم النشاط مطلوب"),
  plannedStartDate: z.string().min(1, "تاريخ البداية المخطط مطلوب"),
  plannedEndDate: z.string().min(1, "تاريخ النهاية المخطط مطلوب"),
  actualStartDate: z.string().optional().nullable(),
  actualEndDate: z.string().optional().nullable(),
  plannedProgress: z.coerce.number().min(0).max(100),
  actualProgress: z.coerce.number().min(0).max(100),
  status: z.enum(["not_started", "in_progress", "completed", "delayed"]).default("not_started"),
  sortOrder: z.coerce.number().default(0),
});

type ActivityFormValues = z.infer<typeof activitySchema>;

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_OPTIONS.find(o => o.value === status);
  if (!s) return <Badge variant="outline">{status}</Badge>;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {s.label}
    </span>
  );
}

function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-left">{value}%</span>
    </div>
  );
}

export default function ProjectActivities() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: activities, isLoading } = useListActivities(projectId, { query: { enabled: !!projectId } });
  
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: {
      name: "", plannedStartDate: "", plannedEndDate: "",
      actualStartDate: "", actualEndDate: "",
      plannedProgress: 0, actualProgress: 0,
      status: "not_started", sortOrder: 0,
    }
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(projectId) });

  const handleEdit = (a: Activity) => {
    setEditingId(a.id);
    form.reset({
      name: a.name,
      plannedStartDate: new Date(a.plannedStartDate).toISOString().split('T')[0],
      plannedEndDate: new Date(a.plannedEndDate).toISOString().split('T')[0],
      actualStartDate: a.actualStartDate ? new Date(a.actualStartDate).toISOString().split('T')[0] : "",
      actualEndDate: a.actualEndDate ? new Date(a.actualEndDate).toISOString().split('T')[0] : "",
      plannedProgress: a.plannedProgress,
      actualProgress: a.actualProgress,
      status: a.status as ActivityFormValues["status"],
      sortOrder: a.sortOrder ?? 0,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteActivity.mutateAsync({ projectId, id: deletingId });
      invalidate();
      toast({ title: "تم حذف النشاط" });
    } catch {
      toast({ variant: "destructive", title: "فشل الحذف" });
    } finally {
      setDeletingId(null);
    }
  };

  /* ── Quick status update ── */
  const quickUpdateStatus = async (a: Activity, newStatus: string) => {
    if (a.status === newStatus) return;
    setUpdatingId(a.id);
    try {
      const extra: Record<string, unknown> = {};
      if (newStatus === "completed") extra.actualProgress = 100;
      if (newStatus === "not_started") extra.actualProgress = 0;
      await updateActivity.mutateAsync({ projectId, id: a.id, data: { status: newStatus, ...extra } });
      invalidate();
      toast({ title: "تم تحديث الحالة" });
    } catch {
      toast({ variant: "destructive", title: "فشل التحديث" });
    } finally {
      setUpdatingId(null);
    }
  };

  /* ── Quick progress increment ── */
  const quickIncrement = async (a: Activity, delta: number) => {
    const next = Math.min(100, Math.max(0, a.actualProgress + delta));
    if (next === a.actualProgress) return;
    setUpdatingId(a.id);
    try {
      const autoStatus = next === 100 ? "completed" : next === 0 ? "not_started" : "in_progress";
      await updateActivity.mutateAsync({
        projectId, id: a.id,
        data: { actualProgress: next, status: autoStatus }
      });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "فشل التحديث" });
    } finally {
      setUpdatingId(null);
    }
  };

  const onSubmit = async (values: ActivityFormValues) => {
    try {
      const payload = {
        ...values,
        actualStartDate: values.actualStartDate || null,
        actualEndDate: values.actualEndDate || null,
      };
      if (editingId) {
        await updateActivity.mutateAsync({ projectId, id: editingId, data: payload });
        toast({ title: "تم التحديث" });
      } else {
        await createActivity.mutateAsync({ projectId, data: payload });
        toast({ title: "تمت الإضافة" });
      }
      invalidate();
      setIsDialogOpen(false);
      form.reset();
      setEditingId(null);
    } catch {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'not_started': return <Badge variant="outline">لم يبدأ</Badge>;
      case 'in_progress': return <Badge className="bg-blue-500">قيد التنفيذ</Badge>;
      case 'completed': return <Badge className="bg-emerald-500">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const ganttData = (activities ?? []).map((a) => ({
    name: a.name.length > 14 ? a.name.slice(0, 14) + "…" : a.name,
    "المخطط": a.plannedProgress,
    "الفعلي": a.actualProgress,
  }));

  const allDates = (activities ?? []).flatMap(a => [
    a.plannedStartDate, a.plannedEndDate, a.actualStartDate, a.actualEndDate
  ].filter(Boolean) as string[]);
  const ganttStart = allDates.length > 0
    ? new Date(Math.min(...allDates.map(d => new Date(d).getTime())))
    : new Date(project?.startDate ?? Date.now());
  const ganttEnd = allDates.length > 0
    ? new Date(Math.max(...allDates.map(d => new Date(d).getTime())))
    : new Date(project?.expectedEndDate ?? Date.now());
  const totalDays = Math.max(1, (ganttEnd.getTime() - ganttStart.getTime()) / (1000 * 60 * 60 * 24));

  const getBarStyle = (startDate: string, endDate: string, color: string) => {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    const left = ((s - ganttStart.getTime()) / (1000 * 60 * 60 * 24)) / totalDays * 100;
    const width = Math.max(1, ((e - s) / (1000 * 60 * 60 * 24)) / totalDays * 100);
    return { left: `${left}%`, width: `${width}%`, backgroundColor: color };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">الجدول الزمني</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      <div className="grid gap-6">
        {/* Gantt Timeline */}
        {(activities ?? []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">مخطط Gantt - الجدول الزمني</CardTitle>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded-sm inline-block bg-blue-400 opacity-60" /> المخطط
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded-sm inline-block bg-emerald-500" /> الفعلي
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2.5 rounded-sm inline-block bg-red-500" /> متأخر
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div className="flex mb-2 border-b pb-2">
                    <div className="w-52 shrink-0 text-xs font-medium text-muted-foreground">النشاط</div>
                    <div className="flex-1 text-xs text-muted-foreground flex justify-between px-1">
                      <span>{ganttStart.toLocaleDateString('ar-SA-u-nu-latn')}</span>
                      <span>{new Date((ganttStart.getTime() + ganttEnd.getTime()) / 2).toLocaleDateString('ar-SA-u-nu-latn')}</span>
                      <span>{ganttEnd.toLocaleDateString('ar-SA-u-nu-latn')}</span>
                    </div>
                  </div>
                  {(activities ?? []).map((a) => (
                    <div key={a.id} className="flex items-center mb-3">
                      <div className="w-52 shrink-0 text-xs truncate pl-2 flex items-center gap-1.5">
                        <StatusBadge status={a.status} />
                        <span className="truncate text-foreground" title={a.name}>{a.name}</span>
                      </div>
                      <div className="flex-1 relative h-8">
                        <div className="absolute inset-0 flex flex-col justify-center gap-1">
                          <div className="relative h-3">
                            <div
                              className="absolute h-full rounded opacity-60"
                              style={getBarStyle(a.plannedStartDate, a.plannedEndDate, "#60a5fa")}
                              title={`مخطط: ${a.plannedStartDate} → ${a.plannedEndDate}`}
                            />
                          </div>
                          {a.actualStartDate && (
                            <div className="relative h-3">
                              <div
                                className="absolute h-full rounded"
                                style={getBarStyle(
                                  a.actualStartDate,
                                  a.actualEndDate ?? new Date().toISOString().split('T')[0],
                                  a.status === 'delayed' ? '#ef4444' : '#10b981'
                                )}
                                title={`فعلي: ${a.actualStartDate} → ${a.actualEndDate ?? 'جارٍ'}`}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="w-12 text-center text-xs font-medium text-primary">{a.actualProgress}%</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress Comparison Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الإنجاز المخطط مقابل الفعلي</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ganttData} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" height={60} interval={0} fontSize={11} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} />
                  <Tooltip
                    contentStyle={{ textAlign: 'right', direction: 'rtl', fontSize: 12 }}
                    formatter={(v: number) => [`${v}%`]}
                  />
                  <Bar dataKey="المخطط" fill="hsl(var(--muted-foreground))" opacity={0.4} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="الفعلي" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Activities Table with Quick Actions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">الأنشطة</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">انقر على الحالة أو نسبة الإنجاز لتحديثها مباشرةً</p>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) { form.reset(); setEditingId(null); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2 shrink-0">
                  <Plus className="h-4 w-4" /> إضافة نشاط
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]" dir="rtl">
                <DialogHeader>
                  <DialogTitle>{editingId ? "تعديل نشاط" : "نشاط جديد"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>اسم النشاط</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField control={form.control} name="plannedStartDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>بداية مخططة</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="plannedEndDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>نهاية مخططة</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="actualStartDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>بداية فعلية</FormLabel>
                          <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="actualEndDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>نهاية فعلية</FormLabel>
                          <FormControl><Input type="date" {...field} value={field.value ?? ""} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="plannedProgress" render={({ field }) => (
                        <FormItem>
                          <FormLabel>الإنجاز المخطط (%)</FormLabel>
                          <FormControl><Input type="number" min={0} max={100} {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="actualProgress" render={({ field }) => (
                        <FormItem>
                          <FormLabel>الإنجاز الفعلي (%)</FormLabel>
                          <FormControl><Input type="number" min={0} max={100} {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="status" render={({ field }) => (
                        <FormItem>
                          <FormLabel>الحالة</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger dir="rtl"><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent dir="rtl">
                              {STATUS_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="sortOrder" render={({ field }) => (
                        <FormItem>
                          <FormLabel>الترتيب</FormLabel>
                          <FormControl><Input type="number" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                      <Button type="submit" disabled={form.formState.isSubmitting}>
                        {form.formState.isSubmitting ? "جاري الحفظ..." : "حفظ"}
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
                  <TableHead className="text-right w-[220px]">النشاط</TableHead>
                  <TableHead className="text-right">البداية</TableHead>
                  <TableHead className="text-right">النهاية</TableHead>
                  <TableHead className="text-center w-[160px]">الإنجاز (مخطط/فعلي)</TableHead>
                  <TableHead className="text-right w-[140px]">الحالة</TableHead>
                  <TableHead className="text-center w-[130px]">إجراءات سريعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell>
                  </TableRow>
                ) : (activities ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا يوجد أنشطة — أضف أول نشاط</TableCell>
                  </TableRow>
                ) : (
                  (activities ?? []).map((a) => {
                    const isBusy = updatingId === a.id;
                    const deviation = a.actualProgress - a.plannedProgress;
                    return (
                      <TableRow key={a.id} className={isBusy ? "opacity-60 pointer-events-none" : ""}>
                        {/* Name */}
                        <TableCell className="font-medium max-w-[220px]">
                          <span className="block truncate" title={a.name}>{a.name}</span>
                        </TableCell>

                        {/* Dates */}
                        <TableCell className="text-sm text-muted-foreground tabular-nums" dir="ltr">
                          {new Date(a.plannedStartDate).toLocaleDateString('ar-SA-u-nu-latn')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground tabular-nums" dir="ltr">
                          {new Date(a.plannedEndDate).toLocaleDateString('ar-SA-u-nu-latn')}
                        </TableCell>

                        {/* Progress visual */}
                        <TableCell className="w-[160px]">
                          <div className="space-y-1">
                            <ProgressBar value={a.plannedProgress} color="hsl(var(--muted-foreground)/0.4)" />
                            <ProgressBar value={a.actualProgress} color="hsl(var(--primary))" />
                            <div className={`text-xs flex items-center gap-0.5 justify-end ${deviation < 0 ? 'text-destructive' : deviation > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                              {deviation < 0 ? <TrendingDown className="h-3 w-3" /> : deviation > 0 ? <TrendingUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {deviation > 0 ? '+' : ''}{deviation}%
                            </div>
                          </div>
                        </TableCell>

                        {/* Status - quick change dropdown */}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent transition-colors text-sm">
                                <StatusBadge status={a.status} />
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent dir="rtl" align="start">
                              <DropdownMenuLabel className="text-xs text-muted-foreground">تغيير الحالة</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {STATUS_OPTIONS.map(opt => {
                                const Icon = opt.icon;
                                return (
                                  <DropdownMenuItem
                                    key={opt.value}
                                    className={`gap-2 ${opt.cls} ${a.status === opt.value ? 'font-bold bg-accent' : ''}`}
                                    onClick={() => quickUpdateStatus(a, opt.value)}
                                  >
                                    <Icon className="h-4 w-4" />
                                    {opt.label}
                                    {a.status === opt.value && <span className="mr-auto text-xs">✓</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>

                        {/* Quick Actions */}
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {/* -10% */}
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              title="تخفيض الإنجاز 10%"
                              onClick={() => quickIncrement(a, -10)}
                              disabled={a.actualProgress === 0}
                            >
                              <span className="text-xs font-bold text-muted-foreground">-10</span>
                            </Button>
                            {/* +10% */}
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              title="رفع الإنجاز 10%"
                              onClick={() => quickIncrement(a, 10)}
                              disabled={a.actualProgress === 100}
                            >
                              <span className="text-xs font-bold text-primary">+10</span>
                            </Button>
                            {/* Edit */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(a)}>
                              <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            {/* Delete */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(a.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirm */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذا النشاط؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
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

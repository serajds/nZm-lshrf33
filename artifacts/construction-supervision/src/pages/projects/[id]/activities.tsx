import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  useListActivities, 
  useCreateActivity, 
  useUpdateActivity, 
  useDeleteActivity,
  useGetProject,
  getListActivitiesQueryKey 
} from "@workspace/api-client-react";
import type { Activity, ProjectSuspension } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
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
  TrendingUp, TrendingDown, Minus, Timer, CalendarCheck, CalendarX, Hourglass
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

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

type DelayInfo =
  | { kind: "delayed";  days: number; label: string }
  | { kind: "early";   days: number; label: string }
  | { kind: "on_time"; days: number; label: string }
  | { kind: "remaining"; days: number; label: string }
  | { kind: "late_start"; days: number; label: string };

function calcActivityDelay(a: Activity): DelayInfo {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const plannedEnd = new Date(a.plannedEndDate); plannedEnd.setHours(0, 0, 0, 0);
  const plannedStart = new Date(a.plannedStartDate); plannedStart.setHours(0, 0, 0, 0);
  const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

  if (a.status === "completed") {
    const refDate = a.actualEndDate ? new Date(a.actualEndDate) : today;
    refDate.setHours(0, 0, 0, 0);
    const d = diffDays(refDate, plannedEnd);
    if (d > 0) return { kind: "delayed",  days: d, label: `متأخر ${d} يوم` };
    if (d < 0) return { kind: "early",    days: -d, label: `مبكر ${-d} يوم` };
    return { kind: "on_time", days: 0, label: "في الموعد" };
  }

  if (a.status === "not_started") {
    const d = diffDays(today, plannedStart);
    if (d > 0) return { kind: "late_start", days: d,  label: `تأخر البدء ${d} يوم` };
    return { kind: "remaining", days: -d, label: `${-d} يوم للبدء` };
  }

  // in_progress or delayed
  const d = diffDays(today, plannedEnd);
  if (d > 0) return { kind: "delayed",   days: d,  label: `متأخر ${d} يوم` };
  if (d === 0) return { kind: "on_time", days: 0,  label: "آخر يوم مخطط" };
  return { kind: "remaining", days: -d, label: `${-d} يوم متبقٍ` };
}

function DelayBadge({ info }: { info: DelayInfo }) {
  if (info.kind === "delayed" || info.kind === "late_start") {
    const Icon = info.kind === "late_start" ? CalendarX : Timer;
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800 whitespace-nowrap">
        <Icon className="h-3 w-3 shrink-0" /> {info.label}
      </span>
    );
  }
  if (info.kind === "early") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 whitespace-nowrap">
        <CalendarCheck className="h-3 w-3 shrink-0" /> {info.label}
      </span>
    );
  }
  if (info.kind === "on_time") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800 whitespace-nowrap">
        <CalendarCheck className="h-3 w-3 shrink-0" /> {info.label}
      </span>
    );
  }
  // remaining
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground border border-border whitespace-nowrap">
      <Hourglass className="h-3 w-3 shrink-0" /> {info.label}
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
  const { data: suspensions = [] } = useQuery<ProjectSuspension[]>({
    queryKey: [`/api/projects/${projectId}/suspensions`],
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/suspensions`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });
  
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
        {/* ── Gantt Chart ── */}
        {(activities ?? []).length > 0 && (() => {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const spanMs = ganttEnd.getTime() - ganttStart.getTime();
          const toPct = (d: Date) => Math.max(0, Math.min(100, (d.getTime() - ganttStart.getTime()) / spanMs * 100));
          const todayPct = toPct(today);
          const NAME_W = 176; // px — fixed name column

          const ticks = [0, 25, 50, 75, 100].map(p => ({
            pct: p,
            label: fmtDate(new Date(ganttStart.getTime() + p / 100 * spanMs).toISOString().split("T")[0]),
          }));

          const suspLabel = (t: string) =>
            t === "official_holiday" ? "عطلة رسمية" : t === "force_majeure" ? "ظرف قاهر" : "توقف مقاول";

          return (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <CardTitle className="text-base">مخطط Gantt - الجدول الزمني</CardTitle>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-6 h-3 rounded-sm bg-blue-400/70" /> مخطط
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-6 h-3 rounded-sm bg-emerald-500" /> فعلي / مكتمل
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-6 h-3 rounded-sm bg-red-500" /> فعلي / متأخر
                    </span>
                    {suspensions.some(s => s.type === "official_holiday") && (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-4 h-3 rounded-sm" style={{ background: "rgba(139,92,246,0.35)", border: "1px solid rgba(139,92,246,0.6)" }} /> عطلة رسمية
                      </span>
                    )}
                    {suspensions.some(s => s.type === "force_majeure") && (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-4 h-3 rounded-sm" style={{ background: "rgba(239,68,68,0.25)", border: "1px solid rgba(239,68,68,0.5)" }} /> ظرف قاهر
                      </span>
                    )}
                    {suspensions.some(s => s.type === "contractor_delay") && (
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-4 h-3 rounded-sm" style={{ background: "rgba(249,115,22,0.25)", border: "1px solid rgba(249,115,22,0.5)" }} /> توقف مقاول
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-px h-3 bg-red-500" style={{ borderLeft: "2px dashed #ef4444" }} /> اليوم
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <div style={{ minWidth: 640 }}>

                    {/* ── Date tick header ── */}
                    <div className="flex items-end border-b border-border pb-1 mb-0" style={{ paddingRight: NAME_W }}>
                      <div className="flex-1 relative h-6">
                        {ticks.map(({ pct, label }) => (
                          <span
                            key={pct}
                            className="absolute bottom-0 text-[10px] font-mono text-muted-foreground"
                            style={{
                              right: `${pct}%`,
                              transform: pct === 0 ? "none" : pct === 100 ? "translateX(100%)" : "translateX(50%)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* ── Activity rows ── */}
                    {(activities ?? []).map((a, idx) => {
                      const barColor = a.status === "delayed" ? "#ef4444" : a.status === "completed" ? "#10b981" : "#10b981";
                      const actualEnd = a.actualEndDate ?? (a.actualStartDate ? today.toISOString().split("T")[0] : null);
                      const isLast = idx === (activities ?? []).length - 1;

                      return (
                        <div
                          key={a.id}
                          className={`flex items-stretch ${!isLast ? "border-b border-border/50" : ""}`}
                          style={{ minHeight: 54 }}
                        >
                          {/* Name column */}
                          <div
                            className="shrink-0 flex items-center gap-2 py-2 pr-1 border-l border-border/40"
                            style={{ width: NAME_W, minWidth: NAME_W }}
                          >
                            <StatusBadge status={a.status} />
                            <span
                              className="text-xs font-medium text-foreground leading-tight line-clamp-2"
                              style={{ maxWidth: NAME_W - 56 }}
                              title={a.name}
                            >
                              {a.name}
                            </span>
                          </div>

                          {/* Timeline column */}
                          <div className="flex-1 relative py-2">

                            {/* Grid lines */}
                            {[25, 50, 75].map(p => (
                              <div key={p} className="absolute inset-y-0 w-px bg-border/50" style={{ right: `${p}%` }} />
                            ))}

                            {/* Today marker */}
                            {todayPct > 0 && todayPct < 100 && (
                              <div
                                className="absolute inset-y-0 w-px z-20 pointer-events-none"
                                style={{ right: `${todayPct}%`, borderRight: "2px dashed #ef4444", opacity: 0.75 }}
                                title={`اليوم: ${fmtDate(today.toISOString().split("T")[0])}`}
                              />
                            )}

                            {/* Suspension overlays */}
                            {suspensions.map(susp => {
                              const sl = toPct(new Date(susp.startDate));
                              const er = toPct(new Date(susp.endDate));
                              const sw = Math.max(0.4, er - sl);
                              const bg = susp.type === "official_holiday"
                                ? "rgba(139,92,246,0.14)"
                                : susp.type === "force_majeure"
                                  ? "rgba(239,68,68,0.12)"
                                  : "rgba(249,115,22,0.12)";
                              const bd = susp.type === "official_holiday"
                                ? "1px solid rgba(139,92,246,0.45)"
                                : susp.type === "force_majeure"
                                  ? "1px solid rgba(239,68,68,0.4)"
                                  : "1px solid rgba(249,115,22,0.45)";
                              return (
                                <div
                                  key={susp.id}
                                  className="absolute inset-y-0 z-0"
                                  style={{ right: `${sl}%`, width: `${sw}%`, background: bg, borderLeft: bd, borderRight: bd }}
                                  title={`${suspLabel(susp.type)}: ${susp.startDate} ← ${susp.endDate} (${susp.calendarDays} يوم)`}
                                />
                              );
                            })}

                            {/* Bars */}
                            <div className="absolute inset-0 z-10 flex flex-col justify-center gap-1.5 px-0">
                              {/* Planned bar */}
                              <div className="relative h-4">
                                {(() => {
                                  const sl = toPct(new Date(a.plannedStartDate));
                                  const el = toPct(new Date(a.plannedEndDate));
                                  const w = Math.max(0.5, el - sl);
                                  return (
                                    <div
                                      className="absolute h-full rounded-full bg-blue-400/70"
                                      style={{ right: `${sl}%`, width: `${w}%` }}
                                      title={`مخطط: ${fmtDate(a.plannedStartDate)} → ${fmtDate(a.plannedEndDate)}`}
                                    />
                                  );
                                })()}
                              </div>

                              {/* Actual bar */}
                              {a.actualStartDate && actualEnd && (
                                <div className="relative h-4">
                                  {(() => {
                                    const sl = toPct(new Date(a.actualStartDate));
                                    const el = toPct(new Date(actualEnd));
                                    const w = Math.max(0.5, el - sl);
                                    const ongoing = !a.actualEndDate && a.status !== "completed";
                                    return (
                                      <div
                                        className="absolute h-full rounded-full flex items-center overflow-hidden"
                                        style={{
                                          right: `${sl}%`,
                                          width: `${w}%`,
                                          backgroundColor: barColor,
                                          ...(ongoing ? { borderLeft: "3px solid white" } : {}),
                                        }}
                                        title={`فعلي: ${fmtDate(a.actualStartDate)} → ${a.actualEndDate ? fmtDate(a.actualEndDate) : "جارٍ"} (${a.actualProgress}%)`}
                                      >
                                        {w > 8 && (
                                          <span className="text-[9px] font-bold text-white px-1.5 truncate">
                                            {a.actualProgress}%
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

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
                  <TableHead className="text-right w-[200px]">النشاط</TableHead>
                  <TableHead className="text-right w-[190px]">الفترة المخططة</TableHead>
                  <TableHead className="text-center w-[140px]">التأخر / التقدم</TableHead>
                  <TableHead className="text-center w-[160px]">الإنجاز (مخطط/فعلي)</TableHead>
                  <TableHead className="text-right w-[130px]">الحالة</TableHead>
                  <TableHead className="text-center w-[110px]">إجراءات</TableHead>
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
                    const delayInfo = calcActivityDelay(a);
                    return (
                      <TableRow key={a.id} className={isBusy ? "opacity-60 pointer-events-none" : ""}>
                        {/* Name */}
                        <TableCell className="font-medium max-w-[200px]">
                          <span className="block truncate" title={a.name}>{a.name}</span>
                        </TableCell>

                        {/* Date range */}
                        <TableCell className="w-[190px]">
                          <div className="flex flex-col gap-0.5 font-mono text-xs tabular-nums">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground w-8 shrink-0">بداية</span>
                              <span className="text-foreground">{fmtDate(a.plannedStartDate)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground w-8 shrink-0">نهاية</span>
                              <span className="text-foreground">{fmtDate(a.plannedEndDate)}</span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Delay / Advance */}
                        <TableCell className="text-center">
                          <DelayBadge info={delayInfo} />
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

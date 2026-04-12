import React, { useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { usePageTitle } from "@/hooks/use-page-title";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  useListActivities, 
  useCreateActivity, 
  useUpdateActivity, 
  useDeleteActivity,
  useGetProject,
  getListActivitiesQueryKey,
  useGetMyProjectPermissions,
} from "@workspace/api-client-react";
import type { Activity, ProjectSuspension, UpdateActivityBodyStatus } from "@workspace/api-client-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Plus, Edit2, Trash2, ArrowRight, ChevronDown, ChevronLeft,
  CheckCircle2, Clock, AlertTriangle, PlayCircle, 
  TrendingUp, TrendingDown, Minus, Timer, CalendarCheck, CalendarX, Hourglass,
  Upload, Download, FileSpreadsheet, GripVertical, FolderPlus, Palette, X, Loader2
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

interface ActivityGroup {
  id: number;
  projectId: number;
  name: string;
  color: string;
  sortOrder: number;
}

const GROUP_COLORS = [
  { value: "#3b82f6", label: "أزرق" },
  { value: "#10b981", label: "أخضر" },
  { value: "#f59e0b", label: "برتقالي" },
  { value: "#ef4444", label: "أحمر" },
  { value: "#8b5cf6", label: "بنفسجي" },
  { value: "#ec4899", label: "وردي" },
  { value: "#6b7280", label: "رمادي" },
  { value: "#0891b2", label: "سماوي" },
];

const STATUS_OPTIONS = [
  { value: "not_started",  label: "لم يبدأ",      icon: Clock,         cls: "text-muted-foreground" },
  { value: "in_progress",  label: "قيد التنفيذ",   icon: PlayCircle,    cls: "text-blue-500" },
  { value: "completed",    label: "مكتمل",          icon: CheckCircle2,  cls: "text-emerald-600" },
  { value: "delayed",      label: "متأخر",          icon: AlertTriangle, cls: "text-destructive" },
] as const;

const createActivitySchema = (isNoSchedule: boolean) => z.object({
  name: z.string().min(1, "اسم البند مطلوب"),
  plannedStartDate: isNoSchedule ? z.string().optional().default("") : z.string().min(1, "تاريخ البداية المخطط مطلوب"),
  plannedEndDate: isNoSchedule ? z.string().optional().default("") : z.string().min(1, "تاريخ النهاية المخطط مطلوب"),
  actualStartDate: z.string().optional().nullable(),
  actualEndDate: z.string().optional().nullable(),
  actualProgress: z.coerce.number().min(0).max(100),
  status: z.enum(["not_started", "in_progress", "completed", "delayed"]).default("not_started"),
  sortOrder: z.coerce.number().default(0),
});

function calcPlannedProgress(a: { plannedStartDate?: string | null; plannedEndDate?: string | null }): number {
  if (!a.plannedStartDate || !a.plannedEndDate) return 0;
  const start = new Date(a.plannedStartDate).getTime();
  const end = new Date(a.plannedEndDate).getTime();
  const now = new Date().getTime();
  const duration = end - start;
  if (duration <= 0) return now >= end ? 100 : 0;
  const elapsed = now - start;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 100;
  return Math.round((elapsed / duration) * 100);
}

const activitySchema = createActivitySchema(false);
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
  if (!a.plannedStartDate || !a.plannedEndDate) {
    return { kind: "on_time", days: 0, label: "—" };
  }
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

function SortableActivityRow({ id, children }: { id: number; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <SortableRowContext.Provider value={{ dragRef: setActivatorNodeRef, dragListeners: listeners }}>
      <TableRow ref={setNodeRef} style={style} {...attributes}>
        {children}
      </TableRow>
    </SortableRowContext.Provider>
  );
}

const SortableRowContext = React.createContext<{
  dragRef: ((node: HTMLElement | null) => void) | null;
  dragListeners: Record<string, Function> | undefined;
}>({ dragRef: null, dragListeners: undefined });

function DragHandle() {
  const { dragRef, dragListeners } = React.useContext(SortableRowContext);
  return (
    <span
      ref={dragRef as any}
      {...(dragListeners as any)}
      className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );
}

function SortableGroupRow({ id, children }: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <SortableRowContext.Provider value={{ dragRef: setActivatorNodeRef, dragListeners: listeners }}>
      <TableRow ref={setNodeRef} style={style} {...attributes} className="bg-muted/50 hover:bg-muted/70 cursor-pointer">
        {children}
      </TableRow>
    </SortableRowContext.Provider>
  );
}

export default function ProjectActivities() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const projectId = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageTitle("بنود الأعمال");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number | "ungrouped">>(new Set());

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: activities, isLoading } = useListActivities(projectId, { query: { enabled: !!projectId } });

  const groupsQueryKey = [`/api/projects/${projectId}/activity-groups`];
  const { data: groups = [] } = useQuery<ActivityGroup[]>({
    queryKey: groupsQueryKey,
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/activity-groups`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  const { data: myPermissions } = useGetMyProjectPermissions(projectId, { query: { enabled: !!projectId } });
  const canEditAll = myPermissions?.canEditAll ?? true;
  const assignedGroupIds = myPermissions?.assignedGroupIds ?? [];
  const canEditActivity = useCallback((a: Activity) => {
    if (canEditAll) return true;
    if (assignedGroupIds.length === 0) return true;
    return a.groupId != null && assignedGroupIds.includes(a.groupId);
  }, [canEditAll, assignedGroupIds]);

  const createGroup = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      const r = await authFetch(`/api/projects/${projectId}/activity-groups`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("فشل إنشاء المجموعة");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      setIsGroupDialogOpen(false);
      setNewGroupName("");
      setNewGroupColor("#3b82f6");
      toast({ title: "تم إنشاء المجموعة" });
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: number) => {
      const r = await authFetch(`/api/projects/${projectId}/activity-groups/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("فشل حذف المجموعة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      invalidate();
      toast({ title: "تم حذف المجموعة" });
    },
  });

  const reorderActivities = useMutation({
    mutationFn: async (items: { id: number; sortOrder: number; groupId: number | null }[]) => {
      const r = await authFetch(`/api/projects/${projectId}/activities/reorder`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
      if (!r.ok) throw new Error("فشل إعادة الترتيب");
      return r.json();
    },
    onSuccess: () => invalidate(),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleGroupCollapse = (gid: number | "ungrouped") => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  const assignToGroup = async (activityId: number, groupId: number | null) => {
    setUpdatingId(activityId);
    try {
      await authFetch(`/api/projects/${projectId}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({ groupId }),
      });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "فشل نقل البند" });
    } finally {
      setUpdatingId(null);
    }
  };

  const reorderGroupsMutation = useMutation({
    mutationFn: async (order: number[]) => {
      const r = await authFetch(`/api/projects/${projectId}/activity-groups/reorder`, {
        method: "PUT",
        body: JSON.stringify({ order }),
      });
      if (!r.ok) throw new Error("فشل إعادة ترتيب المجموعات");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupsQueryKey }),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    if (activeStr.startsWith("group-") && overStr.startsWith("group-")) {
      const activeGid = parseInt(activeStr.replace("group-", ""), 10);
      const overGid = parseInt(overStr.replace("group-", ""), 10);
      const sorted = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
      const oldIdx = sorted.findIndex(g => g.id === activeGid);
      const newIdx = sorted.findIndex(g => g.id === overGid);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(sorted, oldIdx, newIdx);
      reorderGroupsMutation.mutate(reordered.map(g => g.id));
      return;
    }

    if (!activities) return;
    const oldIndex = activities.findIndex(a => a.id === active.id);
    const newIndex = activities.findIndex(a => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove([...activities], oldIndex, newIndex);
    const items = reordered.map((a, i) => ({
      id: a.id,
      sortOrder: i,
      groupId: (a as any).groupId ?? null,
    }));
    reorderActivities.mutate(items);
  };
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

  const isNoSchedule = project?.noSchedule === true;
  const currentSchema = useMemo(() => createActivitySchema(isNoSchedule), [isNoSchedule]);

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(currentSchema),
    defaultValues: {
      name: "", plannedStartDate: "", plannedEndDate: "",
      actualStartDate: "", actualEndDate: "",
      actualProgress: 0,
      status: "not_started", sortOrder: 0,
    }
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(projectId) });

  const exportActivities = async () => {
    if (!activities || activities.length === 0) {
      toast({ variant: "destructive", title: "لا توجد بنود للتصدير" });
      return;
    }
    const XLSX = await import("xlsx");
    const statusLabels: Record<string, string> = { not_started: "لم يبدأ", in_progress: "قيد التنفيذ", completed: "مكتمل", delayed: "متأخر" };
    const data = [
      ["اسم البند", "تاريخ البداية المخططة", "تاريخ النهاية المخططة", "البداية الفعلية", "النهاية الفعلية", "الإنجاز المخطط %", "الإنجاز الفعلي %", "الحالة"],
      ...activities.map((a: any) => [
        a.name,
        a.plannedStartDate?.split("T")[0] || "",
        a.plannedEndDate?.split("T")[0] || "",
        a.actualStartDate?.split("T")[0] || "",
        a.actualEndDate?.split("T")[0] || "",
        calcPlannedProgress(a),
        a.actualProgress ?? 0,
        statusLabels[a.status] || a.status,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "بنود الأعمال");
    const projectName = project?.name || "مشروع";
    XLSX.writeFile(wb, `بنود_${projectName}.xlsx`);
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const data = [
      ["اسم البند", "تاريخ البداية", "تاريخ النهاية"],
      ["أعمال الحفر والترابية", "2025-01-15", "2025-03-15"],
      ["أعمال الأساسات", "2025-03-01", "2025-05-30"],
      ["أعمال الهيكل الخرساني", "2025-05-15", "2025-09-30"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, "بنود الأعمال");
    XLSX.writeFile(wb, "قالب_بنود_الأعمال.xlsx");
  };

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/projects/${projectId}/activities/import`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) {
        const errorMsg = result.errors?.length
          ? result.errors.join("\n")
          : result.error || "فشل الاستيراد";
        toast({ variant: "destructive", title: "خطأ في الاستيراد", description: errorMsg });
        return;
      }
      invalidate();
      setIsImportOpen(false);
      setImportFile(null);
      const msg = result.errors?.length
        ? `تم استيراد ${result.imported} بند مع ${result.errors.length} تحذير`
        : `تم استيراد ${result.imported} بند بنجاح`;
      toast({ title: msg });
    } catch {
      toast({ variant: "destructive", title: "فشل الاستيراد" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleEdit = (a: Activity) => {
    setEditingId(a.id);
    form.reset({
      name: a.name,
      plannedStartDate: a.plannedStartDate ? new Date(a.plannedStartDate).toISOString().split('T')[0] : "",
      plannedEndDate: a.plannedEndDate ? new Date(a.plannedEndDate).toISOString().split('T')[0] : "",
      actualStartDate: a.actualStartDate ? new Date(a.actualStartDate).toISOString().split('T')[0] : "",
      actualEndDate: a.actualEndDate ? new Date(a.actualEndDate).toISOString().split('T')[0] : "",
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
      toast({ title: "تم حذف البند" });
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
      await updateActivity.mutateAsync({ projectId, id: a.id, data: { status: newStatus as UpdateActivityBodyStatus, ...extra } });
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
    "المخطط": calcPlannedProgress(a),
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
          const spanMs = ganttEnd.getTime() - ganttStart.getTime() || 86400000;
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
                                {a.plannedStartDate && a.plannedEndDate && (() => {
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
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">بنود الأعمال</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">انقر على الحالة أو نسبة الإنجاز لتحديثها مباشرةً</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs sm:text-sm">
                  <FolderPlus className="h-4 w-4" /> <span className="hidden sm:inline">مجموعة جديدة</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[400px]" dir="rtl">
                <DialogHeader>
                  <DialogTitle>إضافة مجموعة</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">اسم المجموعة</label>
                    <Input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="مثال: الأعمال الخرسانية" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">اللون</label>
                    <div className="flex flex-wrap gap-2">
                      {GROUP_COLORS.map(c => (
                        <button
                          key={c.value}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${newGroupColor === c.value ? "border-foreground scale-110" : "border-transparent"}`}
                          style={{ backgroundColor: c.value }}
                          onClick={() => setNewGroupColor(c.value)}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!newGroupName.trim() || createGroup.isPending}
                    onClick={() => createGroup.mutate({ name: newGroupName.trim(), color: newGroupColor })}
                  >
                    إنشاء المجموعة
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs sm:text-sm" onClick={exportActivities} disabled={!activities || activities.length === 0}>
              <Download className="h-4 w-4" /> <span className="hidden xs:inline">تصدير</span> <span className="hidden sm:inline">Excel</span>
            </Button>
            <Dialog open={isImportOpen} onOpenChange={(open) => {
              setIsImportOpen(open);
              if (!open) setImportFile(null);
            }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs sm:text-sm">
                  <Upload className="h-4 w-4" /> <span className="hidden xs:inline">استيراد</span> <span className="hidden sm:inline">Excel</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px]" dir="rtl">
                <DialogHeader>
                  <DialogTitle>استيراد بنود من ملف Excel</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-center">
                    <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground mb-3">
                      اختر ملف Excel يحتوي على بنود الأعمال
                    </p>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-muted-foreground file:me-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                    />
                    {importFile && (
                      <p className="text-sm text-emerald-600 mt-2">{importFile.name}</p>
                    )}
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-2">
                      يجب أن يحتوي الملف على 3 أعمدة: <strong>اسم البند</strong>، <strong>تاريخ البداية</strong>، <strong>تاريخ النهاية</strong>
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="gap-1 p-0 h-auto text-xs"
                      onClick={downloadTemplate}
                    >
                      <Download className="h-3 w-3" /> تحميل ملف عينة
                    </Button>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => { setIsImportOpen(false); setImportFile(null); }}>
                      إلغاء
                    </Button>
                    <Button onClick={handleImport} disabled={!importFile || isImporting} className="gap-2">
                      {isImporting ? "جاري الاستيراد..." : "استيراد"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) { form.reset(); setEditingId(null); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 text-xs sm:text-sm mr-auto">
                  <Plus className="h-4 w-4" /> إضافة بند
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]" dir="rtl">
                <DialogHeader>
                  <DialogTitle>{editingId ? "تعديل بند" : "بند جديد"}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel>اسم البند</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FormField control={form.control} name="plannedStartDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>بداية مخططة {isNoSchedule && <span className="text-xs text-muted-foreground font-normal">(اختياري)</span>}</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="plannedEndDate" render={({ field }) => (
                        <FormItem>
                          <FormLabel>نهاية مخططة {isNoSchedule && <span className="text-xs text-muted-foreground font-normal">(اختياري)</span>}</FormLabel>
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
            </div>
          </CardHeader>

          {/* Desktop Table */}
          <CardContent className="p-0 overflow-x-auto hidden md:block">
            {(() => {
              const allActs = activities ?? [];
              const groupMap = new Map<number | "ungrouped", (Activity & { groupId?: number | null })[]>();
              const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

              for (const g of sortedGroups) groupMap.set(g.id, []);
              groupMap.set("ungrouped", []);

              for (const a of allActs) {
                const gid = (a as any).groupId ?? "ungrouped";
                if (!groupMap.has(gid)) groupMap.set("ungrouped", [...(groupMap.get("ungrouped") ?? []), a]);
                else groupMap.get(gid)!.push(a);
              }

              const renderActivityRow = (a: Activity) => {
                const isBusy = updatingId === a.id;
                const planned = calcPlannedProgress(a);
                const deviation = a.actualProgress - planned;
                const delayInfo = calcActivityDelay(a);
                const editable = canEditActivity(a);
                return (
                  <SortableActivityRow key={a.id} id={a.id}>
                    <TableCell className="font-medium max-w-[200px]">
                      <div className="flex items-center gap-1">
                        <DragHandle />
                        <span className="block truncate" title={a.name}>{a.name}</span>
                      </div>
                    </TableCell>
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
                    <TableCell className="text-center">
                      <DelayBadge info={delayInfo} />
                    </TableCell>
                    <TableCell className="w-[160px]">
                      <div className="space-y-1">
                        <ProgressBar value={planned} color="hsl(var(--muted-foreground)/0.4)" />
                        <ProgressBar value={a.actualProgress} color="hsl(var(--primary))" />
                        <div className={`text-xs flex items-center gap-0.5 justify-end ${deviation < 0 ? 'text-destructive' : deviation > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {deviation < 0 ? <TrendingDown className="h-3 w-3" /> : deviation > 0 ? <TrendingUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                          {deviation > 0 ? '+' : ''}{deviation}%
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {editable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent transition-colors text-sm">
                              <StatusBadge status={a.status} />
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
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
                      ) : (
                        <StatusBadge status={a.status} />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        {editable ? (
                          <>
                            <Button variant="outline" size="icon" className="h-7 w-7" title="تخفيض الإنجاز 10%" onClick={() => quickIncrement(a, -10)} disabled={a.actualProgress === 0}>
                              <span className="text-xs font-bold text-muted-foreground">-10</span>
                            </Button>
                            <Button variant="outline" size="icon" className="h-7 w-7" title="رفع الإنجاز 10%" onClick={() => quickIncrement(a, 10)} disabled={a.actualProgress === 100}>
                              <span className="text-xs font-bold text-primary">+10</span>
                            </Button>
                            {groups.length > 0 && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuLabel className="text-xs text-muted-foreground">نقل إلى مجموعة</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => assignToGroup(a.id, null)}>
                                    <span className="text-muted-foreground">بدون مجموعة</span>
                                  </DropdownMenuItem>
                                  {groups.map(g => (
                                    <DropdownMenuItem key={g.id} onClick={() => assignToGroup(a.id, g.id)}>
                                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0 ml-2" style={{ backgroundColor: g.color }} />
                                      {g.name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(a)}>
                              <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(a.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">عرض فقط</span>
                        )}
                      </div>
                    </TableCell>
                  </SortableActivityRow>
                );
              };

              return (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right w-[220px]">البند</TableHead>
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
                          <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                              <span className="text-sm">جاري تحميل بنود الأعمال...</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : allActs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">لا يوجد بنود — أضف أول بند</TableCell>
                        </TableRow>
                      ) : groups.length === 0 ? (
                        <SortableContext items={allActs.map(a => a.id)} strategy={verticalListSortingStrategy}>
                          {allActs.map(renderActivityRow)}
                        </SortableContext>
                      ) : (
                        <SortableContext items={[...sortedGroups.map(g => `group-${g.id}`), ...allActs.map(a => a.id)]} strategy={verticalListSortingStrategy}>
                          {sortedGroups.map(g => {
                            const groupActs = groupMap.get(g.id) ?? [];
                            const isCollapsed = collapsedGroups.has(g.id);
                            const groupProgress = groupActs.length > 0
                              ? Math.round(groupActs.reduce((s, a) => s + a.actualProgress, 0) / groupActs.length)
                              : 0;
                            return (
                              <React.Fragment key={g.id}>
                                <SortableGroupRow id={`group-${g.id}`}>
                                  <TableCell colSpan={4} onClick={() => toggleGroupCollapse(g.id)}>
                                    <div className="flex items-center gap-2">
                                      <DragHandle />
                                      {isCollapsed ? <ChevronLeft className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                      <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                                      <span className="font-semibold text-sm">{g.name}</span>
                                      <span className="text-xs text-muted-foreground">({groupActs.length} بند)</span>
                                      <span className="text-xs text-muted-foreground mr-2">{groupProgress}%</span>
                                    </div>
                                  </TableCell>
                                  <TableCell colSpan={2}>
                                    <div className="flex items-center justify-end gap-1">
                                      <div className="flex-1 max-w-[80px]">
                                        <ProgressBar value={groupProgress} color={g.color} />
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => { e.stopPropagation(); deleteGroup.mutate(g.id); }}
                                      >
                                        <X className="h-3 w-3 text-muted-foreground" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </SortableGroupRow>
                                {!isCollapsed && groupActs.map(renderActivityRow)}
                              </React.Fragment>
                            );
                          })}
                          {(() => {
                            const ungrouped = groupMap.get("ungrouped") ?? [];
                            if (ungrouped.length === 0) return null;
                            const isCollapsed = collapsedGroups.has("ungrouped");
                            return (
                              <>
                                {groups.length > 0 && (
                                  <TableRow className="bg-muted/30 hover:bg-muted/50 cursor-pointer" onClick={() => toggleGroupCollapse("ungrouped")}>
                                    <TableCell colSpan={6}>
                                      <div className="flex items-center gap-2">
                                        {isCollapsed ? <ChevronLeft className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                        <span className="font-semibold text-sm text-muted-foreground">بدون مجموعة</span>
                                        <span className="text-xs text-muted-foreground">({ungrouped.length} بند)</span>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                )}
                                {!isCollapsed && ungrouped.map(renderActivityRow)}
                              </>
                            );
                          })()}
                        </SortableContext>
                      )}
                    </TableBody>
                  </Table>
                </DndContext>
              );
            })()}
          </CardContent>

          {/* Mobile Card View */}
          <CardContent className="md:hidden space-y-3 px-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                <span className="text-sm text-muted-foreground">جاري تحميل بنود الأعمال...</span>
              </div>
            ) : (activities ?? []).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">لا يوجد بنود — أضف أول بند</div>
            ) : (() => {
              const allActs = activities ?? [];
              const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
              const groupMap = new Map<number | "ungrouped", Activity[]>();
              for (const g of sortedGroups) groupMap.set(g.id, []);
              groupMap.set("ungrouped", []);
              for (const a of allActs) {
                const gid = (a as any).groupId ?? "ungrouped";
                if (!groupMap.has(gid)) groupMap.get("ungrouped")!.push(a);
                else groupMap.get(gid)!.push(a);
              }

              const renderMobileCard = (a: Activity) => {
                const isBusy = updatingId === a.id;
                const planned = calcPlannedProgress(a);
                const deviation = a.actualProgress - planned;
                const delayInfo = calcActivityDelay(a);
                const editable = canEditActivity(a);
                return (
                  <div key={a.id} className={`rounded-lg border p-3 space-y-2.5 ${isBusy ? "opacity-60 pointer-events-none" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-tight flex-1">{a.name}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{fmtDate(a.plannedStartDate)} → {fmtDate(a.plannedEndDate)}</span>
                      <DelayBadge info={delayInfo} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">مخطط {planned}%</span>
                        <span className="text-muted-foreground">فعلي {a.actualProgress}%</span>
                        <span className={deviation < 0 ? 'text-destructive font-medium' : deviation > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                          {deviation > 0 ? '+' : ''}{deviation}%
                        </span>
                      </div>
                      <ProgressBar value={a.actualProgress} color="hsl(var(--primary))" />
                    </div>
                    {editable ? (
                      <div className="flex items-center gap-1 pt-1 border-t">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
                              تغيير الحالة <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">تغيير الحالة</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {STATUS_OPTIONS.map(opt => {
                              const Icon = opt.icon;
                              return (
                                <DropdownMenuItem key={opt.value} className={`gap-2 ${opt.cls} ${a.status === opt.value ? 'font-bold bg-accent' : ''}`} onClick={() => quickUpdateStatus(a, opt.value)}>
                                  <Icon className="h-4 w-4" /> {opt.label}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="flex items-center gap-1 mr-auto">
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => quickIncrement(a, -10)} disabled={a.actualProgress === 0}>
                            <span className="text-xs font-bold text-muted-foreground">-10</span>
                          </Button>
                          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => quickIncrement(a, 10)} disabled={a.actualProgress === 100}>
                            <span className="text-xs font-bold text-primary">+10</span>
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(a)}>
                            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeletingId(a.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-1 border-t">
                        <span className="text-xs text-muted-foreground">عرض فقط</span>
                      </div>
                    )}
                  </div>
                );
              };

              if (groups.length === 0) return allActs.map(renderMobileCard);

              return (
                <>
                  {sortedGroups.map((g, gi) => {
                    const groupActs = groupMap.get(g.id) ?? [];
                    const isCollapsed = collapsedGroups.has(g.id);
                    const groupProgress = groupActs.length > 0
                      ? Math.round(groupActs.reduce((s, a) => s + a.actualProgress, 0) / groupActs.length)
                      : 0;
                    const moveGroup = (dir: -1 | 1) => {
                      const newIdx = gi + dir;
                      if (newIdx < 0 || newIdx >= sortedGroups.length) return;
                      const reordered = arrayMove([...sortedGroups], gi, newIdx);
                      reorderGroupsMutation.mutate(reordered.map(x => x.id));
                    };
                    return (
                      <div key={g.id}>
                        <div
                          className="flex items-center gap-1.5 rounded-lg p-2.5 mb-2 transition-colors"
                          style={{ backgroundColor: `${g.color}15`, borderRight: `3px solid ${g.color}` }}
                        >
                          <div className="flex flex-col gap-0.5">
                            <button
                              className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                              disabled={gi === 0}
                              onClick={() => moveGroup(-1)}
                            >
                              <ChevronDown className="h-3 w-3 rotate-180" />
                            </button>
                            <button
                              className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                              disabled={gi === sortedGroups.length - 1}
                              onClick={() => moveGroup(1)}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </div>
                          <button
                            className="flex items-center gap-2 flex-1 min-w-0"
                            onClick={() => toggleGroupCollapse(g.id)}
                          >
                            {isCollapsed ? <ChevronLeft className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                            <span className="font-semibold text-sm flex-1 text-right truncate">{g.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">{groupActs.length} بند</span>
                            <span className="text-xs font-medium shrink-0">{groupProgress}%</span>
                          </button>
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-2 mb-3">
                            {groupActs.map(renderMobileCard)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(() => {
                    const ungrouped = groupMap.get("ungrouped") ?? [];
                    if (ungrouped.length === 0) return null;
                    const isCollapsed = collapsedGroups.has("ungrouped");
                    return (
                      <div>
                        <button
                          className="w-full flex items-center gap-2 rounded-lg p-2.5 mb-2 bg-muted/30"
                          onClick={() => toggleGroupCollapse("ungrouped")}
                        >
                          {isCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          <span className="font-semibold text-sm flex-1 text-right text-muted-foreground">بدون مجموعة</span>
                          <span className="text-xs text-muted-foreground">{ungrouped.length} بند</span>
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-2 mb-3">
                            {ungrouped.map(renderMobileCard)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirm */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذا البند؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
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

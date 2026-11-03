import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  getGetProjectSummaryQueryKey,
  fetchWithSession,
} from "@workspace/api-client-react";
import { useTabAccess, useMyProjectPermissions } from "@/hooks/use-tab-access";
import type { Activity, ProjectSuspension, UpdateActivityBodyStatus } from "@workspace/api-client-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
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
import { formatDisplayPercent } from "@/lib/format-display-percent";
import { applyActivityOrder, planActivityReorder } from "@/lib/activity-order";
import { getAuthSessionSnapshot, isSameAuthSession } from "@/lib/auth-session";
import { ActivityGroupOrganizer, type ActivityGroupCategory, type CategoryFilter } from "@/components/activity-group-organizer";
import { groupsForCategory, activityMatchesCategory } from "@/lib/activity-category-filter";
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
import { useAuth } from "@/hooks/use-auth";
import { ActivityGroupSideProjectSync } from "@/components/activity-group-side-project-sync";
import { ActivityProgressDialog } from "@/components/activity-progress-dialog";
import { ActivityWeightDialog } from "@/components/activity-weight-dialog";

import { 
  Plus, Edit2, Trash2, ArrowRight, ChevronDown, ChevronLeft,
  CheckCircle2, Clock, AlertTriangle, PlayCircle, 
  TrendingUp, TrendingDown, Minus, Timer, ListChecks, CalendarCheck, CalendarX, Hourglass,
  Upload, Download, FileSpreadsheet, GripVertical, FolderPlus, Palette, X, Loader2,
  Search, LayoutList, GanttChart, SlidersHorizontal, Link2, Percent, Scale
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

interface ActivityGroup {
  id: number;
  projectId: number;
  name: string;
  color: string;
  sortOrder: number;
  categoryId?: number | null;
  linkCode?: string | null;
  linkedProjectActive?: boolean;
}

type ImportMode = "detect" | "existing" | "none";
type ImportChoice = { action: "new" | "existing"; groupId?: number };
interface ImportPreview {
  previewId: string;
  rows: Array<{
    rowNumber: number;
    kind: "group" | "activity" | "error";
    name: string;
    groupRow?: number | null;
    plannedStartDate?: string;
    plannedEndDate?: string;
    error?: string;
  }>;
  groups: Array<{
    rowNumber: number;
    name: string;
    matches: Array<{ id: number; name: string }>;
  }>;
  counts: { activities: number; rejected: number };
}
interface ImportResult {
  imported: number;
  groupsCreated: number;
  groupsUsed: number;
  rejected: number;
  errors?: string[];
  warnings?: string[];
}

interface ExternalSource {
  available: boolean;
  groupId?: number;
  projectId?: number;
  projectName?: string;
  groupName?: string;
  linkCode?: string;
  actualProgress?: number;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}

interface GroupSearchResult {
  groupId: number;
  projectId: number;
  projectName: string;
  groupName: string;
  linkCode: string;
  actualProgress?: number;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}

interface SourceSelection extends ExternalSource {
  available: boolean;
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
  weight: z.coerce.number().min(0.01, "الوزن يجب أن يكون أكبر من صفر").max(100, "الوزن لا يتجاوز 100").default(1),
  status: z.enum(["not_started", "in_progress", "completed", "delayed"]).default("not_started"),
  sortOrder: z.coerce.number().default(0),
});

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
  const startOfDay = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const plannedEnd = startOfDay(a.plannedEndDate);
  const plannedStart = startOfDay(a.plannedStartDate);
  const diffDays = (aDate: Date, bDate: Date) => Math.round((aDate.getTime() - bDate.getTime()) / 86400000);

  // A completed activity is late when it finished after the planned end.
  // If no actual end was saved, today's date is used as a conservative fallback;
  // this also catches completed activities whose planned end is already past.
  if (a.status === "completed") {
    if (!plannedEnd) return { kind: "on_time", days: 0, label: "—" };
    const refDate = startOfDay(a.actualEndDate) ?? today;
    const d = diffDays(refDate, plannedEnd);
    if (d > 0) return { kind: "delayed", days: d, label: `متأخر ${d} يوم` };
    if (d < 0) return { kind: "early", days: -d, label: `مبكر ${-d} يوم` };
    return { kind: "on_time", days: 0, label: "في الموعد" };
  }

  if (a.status === "not_started") {
    if (!plannedStart) return { kind: "on_time", days: 0, label: "—" };
    const d = diffDays(today, plannedStart);
    if (d > 0) return { kind: "late_start", days: d, label: `تأخر البدء ${d} يوم` };
    return { kind: "remaining", days: -d, label: `${-d} يوم للبدء` };
  }

  // in_progress or explicitly delayed: compare the current day with planned end.
  if (!plannedEnd) return { kind: "on_time", days: 0, label: "—" };
  const d = diffDays(today, plannedEnd);
  if (d > 0) return { kind: "delayed", days: d, label: `متأخر ${d} يوم` };
  if (d === 0) return { kind: "on_time", days: 0, label: "آخر يوم مخطط" };
  return { kind: "remaining", days: -d, label: `${-d} يوم متبقٍ` };
}

function isActivityDelayed(a: Activity): boolean {
  // Keep an explicitly saved delayed status visible even when the schedule is incomplete.
  if (a.status === "delayed") return true;
  const delay = calcActivityDelay(a);
  return delay.kind === "delayed" || delay.kind === "late_start";
}

function isActivelyManagedActivity(
  activity: Activity,
  groups: { id: number; linkedProjectActive?: boolean }[],
): boolean {
  const managedByGroupId = (activity as Activity & { managedByGroupId?: number | null }).managedByGroupId;
  return managedByGroupId != null
    && groups.some((group) => group.id === managedByGroupId && group.linkedProjectActive === true);
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
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span dir="ltr" className="w-12 shrink-0 whitespace-nowrap text-right text-xs tabular-nums">{formatDisplayPercent(value)}</span>
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
    <SortableRowContext.Provider value={{ dragRef: setActivatorNodeRef, dragListeners: listeners, dragAttributes: attributes }}>
      <TableRow ref={setNodeRef} style={style}>
        {children}
      </TableRow>
    </SortableRowContext.Provider>
  );
}

const SortableRowContext = React.createContext<{
  dragRef: ((node: HTMLElement | null) => void) | null;
  dragListeners: Record<string, Function> | undefined;
  dragAttributes?: DraggableAttributes;
}>({ dragRef: null, dragListeners: undefined });

function DragHandle() {
  const { dragRef, dragListeners, dragAttributes } = React.useContext(SortableRowContext);
  return (
    <button
      type="button"
      ref={dragRef as any}
      {...dragAttributes}
      {...(dragListeners as any)}
      aria-label="سحب لتغيير الترتيب"
      disabled={dragAttributes?.["aria-disabled"] === true}
      onClick={event => event.stopPropagation()}
      className="cursor-grab active:cursor-grabbing disabled:cursor-wait disabled:opacity-50 text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
    >
      <GripVertical className="h-4 w-4" />
    </button>
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
    <SortableRowContext.Provider value={{ dragRef: setActivatorNodeRef, dragListeners: listeners, dragAttributes: attributes }}>
      <TableRow ref={setNodeRef} style={style} className="bg-muted/50 hover:bg-muted/70 cursor-pointer">
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
  const { user } = useAuth();
  const isContractorBase = user?.role === "contractor" || user?.isContractorCompanyUser === true;
  const queryClient = useQueryClient();
  usePageTitle("بنود الأعمال");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingManagedRow, setEditingManagedRow] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [progressActivity, setProgressActivity] = useState<Activity | null>(null);
  const [weightActivity, setWeightActivity] = useState<Activity | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("detect");
  const [importGroupId, setImportGroupId] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importChoices, setImportChoices] = useState<Record<string, ImportChoice>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const importRequestId = useRef(0);
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#3b82f6");
  const [newGroupLinkCode, setNewGroupLinkCode] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ActivityGroup | null>(null);
  const [sourceCode, setSourceCode] = useState("");
  const [selectedSource, setSelectedSource] = useState<SourceSelection | null>(null);
  const [sourceTouched, setSourceTouched] = useState(false);
  const [sourceUnlinkRequested, setSourceUnlinkRequested] = useState(false);
  const [editingRedactedSource, setEditingRedactedSource] = useState(false);
  const [sourceSearchTerm, setSourceSearchTerm] = useState("");
  const [sourceSearchResults, setSourceSearchResults] = useState<GroupSearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState("");
  const [sourceSearchResolvedTerm, setSourceSearchResolvedTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number | "ungrouped">>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "gantt">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "not_started" | "in_progress" | "completed" | "delayed">("all");
  const [groupFilter, setGroupFilter] = useState<"all" | "ungrouped" | number>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const orderInFlight = useRef(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: activities, isLoading, isFetching, isError: activitiesError, refetch: refetchActivities } = useListActivities(projectId, { query: { enabled: !!projectId } });

  const groupsQueryKey = [`/api/projects/${projectId}/activity-groups`];
  const { data: groups = [], isLoading: groupsLoading, isError: groupsError, refetch: refetchGroups } = useQuery<ActivityGroup[]>({
    queryKey: groupsQueryKey,
    queryFn: async ({ signal }) => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups`, { signal });
      if (!r.ok) throw Object.assign(new Error("تعذر تحميل المجموعات"), { status: r.status });
      return r.json();
    },
    enabled: !!projectId,
  });
  const categoriesQueryKey = [`/api/projects/${projectId}/activity-group-categories`];
  const { data: categories = [], isLoading: categoriesLoading, isError: categoriesError, refetch: refetchCategories } = useQuery<ActivityGroupCategory[]>({
    queryKey: categoriesQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetchWithSession(`/api/projects/${projectId}/activity-group-categories`, { signal });
      if (!response.ok) throw Object.assign(new Error("تعذر تحميل المجموعات الرئيسية"), { status: response.status });
      return response.json();
    },
    enabled: !!projectId,
  });
  const categoryGroups = useMemo(() => groupsForCategory(groups, categoryFilter), [groups, categoryFilter]);
  const categoryGroupIds = useMemo(() => new Set(categoryGroups.map(group => group.id)), [categoryGroups]);
  useEffect(() => { setCategoryFilter("all"); setGroupFilter("all"); }, [projectId]);
  useEffect(() => {
    if (!categoriesLoading && !categoriesError && typeof categoryFilter === "number"
      && !categories.some(category => category.id === categoryFilter)) {
      setCategoryFilter("all");
      setGroupFilter("all");
    }
  }, [categories, categoriesLoading, categoriesError, categoryFilter]);

  useEffect(() => {
    const query = sourceSearchTerm.trim();
    if (query.length < 1) {
      setSourceSearchResults([]);
      setSourceSearchLoading(false);
      setSourceSearchResolvedTerm("");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSourceSearchLoading(true);
      setSourceSearchError("");
      setSourceSearchResolvedTerm("");
      try {
        const response = await fetchWithSession(
          `/api/projects/${projectId}/activity-groups/search?query=${encodeURIComponent(query)}`, { signal: controller.signal }
        );
        if (!response.ok) throw new Error("تعذر البحث عن رمز المجموعة");
        const results = await response.json() as GroupSearchResult[];
        if (!cancelled) {
          setSourceSearchResults(results.filter((group) => group.projectId !== projectId));
          setSourceSearchResolvedTerm(query.toLocaleLowerCase());
        }
      } catch {
        if (!cancelled) {
          setSourceSearchResolvedTerm("");
          setSourceSearchError("تعذر البحث عن رمز المجموعة");
        }
      } finally {
        if (!cancelled) setSourceSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [projectId, sourceSearchTerm]);

  useEffect(() => {
    const normalizedCode = sourceCode.trim().toLocaleLowerCase();
    if (!sourceTouched || !normalizedCode || sourceSearchResolvedTerm !== normalizedCode) return;
    const exactMatches = sourceSearchResults.filter(
      (group) => group.linkCode.trim().toLocaleLowerCase() === normalizedCode
    );
    if (exactMatches.length !== 1) return;
    const result = exactMatches[0];
    setSelectedSource({
      available: true,
      groupId: result.groupId,
      projectId: result.projectId,
      projectName: result.projectName,
      groupName: result.groupName,
      linkCode: result.linkCode,
      actualProgress: result.actualProgress,
      plannedStartDate: result.plannedStartDate,
      plannedEndDate: result.plannedEndDate,
    });
    setSourceUnlinkRequested(false);
  }, [sourceCode, sourceSearchResolvedTerm, sourceSearchResults, sourceTouched]);

  const { data: myPermissions } = useMyProjectPermissions(projectId);
  const { canEdit: canEditActivities, isHidden } = useTabAccess(projectId, "activities", { redirectIfHidden: true });
  const canEditAll = canEditActivities && (myPermissions?.canEditAll ?? true);
  const assignedGroupIds = myPermissions?.assignedGroupIds ?? [];
  const isViewer = !canEditActivities;
  const canEditActivity = useCallback((a: Activity) => {
    if (isViewer) return false;
    if (canEditAll) return true;
    if (assignedGroupIds.length === 0) return true;
    return a.groupId != null && assignedGroupIds.includes(a.groupId);
  }, [canEditAll, assignedGroupIds, isViewer]);

  const createGroup = useMutation({
    mutationFn: async (data: { name: string; color: string; linkCode: string | null }) => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups`, {
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
      setNewGroupLinkCode("");
      toast({ title: "تم إنشاء المجموعة" });
    },
  });

  const updateGroup = useMutation({
    mutationFn: async (data: { id: number; name: string; color: string; linkCode: string | null }) => {
      const { id, ...body } = data;
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const response = await r.json().catch(() => null);
        throw new Error(response?.error ?? "فشل تحديث المجموعة");
      }
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      setIsGroupDialogOpen(false);
      setEditingGroupId(null);
      toast({ title: "تم تحديث المجموعة" });
    },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const response = await r.json().catch(() => null);
        throw new Error(response?.error ?? "فشل حذف المجموعة");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      invalidate();
      setGroupFilter("all");
      setDeletingGroup(null);
      toast({ title: "تم حذف المجموعة" });
    },
    onError: (error: Error) => {
      invalidate();
      toast({ variant: "destructive", title: error.message });
    },
  });

  const reorderActivities = useMutation({
    mutationFn: async (items: { id: number; sortOrder: number; groupId?: number | null }[]) => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activities/reorder`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error ?? "فشل إعادة الترتيب");
      }
      return r.json();
    },
    onMutate: async items => {
      const queryKey = getListActivitiesQueryKey(projectId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Activity[]>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, applyActivityOrder(previous, items));
      return { previous, queryKey, projectId, session: getAuthSessionSnapshot() };
    },
    onError: (error: Error, _items, context) => {
      if (context && !isSameAuthSession(context.session, getAuthSessionSnapshot())) return;
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      toast({ variant: "destructive", title: "تعذّر تأكيد حفظ الترتيب", description: `${error.message}. ستُراجع القائمة من الخادم؛ لا تكرر العملية قبل اكتمال التحقق.` });
    },
    onSettled: async (_data, _error, _items, context) => {
      try {
        if (context && !isSameAuthSession(context.session, getAuthSessionSnapshot())) return;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: context?.queryKey ?? getListActivitiesQueryKey(projectId) }),
          queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(context?.projectId ?? projectId) }),
        ]);
      } finally { orderInFlight.current = false; }
    },
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
    const targetActivity = activities?.find((activity) => activity.id === activityId);
    if (targetActivity && isActivelyManagedActivity(targetActivity, groups)) return;
    setUpdatingId(activityId);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({ groupId }),
      });
      if (!response.ok) throw new Error(`Update failed with HTTP ${response.status}`);
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "فشل نقل البند" });
    } finally {
      setUpdatingId(null);
    }
  };

  const reorderGroupsMutation = useMutation({
    mutationFn: async (order: number[]) => {
      const r = await fetchWithSession(`/api/projects/${projectId}/activity-groups/reorder`, {
        method: "PUT",
        body: JSON.stringify({ order }),
      });
      if (!r.ok) throw new Error("فشل إعادة ترتيب المجموعات");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupsQueryKey }),
    onSettled: () => { orderInFlight.current = false; },
    onError: (error: Error) => toast({ variant: "destructive", title: error.message }),
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (orderInFlight.current || reorderActivities.isPending || reorderGroupsMutation.isPending) return;

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
      orderInFlight.current = true;
      reorderGroupsMutation.mutate(reordered.map(g => g.id));
      return;
    }

    if (!activities) return;
    const items = planActivityReorder(activities, activityRows.map(row => row.id), Number(active.id), Number(over.id));
    if (items.length) { orderInFlight.current = true; reorderActivities.mutate(items); }
  };
  const { data: suspensions = [] } = useQuery<ProjectSuspension[]>({
    queryKey: [`/api/projects/${projectId}/suspensions`],
    queryFn: async () => {
      const r = await fetchWithSession(`/api/projects/${projectId}/suspensions`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });
  
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();

  const isNoSchedule = project?.noSchedule === true;
  const isLinkedSource = !sourceUnlinkRequested &&
    (!!selectedSource || (sourceTouched && !!sourceCode.trim()));
  const currentSchema = useMemo(
    () => createActivitySchema(isNoSchedule || isLinkedSource || editingManagedRow),
    [isNoSchedule, isLinkedSource, editingManagedRow],
  );

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(currentSchema),
    defaultValues: {
      name: "", plannedStartDate: "", plannedEndDate: "",
      actualStartDate: "", actualEndDate: "",
      actualProgress: 0,
      weight: 1,
      status: "not_started", sortOrder: 0,
    }
  });
  const hasMatchingSelectedSource = !!selectedSource &&
    (!sourceTouched || sourceCode.trim().toLocaleLowerCase() === (selectedSource.linkCode ?? "").trim().toLocaleLowerCase());
  const externalSourceId = selectedSource?.groupId ?? null;

  const resetExternalSource = () => {
    setEditingRedactedSource(false);
    setSourceCode("");
    setSelectedSource(null);
    setSourceTouched(false);
    setSourceUnlinkRequested(false);
    setSourceSearchTerm("");
    setSourceSearchResults([]);
    setSourceSearchError("");
    setSourceSearchResolvedTerm("");
  };

  const openNewGroupDialog = () => {
    setEditingGroupId(null);
    setNewGroupName("");
    setNewGroupColor("#3b82f6");
    setNewGroupLinkCode("");
    setIsGroupDialogOpen(true);
  };

  const openEditGroupDialog = (group: ActivityGroup) => {
    setEditingGroupId(group.id);
    setNewGroupName(group.name);
    setNewGroupColor(group.color);
    setNewGroupLinkCode(group.linkCode ?? "");
    setIsGroupDialogOpen(true);
  };

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`], exact: true }),
  ]);

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
        a.plannedProgress ?? 0,
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
    const data = importMode === "detect" ? [
      ["اسم البند", "تاريخ البداية", "تاريخ النهاية", "النوع"],
      ["أعمال الموقع", "", "", "مجموعة"],
      ["أعمال الحفر والترابية", "2025-01-15", "2025-03-15", "نشاط"],
      ["أعمال الأساسات", "2025-03-01", "2025-05-30", "نشاط"],
      ["الأعمال الإنشائية", "", "", "مجموعة"],
      ["أعمال الهيكل الخرساني", "2025-05-15", "2025-09-30", "نشاط"],
    ] : [
      ["اسم البند", "تاريخ البداية", "تاريخ النهاية"],
      ["أعمال الحفر والترابية", "2025-01-15", "2025-03-15"],
      ["أعمال الأساسات", "2025-03-01", "2025-05-30"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "بنود الأعمال");
    XLSX.writeFile(wb, "قالب_بنود_الأعمال.xlsx");
  };

  const clearImportPreview = () => {
    importRequestId.current += 1;
    setImportPreview(null);
    setImportChoices({});
    setImportResult(null);
    setImportError("");
    setIsImporting(false);
  };

  const resetImport = () => {
    clearImportPreview();
    setImportFile(null);
    setImportMode("detect");
    setImportGroupId(null);
  };

  const readImportError = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null);
    return body?.errors?.length ? body.errors.join("، ") : body?.error || fallback;
  };

  const handleImportPreview = async () => {
    if (!importFile || (importMode === "existing" && importGroupId == null)) return;
    clearImportPreview();
    const requestId = importRequestId.current;
    if (importFile.size > 5 * 1024 * 1024) {
      setImportError("حجم الملف يتجاوز 5 ميغابايت. اختر ملفاً أصغر.");
      return;
    }
    setIsImporting(true);
    try {
      const bytes = new Uint8Array(await importFile.arrayBuffer());
      // Convert in chunks; spreading the entire file into String.fromCharCode overflows the stack.
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
      }
      if (requestId !== importRequestId.current) return;
      const res = await fetchWithSession(`/api/projects/${projectId}/activities/import/preview`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          fileBase64: btoa(chunks.join("")),
          mode: importMode,
          ...(importMode === "existing" ? { groupId: importGroupId } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readImportError(res, "تعذر معاينة الملف"));
      const preview = await res.json() as ImportPreview;
      if (requestId !== importRequestId.current) return;
      setImportPreview(preview);
      const defaults: Record<string, ImportChoice> = {};
      preview.groups.forEach(group => {
        if (group.matches.length === 1) defaults[String(group.rowNumber)] = { action: "existing", groupId: group.matches[0].id };
        if (group.matches.length === 0) defaults[String(group.rowNumber)] = { action: "new" };
      });
      setImportChoices(defaults);
    } catch (error) {
      if (requestId === importRequestId.current) setImportError(error instanceof Error ? error.message : "تعذر معاينة الملف");
    } finally {
      if (requestId === importRequestId.current) setIsImporting(false);
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview || isImporting || importResult || importPreview.counts.activities < 1 ||
      importPreview.groups.some(group => importPreview.rows.some(row => row.kind === "activity" && row.groupRow === group.rowNumber) && !importChoices[String(group.rowNumber)])) return;
    const requestId = importRequestId.current;
    setIsImporting(true);
    setImportError("");
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/activities/import/confirm`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ previewId: importPreview.previewId, choices: importChoices }),
      });
      if (!response.ok) throw new Error(await readImportError(response, "تعذر حفظ البنود"));
      const result = await response.json() as ImportResult;
      if (requestId !== importRequestId.current) return;
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      invalidate();
    } catch (error) {
      if (requestId === importRequestId.current) setImportError(error instanceof Error ? error.message : "تعذر حفظ البنود");
    } finally {
      if (requestId === importRequestId.current) setIsImporting(false);
    }
  };

  const handleEdit = (a: Activity) => {
    setEditingId(a.id);
    setEditingManagedRow(isActivelyManagedActivity(a, groups));
    const linked = a as Activity & { externalSourceGroupId?: number | null; externalSource?: ExternalSource | null };
    setEditingRedactedSource(linked.externalSource != null && linked.externalSourceGroupId == null);
    if (linked.externalSourceGroupId != null || linked.externalSource != null) {
      const source: SourceSelection = linked.externalSource ?? { available: false, groupId: linked.externalSourceGroupId ?? undefined };
      setSelectedSource(source);
      // A redacted source supplies display-only metadata, never a usable source ID or code.
      setSourceCode(linked.externalSourceGroupId != null ? source.linkCode ?? "" : "");
      setSourceTouched(false);
      setSourceUnlinkRequested(false);
      setSourceSearchTerm("");
      setSourceSearchResults([]);
      setSourceSearchResolvedTerm("");
    } else {
      resetExternalSource();
    }
    form.reset({
      name: a.name,
      plannedStartDate: a.plannedStartDate ? new Date(a.plannedStartDate).toISOString().split('T')[0] : "",
      plannedEndDate: a.plannedEndDate ? new Date(a.plannedEndDate).toISOString().split('T')[0] : "",
      actualStartDate: a.actualStartDate ? new Date(a.actualStartDate).toISOString().split('T')[0] : "",
      actualEndDate: a.actualEndDate ? new Date(a.actualEndDate).toISOString().split('T')[0] : "",
      actualProgress: a.actualProgress,
      weight: a.weight ?? 1,
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
    if (isActivelyManagedActivity(a, groups) || a.status === newStatus) return;
    setUpdatingId(a.id);
    try {
      const extra: Record<string, unknown> = {};
      if (!getLinkedSource(a)) {
        if (newStatus === "completed") extra.actualProgress = 100;
        if (newStatus === "not_started") extra.actualProgress = 0;
      }
      await updateActivity.mutateAsync({ projectId, id: a.id, data: { status: newStatus as UpdateActivityBodyStatus, ...extra } });
      invalidate();
      toast({ title: "تم تحديث الحالة" });
    } catch {
      toast({ variant: "destructive", title: "فشل التحديث" });
    } finally {
      setUpdatingId(null);
    }
  };

  /* ── Shared direct / incremental progress update ── */
  const setActivityProgress = async (a: Activity, next: number): Promise<boolean> => {
    if (!canEditActivity(a) || isActivelyManagedActivity(a, groups) || getLinkedSource(a)) return false;
    if (!Number.isFinite(next) || next < 0 || next > 100 || updatingId !== null) return false;
    if (next === a.actualProgress) return true;
    setUpdatingId(a.id);
    try {
      const autoStatus = next === 100 ? "completed" : next === 0 ? "not_started" : "in_progress";
      await updateActivity.mutateAsync({
        projectId, id: a.id,
        data: { actualProgress: next, status: autoStatus }
      });
      await invalidate();
      return true;
    } catch {
      toast({ variant: "destructive", title: "فشل التحديث" });
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const quickIncrement = async (a: Activity, delta: number) => {
    await setActivityProgress(a, Math.min(100, Math.max(0, a.actualProgress + delta)));
  };

  const renderProgressButton = (a: Activity, mobile = false) => {
    const linked = Boolean(getLinkedSource(a)) || isActivelyManagedActivity(a, groups);
    const editable = canEditActivity(a);
    const hint = linked
      ? "نسبة هذا البند محسوبة من المصدر المرتبط؛ تُعدّل من المصدر"
      : !editable ? "لا تملك صلاحية تعديل نسبة إنجاز هذا البند" : "تحديد نسبة الإنجاز";
    return (
      <span title={hint}>
        <Button
          variant="outline"
          size="icon"
          className={mobile ? "h-10 w-10" : "h-7 w-7"}
          aria-label={`تحديد نسبة إنجاز ${a.name}`}
          disabled={!editable || linked || updatingId !== null}
          onClick={() => setProgressActivity(a)}
        >
          <Percent className="h-3.5 w-3.5 text-primary" />
        </Button>
      </span>
    );
  };

  const renderWeightButton = (a: Activity, mobile = false) => (
    <span title={canEditActivity(a)
      ? `تحديد الوزن النوعي (الحالي: ${a.weight ?? 1})`
      : "لا تملك صلاحية تعديل وزن هذا البند"}>
      <Button
        variant="outline"
        size="icon"
        className={mobile ? "h-10 w-10" : "h-7 w-7"}
        aria-label={`تحديد الوزن النوعي ${a.name}`}
        disabled={!canEditActivity(a) || updatingId !== null}
        onClick={() => setWeightActivity(a)}
      >
        <Scale className="h-3.5 w-3.5 text-primary" />
      </Button>
    </span>
  );

  const setActivityWeight = async (a: Activity, weight: number): Promise<boolean> => {
    if (!canEditActivity(a) || updatingId !== null || !Number.isFinite(weight) || weight < 0.01 || weight > 100) return false;
    if (weight === (a.weight ?? 1)) return true;
    setUpdatingId(a.id);
    try {
      await updateActivity.mutateAsync({ projectId, id: a.id, data: { weight } });
      await invalidate();
      return true;
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الوزن النوعي" });
      return false;
    } finally {
      setUpdatingId(null);
    }
  };

  const onSubmit = async (values: ActivityFormValues) => {
    if (editingId && editingManagedRow) {
      try {
        await updateActivity.mutateAsync({
          projectId,
          id: editingId,
          data: { weight: values.weight, sortOrder: values.sortOrder },
        });
        toast({ title: "تم تحديث الوزن والترتيب المحليين" });
        invalidate();
        setIsDialogOpen(false);
        form.reset();
        setEditingId(null);
        setEditingManagedRow(false);
        return;
      } catch {
        toast({ variant: "destructive", title: "فشل تحديث الوزن والترتيب" });
        return;
      }
    }
    const typedCode = sourceCode.trim();
    if (sourceTouched && typedCode) {
      const normalizedCode = typedCode.toLocaleLowerCase();
      if (sourceSearchResolvedTerm !== normalizedCode) {
        setSourceSearchError("انتظر اكتمال البحث للتحقق من رمز المجموعة");
        return;
      }
      const exactMatches = sourceSearchResults.filter(
        (result) => result.linkCode.trim().toLocaleLowerCase() === normalizedCode
      );
      if (exactMatches.length !== 1) {
        setSourceSearchError(exactMatches.length > 1
          ? "رمز المجموعة غير فريد؛ اختر رمزاً فريداً للمصدر"
          : "لم يتم العثور على رمز مجموعة مطابق تماماً");
        return;
      }
      if (!selectedSource || selectedSource.groupId !== exactMatches[0].groupId ||
          (selectedSource.linkCode ?? "").trim().toLocaleLowerCase() !== normalizedCode) {
        setSourceSearchError("تحقق من المصدر المحدد قبل الحفظ");
        return;
      }
      if (selectedSource.projectId === projectId) {
        setSourceSearchError("لا يمكن ربط بند بمجموعة من المشروع نفسه");
        return;
      }
    }
    if (sourceTouched && !typedCode && selectedSource) {
      setSourceSearchError("استخدم زر إلغاء الربط لتأكيد إزالة المصدر");
      return;
    }
    if (sourceTouched && !typedCode && !sourceUnlinkRequested) {
      setSourceSearchError("استخدم زر إلغاء الربط لتأكيد إزالة المصدر");
      return;
    }
    try {
      const payload = {
        ...values,
        actualStartDate: values.actualStartDate || null,
        actualEndDate: values.actualEndDate || null,
        ...(sourceTouched || !editingId ? { externalSourceGroupId: sourceUnlinkRequested ? null : externalSourceId } : {}),
      };
      if (isLinkedSource) {
        delete (payload as Partial<typeof payload>).plannedStartDate;
        delete (payload as Partial<typeof payload>).plannedEndDate;
        delete (payload as Partial<typeof payload>).actualProgress;
      }
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
      setEditingManagedRow(false);
      resetExternalSource();
    } catch {
      toast({ variant: "destructive", title: "فشل الحفظ" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'not_started': return <Badge variant="outline">لم يبدأ</Badge>;
      case 'in_progress': return <Badge className="bg-blue-500 text-white">قيد التنفيذ</Badge>;
      case 'completed': return <Badge className="bg-emerald-500 text-white">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">متأخر</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };
  const getLinkedSource = (activity: Activity) => {
    const linked = activity as Activity & { externalSourceGroupId?: number | null; externalSource?: ExternalSource | null };
    return linked.externalSource ?? (linked.externalSourceGroupId != null
      ? { available: false, groupId: linked.externalSourceGroupId }
      : null);
  };

  const allActivityRows = activities ?? [];
  const filteredActivities = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();

    return allActivityRows.filter((activity) => {
      const matchesSearch = !query || activity.name.toLocaleLowerCase().includes(query);
      const matchesStatus = statusFilter === "all"
        ? true
        : statusFilter === "delayed"
          ? isActivityDelayed(activity)
          : activity.status === statusFilter;
      const activityGroupId = (activity as Activity & { groupId?: number | null }).groupId ?? null;
      const matchesGroup = groupFilter === "all"
        ? true
        : groupFilter === "ungrouped"
          ? activityGroupId === null
          : activityGroupId === groupFilter;
      return matchesSearch && matchesStatus && matchesGroup
        && activityMatchesCategory(activityGroupId, categoryFilter, categoryGroupIds);
    });
  }, [allActivityRows, groupFilter, searchQuery, statusFilter, categoryFilter, categoryGroupIds]);

  const activityRows = filteredActivities;
  const categoryActivityCount = allActivityRows.filter(activity => activityMatchesCategory(
    (activity as Activity & { groupId?: number | null }).groupId ?? null, categoryFilter, categoryGroupIds,
  )).length;
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== "all" || groupFilter !== "all" || categoryFilter !== "all";
  const effectiveViewMode = isContractorBase ? "gantt" : viewMode;
  const ganttData = activityRows.map((a) => ({
    name: a.name.length > 14 ? a.name.slice(0, 14) + "…" : a.name,
    "المخطط": a.plannedProgress ?? 0,
    "الفعلي": a.actualProgress,
  }));

  const allDates = activityRows.flatMap(a => [
    a.plannedStartDate, a.plannedEndDate, a.actualStartDate, a.actualEndDate
  ].filter(Boolean) as string[]);
  const ganttStart = allDates.length > 0
    ? new Date(Math.min(...allDates.map(d => new Date(d).getTime())))
    : new Date(project?.startDate ?? Date.now());
  const ganttEnd = allDates.length > 0
    ? new Date(Math.max(...allDates.map(d => new Date(d).getTime())))
    : new Date(project?.expectedEndDate ?? Date.now());

  const completedCount = allActivityRows.filter(a => a.status === "completed").length;
  const inProgressCount = allActivityRows.filter(a => a.status === "in_progress").length;
  const delayedCount = allActivityRows.filter(isActivityDelayed).length;
  const statusCounts = useMemo(() => ({
    all: allActivityRows.length,
    not_started: allActivityRows.filter(a => a.status === "not_started").length,
    in_progress: inProgressCount,
    completed: completedCount,
    delayed: delayedCount,
  }), [allActivityRows, completedCount, delayedCount, inProgressCount]);
  const groupCounts = useMemo(() => {
    const counts = new Map<number, number>();
    let ungrouped = 0;
    for (const activity of allActivityRows) {
      const groupId = (activity as Activity & { groupId?: number | null }).groupId;
      if (groupId == null) ungrouped += 1;
      else counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
    return { counts, ungrouped };
  }, [allActivityRows]);
  const unavailableByGroup = useMemo(() => {
    const counts = new Map<number, number>();
    for (const activity of allActivityRows) {
      const managedByGroupId = (activity as Activity & { managedByGroupId?: number | null }).managedByGroupId;
      if (managedByGroupId == null || getLinkedSource(activity)?.available !== false) continue;
      counts.set(managedByGroupId, (counts.get(managedByGroupId) ?? 0) + 1);
    }
    return counts;
  }, [allActivityRows]);
  const totalWeight = allActivityRows.reduce((sum, a) => sum + (a.weight && a.weight > 0 ? a.weight : 1), 0);
  const weightOf = (a: Activity) => a.weight && a.weight > 0 ? a.weight : 1;
  const actualProgress = totalWeight > 0
    ? Math.round((allActivityRows.reduce((sum, a) => sum + (a.actualProgress ?? 0) * weightOf(a), 0) / totalWeight) * 10) / 10
    : 0;
  const plannedProgress = allActivityRows.length > 0
    ? Math.round((allActivityRows.reduce((sum, a) => sum + (a.plannedProgress ?? 0) * weightOf(a), 0) / totalWeight) * 10) / 10
    : 0;
  const progressDelta = Math.round((actualProgress - plannedProgress) * 10) / 10;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] space-y-5 overflow-x-clip sm:space-y-6">
      <div className="page-hero flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="relative z-10 mt-0.5 shrink-0 text-white/80 hover:bg-white/10 hover:text-white" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="relative z-10 break-words text-lg font-bold leading-tight text-white md:text-2xl">{project?.name}</h1>
          <p className="relative z-10 mt-1 text-sm text-white/65">الجدول الزمني</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />
      {(reorderActivities.isPending || reorderGroupsMutation.isPending) && (
        <p role="status" className="rounded-lg border bg-muted p-3 text-sm">جارٍ حفظ الترتيب والتحقق من القائمة. انتظر قبل إجراء ترتيب آخر.</p>
      )}

      {(activitiesError || groupsError || categoriesError) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          تعذر تحديث بعض البيانات: {activitiesError ? "البنود " : ""}{groupsError ? "المجموعات " : ""}{categoriesError ? "التصنيفات " : ""}. تبقى آخر بيانات محمّلة ظاهرة إن توفرت.
          <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => { if (activitiesError) void refetchActivities(); if (groupsError) void refetchGroups(); if (categoriesError) void refetchCategories(); }}>إعادة المحاولة</Button>
        </div>
      )}
      {groupsLoading && <div className="h-16 animate-pulse rounded-xl bg-muted/50" aria-label="جارٍ تحميل المجموعات" />}

      <section aria-labelledby="activities-overview" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">نظرة تشغيلية</p>
            <h2 id="activities-overview" className="mt-1 text-xl font-bold tracking-tight">متابعة تقدم بنود الأعمال</h2>
            <p className="mt-1 text-sm text-muted-foreground">ملخص سريع للحالة الحالية قبل مراجعة المخطط الزمني والتفاصيل.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {isLoading ? "جارٍ تحميل البنود" : isFetching ? "جارٍ التحديث مع إبقاء البيانات السابقة" : !activities ? "البيانات غير متاحة" : hasActiveFilters ? `عرض ${activityRows.length} من ${allActivityRows.length} بند` : `آخر عرض · ${allActivityRows.length} بند`}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[
            { label: "إجمالي البنود", value: allActivityRows.length, note: `${groups.length} مجموعة`, icon: ListChecks, tone: "text-primary", dot: "bg-primary" },
            { label: "نسبة الإنجاز", value: `${actualProgress}%`, note: progressDelta >= 0 ? `+${progressDelta}% عن المخطط` : `${progressDelta}% عن المخطط`, icon: TrendingUp, tone: progressDelta < 0 ? "text-destructive" : "text-emerald-600", dot: progressDelta < 0 ? "bg-destructive" : "bg-emerald-500" },
            { label: "مكتمل", value: completedCount, note: allActivityRows.length ? `${Math.round((completedCount / allActivityRows.length) * 100)}% من البنود` : "لا توجد بيانات", icon: CheckCircle2, tone: "text-emerald-600", dot: "bg-emerald-500" },
            { label: "قيد التنفيذ", value: inProgressCount, note: "تحتاج متابعة دورية", icon: Timer, tone: "text-blue-600", dot: "bg-blue-500" },
            { label: "متأخر", value: delayedCount, note: delayedCount > 0 ? "تحتاج إجراءً تصحيحياً" : "لا توجد حالات متأخرة", icon: AlertTriangle, tone: delayedCount > 0 ? "text-destructive" : "text-muted-foreground", dot: delayedCount > 0 ? "bg-destructive" : "bg-muted-foreground" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="surface-card surface-card-hover min-w-0 overflow-hidden">
                <CardContent className="relative min-w-0 p-3 sm:p-5">
                  <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40 ${stat.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{activities ? stat.value : "—"}</p>
                  <p className="mt-1 break-words text-[11px] text-muted-foreground">{activities ? stat.note : isLoading ? "جارٍ التحميل" : "لم تُحمّل البيانات"}</p>
                  <span className={`absolute left-0 top-0 h-1 w-full ${stat.dot}`} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="surface-card surface-card-hover min-w-0" dir="rtl">
        <CardContent className="min-w-0 p-3 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/40 text-primary">
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">مساحة العمل</p>
                  <p className="break-words text-xs text-muted-foreground">ابحث وفلتر البنود ثم اختر طريقة العرض المناسبة للمراجعة.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">عرض {activityRows.length} من {allActivityRows.length}</span>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-primary"
                    onClick={() => { setSearchQuery(""); setStatusFilter("all"); setGroupFilter("all"); setCategoryFilter("all"); }}
                  >
                    مسح الفلاتر
                  </Button>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="ابحث باسم البند..."
                    aria-label="البحث في بنود الأعمال"
                    className="h-10 bg-background pr-9"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={effectiveViewMode === "list" ? "default" : "ghost"}
                    className="min-h-10 flex-1 gap-1.5 px-3 text-xs sm:flex-none"
                    disabled={isContractorBase}
                    onClick={() => setViewMode("list")}
                    title={isContractorBase ? "عرض القائمة غير متاح لهذا الدور" : "عرض القائمة"}
                  >
                    <LayoutList className="h-4 w-4" /> القائمة
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={effectiveViewMode === "gantt" ? "default" : "ghost"}
                    className="min-h-10 flex-1 gap-1.5 px-3 text-xs sm:flex-none"
                    onClick={() => setViewMode("gantt")}
                  >
                    <GanttChart className="h-4 w-4" /> جانت
                  </Button>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <ActivityGroupOrganizer
                  key={projectId}
                  projectId={projectId}
                  groups={groups}
                  categories={categories}
                  categoryFilter={categoryFilter}
                  onCategoryFilterChange={value => { setCategoryFilter(value); setGroupFilter("all"); }}
                  canOrganize={canEditAll && !isViewer && !isContractorBase}
                  loading={categoriesLoading || groupsLoading}
                  error={categoriesError || groupsError}
                  onChanged={() => {
                    queryClient.invalidateQueries({ queryKey: categoriesQueryKey });
                    queryClient.invalidateQueries({ queryKey: groupsQueryKey });
                    setGroupFilter("all");
                  }}
                />
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">فهرس الحالة</span>
                    <span className="text-[11px] text-muted-foreground">اختيار مباشر</span>
                  </div>
                  {statusFilter !== "all" && (
                    <div role="status" aria-label="فلتر الحالة المفعّل" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary bg-primary p-3 text-sm text-primary-foreground">
                      <span className="font-semibold">
                        فلتر الحالة مفعّل: {STATUS_OPTIONS.find(option => option.value === statusFilter)?.label}
                      </span>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setStatusFilter("all")}>
                        إلغاء فلتر الحالة
                      </Button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6" role="group" aria-label="فهرس حالات بنود الأعمال">
                    <Button
                      type="button"
                      size="sm"
                      variant={statusFilter === "all" ? "default" : "outline"}
                      aria-pressed={statusFilter === "all"}
                      className="min-h-10 h-auto min-w-0 justify-center gap-1 px-1.5 py-1 text-[11px] sm:text-xs"
                      onClick={() => setStatusFilter("all")}
                    >
                      <ListChecks className="h-3.5 w-3.5" />
                      كل الحالات
                      <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">{statusCounts.all}</span>
                    </Button>
                    {STATUS_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      const isSelected = statusFilter === option.value;
                      return (
                        <Button
                          key={option.value}
                          type="button"
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          aria-pressed={isSelected}
                          aria-label={`تصفية الحالة: ${option.label}`}
                          className={`min-h-10 h-auto min-w-0 justify-center gap-1 px-1.5 py-1 text-[11px] sm:text-xs ${isSelected ? "bg-primary text-primary-foreground hover:bg-primary" : option.cls}`}
                          onClick={() => setStatusFilter(option.value)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {option.label}
                          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">{statusCounts[option.value]}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">فهرس المجموعات</span>
                    <span className="text-[11px] text-muted-foreground">{categoryGroups.length} مجموعات{categoryFilter !== "all" ? ` من ${groups.length}` : ""}</span>
                  </div>
                  {groupFilter !== "all" && (
                    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary bg-primary p-3 text-sm text-primary-foreground">
                      <span className="font-semibold">
                        فلتر المجموعات مفعّل: {groupFilter === "ungrouped" ? "بدون مجموعة" : groups.find(group => group.id === groupFilter)?.name ?? "المجموعة المحددة"}
                      </span>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setGroupFilter("all")}>
                        إلغاء فلتر المجموعة
                      </Button>
                    </div>
                  )}
                  <div className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" dir="rtl" role="group" aria-label="فهرس مجموعات بنود الأعمال">
                    <Button
                      type="button"
                      size="sm"
                      variant={groupFilter === "all" ? "default" : "outline"}
                      aria-pressed={groupFilter === "all"}
                      className="min-h-10 h-auto min-w-0 justify-center gap-1.5 px-2 text-xs"
                      onClick={() => setGroupFilter("all")}
                    >
                      {categoryFilter === "all" ? "كل المجموعات" : "كل مجموعات التصنيف"}
                      <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">{categoryActivityCount}</span>
                    </Button>
                    {!groupsError && categoryGroups.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((group) => {
                      const isSelected = groupFilter === group.id;
                      const itemCount = groupCounts.counts.get(group.id) ?? 0;
                      const unavailableCount = unavailableByGroup.get(group.id) ?? 0;
                      return (
                        <div key={group.id} className={`flex min-h-14 min-w-0 items-center gap-1 rounded-lg border px-1.5 py-1 transition-colors ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-pressed={isSelected}
                            aria-label={`عرض مجموعة ${group.name}، ${itemCount} بند`}
                            title={group.name}
                            className={`h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 overflow-hidden px-2 py-1 text-right ${isSelected ? "text-primary-foreground hover:bg-primary hover:text-primary-foreground" : "hover:bg-muted/50"}`}
                            onClick={() => setGroupFilter(group.id)}
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden">
                              <span className="w-full truncate text-xs font-semibold sm:text-sm">{group.name}</span>
                              <span className={`flex max-w-full items-center gap-1.5 overflow-hidden text-[10px] font-normal ${isSelected ? "text-primary-foreground" : "text-muted-foreground"}`}>
                                {group.linkedProjectActive ? <><Link2 className="h-3 w-3 shrink-0" /><span className="shrink-0">مشروع مرتبط</span></> : <span className="shrink-0">مجموعة عادية</span>}
                                {unavailableCount > 0 && <span className="flex min-w-0 items-center gap-1 truncate text-amber-700 dark:text-amber-400" title={`${unavailableCount} مصدر غير متاح؛ القيم المحفوظة ما زالت ظاهرة`}><AlertTriangle className="h-3 w-3 shrink-0" />{unavailableCount} غير متاح</span>}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{itemCount}</span>
                          </Button>
                          {!isViewer && !isContractorBase && (
                            <ActivityGroupSideProjectSync
                              currentProjectId={projectId}
                              group={group}
                              itemCount={itemCount}
                              onEdit={() => openEditGroupDialog(group)}
                              onDelete={() => setDeletingGroup(group)}
                              onUpdated={() => {
                                queryClient.invalidateQueries({ queryKey: groupsQueryKey });
                                invalidate();
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                    {groupCounts.ungrouped > 0 && (categoryFilter === "all" || categoryFilter === "uncategorized") && (
                      <Button
                        type="button"
                        size="sm"
                        variant={groupFilter === "ungrouped" ? "default" : "outline"}
                        aria-pressed={groupFilter === "ungrouped"}
                        className="min-h-10 h-auto min-w-0 justify-center gap-1.5 px-2 text-xs"
                        onClick={() => setGroupFilter("ungrouped")}
                      >
                        بدون مجموعة
                        <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">{groupCounts.ungrouped}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        {/* ── Gantt Chart ── */}
        {effectiveViewMode === "gantt" && activityRows.length > 0 && (() => {
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
            <Card className="surface-card surface-card-hover min-w-0">
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
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 rounded-sm bg-emerald-500" style={{ width: 3 }} /> بدأ بدون نسبة
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-600">
                      <AlertTriangle className="w-3 h-3" /> تواريخ ناقصة
                    </span>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="min-w-0 px-3 pt-0 sm:px-6">
                <div className="w-full max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="المخطط الزمني قابل للتمرير أفقياً" tabIndex={0}>
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
                    {activityRows.map((a, idx) => {
                      const barColor = a.status === "delayed" ? "#ef4444" : a.status === "completed" ? "#10b981" : "#10b981";
                      const actualEnd = a.actualEndDate ?? (a.actualStartDate ? today.toISOString().split("T")[0] : null);
                      const isLast = idx === activityRows.length - 1;

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
                              {(() => {
                                const hasPlanned = !!(a.plannedStartDate && a.plannedEndDate);
                                const hasAnyStart = !!(a.actualStartDate || a.plannedStartDate);
                                const hasActualSignal = (a.actualProgress > 0 || !!a.actualStartDate) && hasAnyStart;
                                const orphanProgress = a.actualProgress > 0 && !hasAnyStart;

                                // ── Case 1: لا توجد أي تواريخ ولا أي إشارة قابلة للرسم ──
                                if (!hasPlanned && !hasActualSignal && !orphanProgress) {
                                  return (
                                    <div className="relative h-4 flex items-center" title="ينقص هذا البند تواريخ مخططة">
                                      <div
                                        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0"
                                        style={{ borderTop: "1.5px dashed rgba(148,163,184,0.6)" }}
                                      />
                                      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-amber-500 bg-background rounded-full p-0.5">
                                        <AlertTriangle className="w-3 h-3" />
                                      </span>
                                    </div>
                                  );
                                }

                                // ── Case 2: نسبة إنجاز بدون أي تواريخ — تنبيه + النسبة ──
                                if (orphanProgress) {
                                  return (
                                    <div
                                      className="relative h-4 flex items-center justify-end pr-2 gap-1.5"
                                      title={`نسبة إنجاز ${formatDisplayPercent(a.actualProgress)} بدون تواريخ مسجلة`}
                                    >
                                      <div
                                        className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0"
                                        style={{ borderTop: "1.5px dashed rgba(148,163,184,0.6)" }}
                                      />
                                      <span className="relative z-10 text-[10px] font-bold text-foreground bg-background px-1.5 rounded border border-amber-300">
                                        {formatDisplayPercent(a.actualProgress)}
                                      </span>
                                      <span className="relative z-10 text-amber-500 bg-background rounded-full p-0.5">
                                        <AlertTriangle className="w-3 h-3" />
                                      </span>
                                    </div>
                                  );
                                }

                                return (
                                  <>
                                    {/* Planned bar */}
                                    <div className="relative h-4">
                                      {hasPlanned ? (() => {
                                        const sl = toPct(new Date(a.plannedStartDate!));
                                        const el = toPct(new Date(a.plannedEndDate!));
                                        const w = Math.max(0.5, el - sl);
                                        return (
                                          <div
                                            className="absolute h-full rounded-full bg-blue-400/70"
                                            style={{ right: `${sl}%`, width: `${w}%` }}
                                            title={`مخطط: ${fmtDate(a.plannedStartDate!)} → ${fmtDate(a.plannedEndDate!)}`}
                                          />
                                        );
                                      })() : (
                                        <div
                                          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0"
                                          style={{ borderTop: "1.5px dashed rgba(148,163,184,0.5)" }}
                                          title="لا يوجد جدول مخطط لهذا البند"
                                        />
                                      )}
                                    </div>

                                    {/* Actual bar */}
                                    {hasActualSignal && (
                                      <div className="relative h-4">
                                        {(() => {
                                          const ongoing = !a.actualEndDate && a.status !== "completed";
                                          const startIso = a.actualStartDate ?? a.plannedStartDate!;
                                          const startPct = toPct(new Date(startIso));
                                          const startLabel = a.actualStartDate
                                            ? fmtDate(a.actualStartDate)
                                            : `(مخطط) ${fmtDate(a.plannedStartDate!)}`;

                                          // Marker: بدأ النشاط بدون نسبة مسجلة
                                          if (a.actualProgress === 0 && a.actualStartDate) {
                                            return (
                                              <div
                                                className="absolute h-full"
                                                style={{ right: `calc(${startPct}% - 1.5px)`, width: 3 }}
                                                title={`بدأ في ${fmtDate(a.actualStartDate)} — بدون إنجاز مسجَّل بعد`}
                                              >
                                                <div
                                                  className="h-full w-full rounded-sm"
                                                  style={{ backgroundColor: barColor, opacity: 0.85 }}
                                                />
                                              </div>
                                            );
                                          }

                                          // حساب نقطة النهاية
                                          let endPct: number;
                                          let endLabel: string;
                                          if (a.actualEndDate) {
                                            endPct = toPct(new Date(a.actualEndDate));
                                            endLabel = fmtDate(a.actualEndDate);
                                          } else if (ongoing) {
                                            endPct = todayPct;
                                            endLabel = "جارٍ حتى اليوم";
                                          } else if (hasPlanned) {
                                            const ps = toPct(new Date(a.plannedStartDate!));
                                            const pe = toPct(new Date(a.plannedEndDate!));
                                            const plannedW = Math.max(0.5, pe - ps);
                                            endPct = startPct + plannedW * a.actualProgress / 100;
                                            endLabel = "—";
                                          } else {
                                            endPct = startPct;
                                            endLabel = "—";
                                          }

                                          const w = Math.max(0.5, endPct - startPct);
                                          return (
                                            <div
                                              className="absolute h-full rounded-full flex items-center overflow-hidden"
                                              style={{
                                                right: `${startPct}%`,
                                                width: `${w}%`,
                                                backgroundColor: barColor,
                                                ...(ongoing ? { borderLeft: "3px solid white" } : {}),
                                              }}
                                               title={`فعلي: ${startLabel} → ${endLabel} (${formatDisplayPercent(a.actualProgress)})`}
                                            >
                                              {w > 8 && (
                                                <span className="text-[9px] font-bold text-white px-1.5 truncate">
                                                   {formatDisplayPercent(a.actualProgress)}
                                                </span>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
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

        {!isContractorBase && effectiveViewMode === "gantt" && (
        <Card className="surface-card surface-card-hover min-w-0">
          <CardHeader>
            <CardTitle className="text-base">الإنجاز المخطط مقابل الفعلي</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 px-3 sm:px-6">
            <div className="h-[260px] min-w-0">
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
        )}

        {effectiveViewMode === "list" && !isContractorBase && (
        <Card className="surface-card surface-card-hover min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">بنود الأعمال</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">انقر على الحالة أو نسبة الإنجاز لتحديثها مباشرةً</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {!isViewer && (
              <Button size="sm" variant="outline" className="min-h-10 gap-1.5 text-xs sm:text-sm" onClick={openNewGroupDialog}>
                <FolderPlus className="h-4 w-4" /> مجموعة جديدة
              </Button>
            )}
            <Button size="sm" variant="outline" className="min-h-10 gap-1.5 text-xs sm:text-sm" onClick={exportActivities} disabled={!activities || activities.length === 0}>
              <Download className="h-4 w-4" /> تصدير <span className="hidden sm:inline">Excel</span>
            </Button>
            {!isViewer && (
            <Dialog open={isImportOpen} onOpenChange={(open) => {
              if (!open && isImporting && importPreview) return;
              setIsImportOpen(open);
              if (!open) resetImport();
            }}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="min-h-10 gap-1.5 text-xs sm:text-sm">
                  <Upload className="h-4 w-4" /> استيراد <span className="hidden sm:inline">Excel</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[calc(100vw-1rem)] min-w-0 sm:max-w-[860px] p-0 max-h-[94dvh] overflow-hidden flex flex-col" dir="rtl">
                <div className="bg-muted/40 p-4 sm:px-6 sm:py-5 border-b border-border shrink-0">
                  <DialogHeader>
                    <DialogTitle className="text-lg sm:text-xl flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" /> استيراد بنود من Excel</DialogTitle>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">عاين وجهة كل صف قبل إضافة البنود إلى المشروع.</p>
                  </DialogHeader>
                </div>
                <div className="min-w-0 overflow-y-auto flex-1 p-4 sm:p-6 space-y-5">
                  {!importResult && <>
                    <fieldset disabled={isImporting} className="space-y-2">
                      <legend className="text-sm font-bold mb-2">وجهة البنود</legend>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {([
                          ["detect", "اكتشاف المجموعات", "قراءة صفوف المجموعات من الملف"],
                          ["existing", "مجموعة موجودة", "وضع البنود في مجموعة واحدة"],
                          ["none", "بدون مجموعة", "إضافة البنود مباشرة للمشروع"],
                        ] as const).map(([mode, title, description]) => (
                          <label key={mode} className={`flex gap-2 rounded-xl border p-3 cursor-pointer ${importMode === mode ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}>
                            <input type="radio" name="import-mode" className="mt-1 accent-primary shrink-0" checked={importMode === mode} onChange={() => { setImportMode(mode); clearImportPreview(); }} />
                            <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs text-muted-foreground leading-relaxed mt-0.5">{description}</span></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {importMode === "existing" && <div className="space-y-1.5">
                      <label className="text-sm font-semibold" htmlFor="import-destination-group">المجموعة المستهدفة</label>
                      <select id="import-destination-group" value={importGroupId ?? ""} disabled={isImporting || groupsLoading}
                        onChange={e => { setImportGroupId(e.target.value ? Number(e.target.value) : null); clearImportPreview(); }}
                        className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="">{groupsLoading ? "جاري تحميل المجموعات..." : "اختر مجموعة من المشروع"}</option>
                        {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                      {groupsError && <p className="text-xs text-destructive">تعذر تحميل المجموعات. أعد المحاولة من الصفحة.</p>}
                      {!groupsLoading && !groupsError && groups.length === 0 && <p className="text-xs text-muted-foreground">لا توجد مجموعات بعد. اختر نمطاً آخر أو أنشئ مجموعة أولاً.</p>}
                    </div>}
                    <div className="space-y-2">
                      <label htmlFor="import-excel-file" className="text-sm font-bold">ملف Excel</label>
                      <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 sm:p-4">
                        <input id="import-excel-file" type="file" accept=".xlsx,.xls" disabled={isImporting}
                          onChange={e => { setImportFile(e.target.files?.[0] || null); clearImportPreview(); }}
                          className="block w-full min-w-0 text-xs sm:text-sm text-muted-foreground file:me-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:font-semibold file:text-primary-foreground" />
                        <p className="mt-2 text-xs text-muted-foreground break-all">{importFile ? `${importFile.name} · ${(importFile.size / 1024 / 1024).toFixed(2)} MB` : "ملف .xlsx أو .xls بحد أقصى 5 MB"}</p>
                      </div>
                      {importFile && importFile.size > 5 * 1024 * 1024 && <p className="text-xs text-destructive">الملف أكبر من 5 MB. اختر ملفاً أصغر للمعاينة.</p>}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-5">
                      <div className="text-xs text-muted-foreground leading-relaxed">
                        الأعمدة المطلوبة: اسم البند، تاريخ البداية، تاريخ النهاية. عمود <strong className="text-foreground">النوع</strong> اختياري لتحديد «مجموعة» أو «نشاط».
                        <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-primary font-semibold underline underline-offset-4 me-1"><Download className="h-3.5 w-3.5" /> تحميل نموذج</button>
                      </div>
                      <Button type="button" variant="outline" onClick={handleImportPreview}
                        disabled={!importFile || importFile.size > 5 * 1024 * 1024 || (importMode === "existing" && importGroupId == null) || isImporting} className="shrink-0 gap-2">
                        {isImporting && !importPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        {isImporting && !importPreview ? "تجهيز المعاينة..." : "معاينة الصفوف"}
                      </Button>
                    </div>
                  </>}
                  {importError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>{importError}</span></div>}
                  {importPreview && !importResult && (
                    <section aria-label="معاينة الاستيراد" className="space-y-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div><h3 className="text-base font-bold">معاينة الصفوف</h3><p className="text-xs text-muted-foreground">بالترتيب الأصلي في الملف؛ الصفوف المرفوضة لن تُحفظ.</p></div>
                        <div className="flex gap-2 text-xs tabular-nums"><span className="rounded-md bg-primary/10 text-primary px-2.5 py-1.5 font-bold">{importPreview.counts.activities} بند صالح</span><span className="rounded-md bg-destructive/10 text-destructive px-2.5 py-1.5 font-bold">{importPreview.counts.rejected} مرفوض</span></div>
                      </div>
                      {importPreview.counts.rejected > 0 && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">توجد صفوف مرفوضة. راجع أسباب الرفض أدناه؛ يمكنك حفظ البنود الصالحة فقط.</div>}
                      {importPreview.groups.some(group => importPreview.rows.some(row => row.kind === "activity" && row.groupRow === group.rowNumber) && group.matches.length > 1 && !importChoices[String(group.rowNumber)]) &&
                        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">هناك أسماء مجموعات متكررة. اختر وجهة كل مجموعة قبل الحفظ.</div>}
                      <div className="rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:grid grid-cols-[4rem_minmax(0,1fr)_8rem_8rem] gap-3 bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
                          <span>الصف</span><span>النوع / الاسم / الوجهة</span><span>البداية</span><span>النهاية</span>
                        </div>
                        <div className="divide-y divide-border">
                          {importPreview.rows.map((row, index) => {
                            const group = row.kind === "group" ? importPreview.groups.find(item => item.rowNumber === row.rowNumber) : null;
                            const hasGroupActivities = group != null && importPreview.rows.some(item => item.kind === "activity" && item.groupRow === group.rowNumber);
                            const choice = group ? importChoices[String(group.rowNumber)] : undefined;
                            const parent = row.groupRow == null ? null : importPreview.groups.find(item => item.rowNumber === row.groupRow);
                            const destination = importMode === "existing"
                              ? groups.find(item => item.id === importGroupId)?.name ?? "المجموعة المحددة"
                              : importMode === "none" || row.groupRow == null ? "بدون مجموعة"
                              : parent ? `${parent.name}${importChoices[String(parent.rowNumber)]?.action === "existing" ? " · موجودة" : ""}` : `مجموعة الصف ${row.groupRow}`;
                            return <div key={`${row.rowNumber}-${index}`} className={`grid grid-cols-[3rem_minmax(0,1fr)] sm:grid-cols-[4rem_minmax(0,1fr)_8rem_8rem] gap-x-3 gap-y-1 px-3 py-3 text-sm ${row.kind === "error" ? "bg-destructive/5" : row.kind === "group" ? "bg-primary/5" : "bg-card"}`}>
                              <span dir="ltr" className="text-xs text-muted-foreground tabular-nums text-right sm:text-center pt-0.5">{row.rowNumber}</span>
                              <div className={`min-w-0 ${row.kind === "activity" && row.groupRow != null && importMode === "detect" ? "border-r-2 border-primary/40 pr-3" : ""}`}>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold shrink-0 ${row.kind === "error" ? "bg-destructive/10 text-destructive" : row.kind === "group" ? "bg-primary/10 text-primary" : "bg-muted text-foreground"}`}>{row.kind === "error" ? "مرفوض" : row.kind === "group" ? "مجموعة" : "بند"}</span>
                                  <span className="font-semibold break-words">{row.name || "بدون اسم"}</span>
                                </div>
                                {row.kind === "error" ? <p className="text-xs text-destructive mt-1">{row.error || "تعذر قراءة هذا الصف"}</p> :
                                  row.kind === "activity" ? <p className="text-xs text-muted-foreground mt-1">الوجهة: {destination}</p> : null}
                                {group && <div className="mt-2 space-y-1.5">
                                  <p className="text-xs text-muted-foreground">{!hasGroupActivities ? "لا توجد أنشطة صالحة تحت هذا العنوان؛ لن تُنشأ أو تُستخدم هذه المجموعة." :
                                    group.matches.length === 0 ? "لا توجد مجموعة مطابقة؛ ستُنشأ مجموعة جديدة." :
                                    group.matches.length === 1 ? `مطابقة موجودة: ${group.matches[0].name} — ستُستخدم افتراضياً.` :
                                      `${group.matches.length} مجموعات مطابقة؛ يلزم اختيار واحدة أو إنشاء جديدة.`}</p>
                                  {hasGroupActivities && <label className="text-xs font-semibold flex flex-wrap items-center gap-2">
                                    <span>إجراء المجموعة:</span>
                                    <select aria-label={`إجراء مجموعة الصف ${row.rowNumber}`} disabled={isImporting} value={choice?.action === "new" ? "new" : choice?.groupId != null ? String(choice.groupId) : ""}
                                      onChange={e => setImportChoices(current => {
                                        const next = { ...current };
                                        if (!e.target.value) delete next[String(group.rowNumber)];
                                        else next[String(group.rowNumber)] = e.target.value === "new" ? { action: "new" } : { action: "existing", groupId: Number(e.target.value) };
                                        return next;
                                      })}
                                      className="max-w-full min-w-0 rounded-md border border-input bg-card px-2 py-1.5 text-xs text-foreground">
                                      {group.matches.length > 1 && <option value="">اختر الوجهة</option>}
                                      <option value="new">إنشاء مجموعة جديدة</option>
                                      {group.matches.map(match => <option key={match.id} value={match.id}>استخدام الموجودة: {match.name} (#{match.id})</option>)}
                                    </select>
                                  </label>}
                                </div>}
                              </div>
                              <div className="col-start-2 flex gap-3 text-xs text-muted-foreground sm:col-start-3 sm:block"><span className="sm:hidden">البداية:</span><span dir="ltr">{row.plannedStartDate?.split("T")[0] || "—"}</span></div>
                              <div className="col-start-2 flex gap-3 text-xs text-muted-foreground sm:col-start-4 sm:block"><span className="sm:hidden">النهاية:</span><span dir="ltr">{row.plannedEndDate?.split("T")[0] || "—"}</span></div>
                            </div>;
                          })}
                          {importPreview.rows.length === 0 && <p className="p-5 text-center text-sm text-muted-foreground">لم يعثر الملف على صفوف قابلة للعرض. راجع النموذج وحاول مجدداً.</p>}
                        </div>
                      </div>
                    </section>
                  )}
                  {importResult && <section role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 space-y-4">
                    <div className="flex items-center gap-2 font-bold text-primary"><CheckCircle2 className="h-5 w-5" /> انتهى الاستيراد</div>
                    {importPreview && <p className="text-xs text-muted-foreground">قبل الحفظ: {importPreview.counts.activities} بند صالح، {importPreview.counts.rejected} صف مرفوض. بعد الحفظ:</p>}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        ["بنود مستوردة", importResult.imported],
                        ["مجموعات جديدة", importResult.groupsCreated],
                        ["مجموعات مستخدمة", importResult.groupsUsed],
                        ["صفوف مرفوضة", importResult.rejected],
                      ] as const).map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-card p-3"><span className="block text-xl font-bold tabular-nums">{value}</span><span className="text-xs text-muted-foreground">{label}</span></div>)}
                    </div>
                    {!!importResult.errors?.length && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"><strong>ملاحظات الحفظ:</strong><ul className="list-disc list-inside mt-1 space-y-1">{importResult.errors.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
                    {!!importResult.warnings?.length && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"><strong>تحتاج متابعة:</strong><ul className="list-disc list-inside mt-1 space-y-1">{importResult.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
                  </section>}
                </div>
                <div className="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2">
                  <Button variant="outline" disabled={isImporting && !!importPreview} onClick={() => { setIsImportOpen(false); resetImport(); }}>{importResult ? "إغلاق" : "إلغاء"}</Button>
                  {importPreview && !importResult && <Button onClick={handleImportConfirm}
                    disabled={isImporting || importPreview.counts.activities < 1 || importPreview.groups.some(group => importPreview.rows.some(row => row.kind === "activity" && row.groupRow === group.rowNumber) && !importChoices[String(group.rowNumber)])} className="gap-2">
                    {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isImporting ? "جاري الحفظ..." : `حفظ ${importPreview.counts.activities} بند صالح`}
                  </Button>}
                </div>
              </DialogContent>
            </Dialog>
            )}
            {!isViewer && (
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) { form.reset(); setEditingId(null); setEditingManagedRow(false); resetExternalSource(); }
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="min-h-10 gap-1.5 text-xs sm:text-sm mr-auto" onClick={() => { setEditingId(null); setEditingManagedRow(false); resetExternalSource(); }}>
                  <Plus className="h-4 w-4" /> إضافة بند
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-[700px] p-0 overflow-hidden max-h-[90dvh]" dir="rtl">
                <div className="bg-muted/30 p-6 pb-4 border-b border-border/50">
                  <DialogHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-500/10 rounded-xl">
                        {editingId ? <Edit2 className="h-6 w-6 text-blue-600" /> : <Plus className="h-6 w-6 text-blue-600" />}
                      </div>
                      <div>
                        <DialogTitle className="text-xl">{editingId ? "تعديل البند" : "إضافة بند جديد"}</DialogTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          {editingManagedRow
                            ? "هذا بند مُدار من مصدر مجموعة؛ يمكن تعديل وزنه وترتيبه المحليين فقط."
                            : editingId ? "قم بتحديث تفاصيل البند وحالته الحالية." : "أدخل تفاصيل ومواعيد البند الجديد لمتابعته في الجدول الزمني."}
                        </p>
                      </div>
                    </div>
                  </DialogHeader>
                </div>
                
                <div className="min-w-0 overflow-y-auto max-h-[calc(90dvh-140px)]">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 p-4 pt-4 space-y-6 sm:p-6">
                      {editingManagedRow && (
                        <div className="space-y-4">
                          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                            <p className="font-medium">بند مُدار من مجموعة مرتبطة</p>
                            {selectedSource && !selectedSource.available && (
                              <p className="mt-2 flex items-center gap-2 text-amber-700 dark:text-amber-400" role="status">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                المصدر غير متاح؛ القيم المحفوظة ظاهرة ولن تُحدّث حتى يعود المصدر.
                              </p>
                            )}
                            {selectedSource?.available && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                المصدر: {selectedSource.groupName ?? "مجموعة مرتبطة"}{!editingRedactedSource && selectedSource.projectName ? ` · ${selectedSource.projectName}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="grid gap-5 sm:grid-cols-2">
                            <FormField control={form.control} name="weight" render={({ field }) => (
                              <FormItem>
                                <FormLabel>الوزن النسبي</FormLabel>
                                <FormControl><Input type="number" inputMode="decimal" className="h-11 bg-background font-mono" min={0} step="0.0001" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={form.control} name="sortOrder" render={({ field }) => (
                              <FormItem>
                                <FormLabel>الترتيب المحلي</FormLabel>
                                <FormControl><Input type="number" className="h-11 bg-background font-mono" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                        </div>
                      )}
                      <div className={editingManagedRow ? "hidden" : "space-y-6"}>
                      <div className="p-5 rounded-2xl border bg-muted/20 shadow-sm space-y-5">
                        <FormField control={form.control} name="name" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">اسم البند</FormLabel>
                            <FormControl><Input className="h-11 bg-background" {...field} placeholder="مثال: أعمال صب القواعد الخرسانية" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="p-5 rounded-2xl border bg-muted/20 shadow-sm space-y-3">
                        {editingRedactedSource ? (
                          <div className="space-y-3">
                            <p className="text-sm font-semibold">مصدر إنجاز مرتبط</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {sourceUnlinkRequested
                                ? "سيُلغى ربط المصدر عند حفظ البند، ويمكنك تعديل الإنجاز والتواريخ بعد ذلك."
                                : "مصدر هذا البند مرتبط، لكن بيانات الوصول إلى المجموعة المصدر غير متاحة لك. سيبقى الربط قائماً عند حفظ التعديلات دون عرض رمز أو اسم المشروع المصدر."}
                            </p>
                            {!sourceUnlinkRequested && selectedSource?.groupName && (
                              <p className="break-words text-xs text-muted-foreground">المجموعة: {selectedSource.groupName}</p>
                            )}
                            {!sourceUnlinkRequested && (
                              <Button
                                type="button"
                                variant="outline"
                                className="min-h-11"
                                onClick={() => {
                                  setSelectedSource(null);
                                  setSourceCode("");
                                  setSourceTouched(true);
                                  setSourceUnlinkRequested(true);
                                  setSourceSearchTerm("");
                                  setSourceSearchResults([]);
                                  setSourceSearchResolvedTerm("");
                                  setSourceSearchError("");
                                }}
                              >
                                إلغاء ربط المصدر عند الحفظ
                              </Button>
                            )}
                          </div>
                        ) : (
                        <>
                        <div>
                          <label className="text-sm font-semibold mb-1 block text-foreground/90">رمز مصدر الإنجاز (اختياري)</label>
                          <p className="text-xs text-muted-foreground mb-2">أدخل رمز مجموعة من مشروع آخر لربط الإنجاز والتواريخ المخططة بها.</p>
                          <Input
                            className="h-11 bg-background font-mono"
                            value={sourceCode}
                            dir="ltr"
                            placeholder="رمز المجموعة"
                            onChange={(event) => {
                              setSourceCode(event.target.value);
                              setSourceTouched(true);
                              setSourceUnlinkRequested(false);
                              setSourceSearchError("");
                              setSourceSearchResolvedTerm("");
                              setSourceSearchTerm(event.target.value);
                            }}
                          />
                          {sourceSearchLoading && <p className="mt-2 text-xs text-muted-foreground">جاري البحث عن مجموعات…</p>}
                          {sourceSearchError && <p className="mt-2 text-xs text-destructive">{sourceSearchError}</p>}
                          {sourceSearchResults.length > 0 && sourceTouched && !hasMatchingSelectedSource && (
                            <div className="mt-2 max-h-40 space-y-1 overflow-auto rounded-md border bg-background p-1">
                              {sourceSearchResults.map((result) => {
                                const exactMatch = result.linkCode.trim() === sourceCode.trim();
                                return (
                                  <button
                                    key={`${result.projectId}-${result.groupId}`}
                                    type="button"
                                    className={`w-full rounded px-3 py-2 text-right text-sm hover:bg-accent ${selectedSource?.groupId === result.groupId ? "bg-accent" : ""}`}
                                    onClick={() => {
                                      setSelectedSource({
                                        available: true,
                                        groupId: result.groupId,
                                        projectId: result.projectId,
                                        projectName: result.projectName,
                                        groupName: result.groupName,
                                        linkCode: result.linkCode,
                                        actualProgress: result.actualProgress,
                                        plannedStartDate: result.plannedStartDate,
                                        plannedEndDate: result.plannedEndDate,
                                      });
                                      setSourceCode(result.linkCode);
                                      setSourceSearchTerm(result.linkCode);
                                      setSourceTouched(true);
                                      setSourceUnlinkRequested(false);
                                      setSourceSearchResolvedTerm(result.linkCode.trim().toLocaleLowerCase());
                                      setSourceSearchError("");
                                    }}
                                  >
                                    <span className="flex items-center justify-between gap-2">
                                      <span className="font-medium">{result.groupName}</span>
                                      <span className="font-mono text-xs text-muted-foreground" dir="ltr">{result.linkCode}</span>
                                    </span>
                                    <span className="block text-xs text-muted-foreground">{result.projectName}{exactMatch ? " · تطابق الرمز" : ""}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {selectedSource && isLinkedSource && hasMatchingSelectedSource && (
                          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                            {selectedSource.available ? (
                              <>
                                <div className="mb-1 flex items-center gap-2">
                                  <Badge variant="secondary">مصدر مرتبط</Badge>
                                  <span className="font-medium">{selectedSource.groupName ?? "المجموعة"}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  المشروع: {selectedSource.projectName ?? "—"} · الإنجاز: {selectedSource.actualProgress ?? 0}%
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  المدة المخططة: {fmtDate(selectedSource.plannedStartDate)} → {fmtDate(selectedSource.plannedEndDate)}
                                </p>
                              </>
                            ) : (
                              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-4 w-4 shrink-0" /> المصدر المرتبط غير متاح (قد تكون المجموعة حُذفت). أعد الربط برمز صالح أو ألغِ الربط.
                              </p>
                            )}
                          </div>
                        )}
                        {(selectedSource || sourceTouched) && !sourceUnlinkRequested && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedSource(null);
                              setSourceCode("");
                              setSourceTouched(true);
                              setSourceUnlinkRequested(true);
                              setSourceSearchTerm("");
                              setSourceSearchResults([]);
                              setSourceSearchResolvedTerm("");
                              setSourceSearchError("");
                            }}
                          >
                            إلغاء ربط المصدر
                          </Button>
                        )}
                        {sourceUnlinkRequested && (
                          <p className="text-xs text-muted-foreground">سيُلغى ربط المصدر عند حفظ البند.</p>
                        )}
                        </>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-muted/20 shadow-sm">
                        <FormField control={form.control} name="plannedStartDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">بداية مخططة {isNoSchedule && <span className="text-xs text-muted-foreground font-normal">(اختياري)</span>}</FormLabel>
                            <FormControl><Input type="date" className="h-11 bg-background" {...field} disabled={isLinkedSource} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="plannedEndDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">نهاية مخططة {isNoSchedule && <span className="text-xs text-muted-foreground font-normal">(اختياري)</span>}</FormLabel>
                            <FormControl><Input type="date" className="h-11 bg-background" {...field} disabled={isLinkedSource} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        
                        <div className="sm:col-span-2 h-px bg-border/50 my-1" />

                        <FormField control={form.control} name="actualStartDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">بداية فعلية</FormLabel>
                            <FormControl><Input type="date" className="h-11 bg-background" {...field} value={field.value ?? ""} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="actualEndDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">نهاية فعلية</FormLabel>
                            <FormControl><Input type="date" className="h-11 bg-background" {...field} value={field.value ?? ""} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-5 rounded-2xl border bg-muted/20 shadow-sm">
                        <FormField control={form.control} name="actualProgress" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">الإنجاز الفعلي (%)</FormLabel>
                            <FormControl><Input type="number" className="h-11 bg-background font-mono" min={0} max={100} {...field} disabled={isLinkedSource} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="weight" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90 flex items-center justify-between">الوزن النسبي <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">الافتراضي 1</span></FormLabel>
                            <FormControl><Input type="number" inputMode="decimal" className="h-11 bg-background font-mono" min={0} step="0.0001" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="sortOrder" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-foreground/90">الترتيب</FormLabel>
                            <FormControl><Input type="number" className="h-11 bg-background font-mono" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="status" render={({ field }) => (
                          <FormItem className="sm:col-span-2 lg:col-span-3 mt-2">
                            <FormLabel className="text-foreground/90">الحالة الحالية</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl><SelectTrigger className="h-11 bg-background" dir="rtl"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent dir="rtl">
                                {STATUS_OPTIONS.map(o => (
                                  <SelectItem key={o.value} value={o.value}>
                                    <div className="flex items-center gap-2">
                                      <o.icon className={`h-4 w-4 ${o.cls}`} />
                                      {o.label}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      </div>

                      <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                        <Button type="submit" className="w-full sm:w-auto shadow-md" disabled={form.formState.isSubmitting}>
                          {form.formState.isSubmitting ? "جاري الحفظ..." : editingId ? "حفظ تعديلات البند" : "تأكيد إضافة البند"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              </DialogContent>
            </Dialog>
            )}
            </div>
          </CardHeader>

          {/* Desktop Table */}
          <CardContent className="min-w-0 max-w-full p-0 overflow-x-auto overscroll-x-contain hidden md:block" role="region" aria-label="جدول بنود الأعمال قابل للتمرير أفقياً" tabIndex={0}>
            {(() => {
              const allActs = activityRows;
              const groupMap = new Map<number | "ungrouped", (Activity & { groupId?: number | null })[]>();
              const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

              for (const g of sortedGroups) groupMap.set(g.id, []);
              groupMap.set("ungrouped", []);

              for (const a of allActs) {
                const gid = (a as any).groupId ?? "ungrouped";
                if (!groupMap.has(gid)) groupMap.set("ungrouped", [...(groupMap.get("ungrouped") ?? []), a]);
                else groupMap.get(gid)!.push(a);
              }
              const visibleGroups = sortedGroups.filter(group =>
                (groupFilter === "all" || groupFilter === group.id)
                && categoryGroupIds.has(group.id)
                && (statusFilter === "all" || (groupMap.get(group.id) ?? []).length > 0));
              const sortableRowIds = visibleGroups.flatMap<string | number>(group => [
                `group-${group.id}`,
                ...(collapsedGroups.has(group.id) ? [] : (groupMap.get(group.id) ?? []).map(row => row.id)),
              ]);
              if (!collapsedGroups.has("ungrouped")) {
                sortableRowIds.push(...(groupMap.get("ungrouped") ?? []).map(row => row.id));
              }

              const renderActivityRow = (a: Activity) => {
                const isBusy = updatingId === a.id;
                const planned = a.plannedProgress ?? 0;
                const deviation = a.actualProgress - planned;
                const delayInfo = calcActivityDelay(a);
                const editable = canEditActivity(a);
                const managed = isActivelyManagedActivity(a, groups);
                const source = getLinkedSource(a);
                return (
                  <SortableActivityRow key={a.id} id={a.id}>
                    <TableCell className="font-medium align-top">
                      <div className="flex min-w-0 items-start gap-2">
                        {!isViewer && <DragHandle />}
                        <div className="min-w-0 flex-1">
                          <span className="block whitespace-normal break-words [overflow-wrap:anywhere] leading-7 text-right" title={a.name}>{a.name}</span>
                          {managed && (
                            <div className="mt-1">
                              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">مُدار من مصدر مجموعة</Badge>
                            </div>
                          )}
                          {source && (
                            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">مرتبط</Badge>
                              {source.available ? (
                                <span className="min-w-0 whitespace-normal break-words text-muted-foreground" title={source.groupName ?? "مصدر مرتبط"}>
                                  {source.groupName ?? "مصدر مرتبط"}{(a as Activity & { externalSourceGroupId?: number | null }).externalSourceGroupId != null && source.projectName ? ` · ${source.projectName}` : ""}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3" /> المصدر غير متاح · القيم المحفوظة باقية
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
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
                    <TableCell>
                      <div className="min-w-0 space-y-1">
                        <ProgressBar value={planned} color="hsl(var(--muted-foreground)/0.4)" />
                        <ProgressBar value={a.actualProgress} color="hsl(var(--primary))" />
                        <div className={`flex min-w-0 items-center justify-end gap-0.5 whitespace-nowrap text-xs ${deviation < 0 ? 'text-destructive' : deviation > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {deviation < 0 ? <TrendingDown className="h-3 w-3 shrink-0" /> : deviation > 0 ? <TrendingUp className="h-3 w-3 shrink-0" /> : <Minus className="h-3 w-3 shrink-0" />}
                          <bdi dir="ltr" className="tabular-nums">{formatDisplayPercent(deviation, true)}</bdi>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[130px] whitespace-nowrap">
                      {editable && !managed ? (
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
                        {renderProgressButton(a)}
                        {renderWeightButton(a)}
                        {editable ? (
                          <>
                            {!source && !managed && <Button variant="outline" size="icon" className="h-7 w-7" title="تخفيض الإنجاز 5%" onClick={() => quickIncrement(a, -5)} disabled={updatingId !== null || a.actualProgress === 0}>
                              <span className="text-xs font-bold text-muted-foreground">-5</span>
                            </Button>}
                            {!source && !managed && <Button variant="outline" size="icon" className="h-7 w-7" title="رفع الإنجاز 5%" onClick={() => quickIncrement(a, 5)} disabled={updatingId !== null || a.actualProgress === 100}>
                              <span className="text-xs font-bold text-primary">+5</span>
                            </Button>}
                            {groups.length > 0 && !managed && (
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
                <DndContext sensors={sensors} collisionDetection={args => closestCenter({
                  ...args,
                  droppableContainers: args.droppableContainers.filter(container => {
                    if (String(args.active.id).startsWith("group-")) return String(container.id).startsWith("group-");
                    const active = activities?.find(row => row.id === args.active.id);
                    const target = activities?.find(row => row.id === container.id);
                    return !!active && !!target && ((active as Activity & { groupId?: number | null }).groupId ?? null)
                      === ((target as Activity & { groupId?: number | null }).groupId ?? null);
                  }),
                })} onDragEnd={handleDragEnd}>
                  <Table className="table-fixed min-w-[1280px]">
                    <colgroup>
                      <col />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 230 }} />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">البند</TableHead>
                        <TableHead className="text-right">الفترة المخططة</TableHead>
                        <TableHead className="text-center">التأخر / التقدم</TableHead>
                        <TableHead className="text-center">الإنجاز (مخطط/فعلي)</TableHead>
                        <TableHead className="text-right">الحالة</TableHead>
                        <TableHead className="text-center">إجراءات</TableHead>
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
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{!activities ? "لم تُحمّل البنود؛ لا يمكن تأكيد أن القائمة فارغة." : hasActiveFilters ? "لا توجد نتائج مطابقة للفلاتر الحالية" : "لا يوجد بنود — أضف أول بند"}</TableCell>
                        </TableRow>
                      ) : groups.length === 0 ? (
                        <SortableContext disabled={reorderActivities.isPending || reorderGroupsMutation.isPending} items={allActs.map(a => a.id)} strategy={verticalListSortingStrategy}>
                          {allActs.map(renderActivityRow)}
                        </SortableContext>
                      ) : (
                        <SortableContext disabled={reorderActivities.isPending || reorderGroupsMutation.isPending} items={sortableRowIds} strategy={verticalListSortingStrategy}>
                          {visibleGroups.map(g => {
                            const groupActs = groupMap.get(g.id) ?? [];
                            const isCollapsed = collapsedGroups.has(g.id);
                            const groupProgress = (() => {
                              if (groupActs.length === 0) return 0;
                              let s = 0, w = 0;
                              for (const a of groupActs) {
                                const ww = (a as any).weight && (a as any).weight > 0 ? (a as any).weight : 1;
                                s += (a.actualProgress ?? 0) * ww;
                                w += ww;
                              }
                              return w > 0 ? Math.round((s / w) * 10) / 10 : 0;
                            })();
                            return (
                              <React.Fragment key={g.id}>
                                <SortableGroupRow id={`group-${g.id}`}>
                                  <TableCell colSpan={4} onClick={() => toggleGroupCollapse(g.id)}>
                                    <div className="flex items-center gap-2">
                                      {!isViewer && <DragHandle />}
                                      {isCollapsed ? <ChevronLeft className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                      <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                                      <span className="font-semibold text-sm">{g.name}</span>
                                      <span className="text-xs text-muted-foreground">({groupActs.length} بند)</span>
                                       <span className="mr-2 text-xs text-muted-foreground"><bdi dir="ltr">{formatDisplayPercent(groupProgress)}</bdi></span>
                                    </div>
                                  </TableCell>
                                  <TableCell colSpan={2}>
                                    <div className="flex items-center justify-end gap-1">
                                       <div className="min-w-0 flex-1 max-w-[140px]">
                                        <ProgressBar value={groupProgress} color={g.color} />
                                      </div>
                                      {!isViewer && !isContractorBase && (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          title="تعديل المجموعة"
                                          onClick={(e) => { e.stopPropagation(); openEditGroupDialog(g); }}
                                        >
                                          <Edit2 className="h-3 w-3 text-muted-foreground" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6"
                                          title="حذف المجموعة"
                                          onClick={(e) => { e.stopPropagation(); setDeletingGroup(g); }}
                                        >
                                          <X className="h-3 w-3 text-muted-foreground" />
                                        </Button>
                                      </>
                                      )}
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
          <CardContent className="min-w-0 md:hidden space-y-3 px-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
                <span className="text-sm text-muted-foreground">جاري تحميل بنود الأعمال...</span>
              </div>
            ) : activityRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">{!activities ? "لم تُحمّل البنود؛ لا يمكن تأكيد أن القائمة فارغة." : hasActiveFilters ? "لا توجد نتائج مطابقة للفلاتر الحالية" : "لا يوجد بنود — أضف أول بند"}</div>
            ) : (() => {
              const allActs = activityRows;
              const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
              const groupMap = new Map<number | "ungrouped", Activity[]>();
              for (const g of sortedGroups) groupMap.set(g.id, []);
              groupMap.set("ungrouped", []);
              for (const a of allActs) {
                const gid = (a as any).groupId ?? "ungrouped";
                if (!groupMap.has(gid)) groupMap.get("ungrouped")!.push(a);
                else groupMap.get(gid)!.push(a);
              }
              const visibleGroups = sortedGroups.filter((group) =>
                (groupFilter === "all" || groupFilter === group.id) && categoryGroupIds.has(group.id) && (groupMap.get(group.id) ?? []).length > 0);

              const renderMobileCard = (a: Activity) => {
                const isBusy = updatingId === a.id;
                const planned = a.plannedProgress ?? 0;
                const deviation = a.actualProgress - planned;
                const delayInfo = calcActivityDelay(a);
                const editable = canEditActivity(a);
                const managed = isActivelyManagedActivity(a, groups);
                const source = getLinkedSource(a);
                return (
                  <div key={a.id} className={`min-w-0 rounded-lg border p-3 space-y-2.5 ${isBusy ? "opacity-60 pointer-events-none" : ""}`}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">
                        {a.name}
                        {managed && (
                          <span className="mt-1 block">
                            <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">مُدار من مصدر مجموعة</Badge>
                          </span>
                        )}
                        {source && (
                          <span className="mt-1 block break-words text-[10px] font-normal text-muted-foreground">
                            <Badge variant="secondary" className="me-1 h-4 px-1.5 text-[9px]">مرتبط</Badge>
                            {source.available
                              ? `${source.groupName ?? "مصدر مرتبط"}${(a as Activity & { externalSourceGroupId?: number | null }).externalSourceGroupId != null && source.projectName ? ` · ${source.projectName}` : ""}`
                              : <span className="text-amber-700 dark:text-amber-400">المصدر غير متاح؛ القيم المحفوظة باقية</span>}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums break-words">{fmtDate(a.plannedStartDate)} → {fmtDate(a.plannedEndDate)}</span>
                      <DelayBadge info={delayInfo} />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                        <span className="whitespace-nowrap text-muted-foreground">مخطط <bdi dir="ltr" className="tabular-nums">{formatDisplayPercent(planned)}</bdi></span>
                        <span className="whitespace-nowrap text-muted-foreground">فعلي <bdi dir="ltr" className="tabular-nums">{formatDisplayPercent(a.actualProgress)}</bdi></span>
                        <span className={deviation < 0 ? 'text-destructive font-medium' : deviation > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                          <bdi dir="ltr" className="tabular-nums">{formatDisplayPercent(deviation, true)}</bdi>
                        </span>
                      </div>
                      <ProgressBar value={a.actualProgress} color="hsl(var(--primary))" />
                    </div>
                    {editable ? (
                      <div className="flex flex-wrap items-center gap-1 pt-1 border-t">
                        <div className="flex flex-wrap items-center gap-1 mr-auto">
                          {renderProgressButton(a, true)}
                          {renderWeightButton(a, true)}
                          {!source && !managed && <Button variant="outline" size="icon" className="h-10 w-10" title="تخفيض الإنجاز 5%" aria-label="تخفيض الإنجاز 5%" onClick={() => quickIncrement(a, -5)} disabled={updatingId !== null || a.actualProgress === 0}>
                            <span className="text-xs font-bold text-muted-foreground">-5</span>
                          </Button>}
                          {!source && !managed && <Button variant="outline" size="icon" className="h-10 w-10" title="رفع الإنجاز 5%" aria-label="رفع الإنجاز 5%" onClick={() => quickIncrement(a, 5)} disabled={updatingId !== null || a.actualProgress === 100}>
                            <span className="text-xs font-bold text-primary">+5</span>
                          </Button>}
                          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`تعديل ${a.name}`} onClick={() => handleEdit(a)}>
                            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={`حذف ${a.name}`} onClick={() => setDeletingId(a.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 pt-1 border-t">
                        {renderProgressButton(a, true)}
                        {renderWeightButton(a, true)}
                        <span className="text-xs text-muted-foreground">عرض فقط</span>
                      </div>
                    )}
                  </div>
                );
              };

              if (groups.length === 0) return allActs.map(renderMobileCard);

              return (
                <>
                  {visibleGroups.map((g) => {
                    const groupOrderIndex = sortedGroups.findIndex(x => x.id === g.id);
                    const groupActs = groupMap.get(g.id) ?? [];
                    const isCollapsed = collapsedGroups.has(g.id);
                    const groupProgress = (() => {
                      if (groupActs.length === 0) return 0;
                      let s = 0, w = 0;
                      for (const a of groupActs) {
                        const ww = (a as any).weight && (a as any).weight > 0 ? (a as any).weight : 1;
                        s += (a.actualProgress ?? 0) * ww;
                        w += ww;
                      }
                      return w > 0 ? Math.round((s / w) * 10) / 10 : 0;
                    })();
                    const moveGroup = (dir: -1 | 1) => {
                      const currentIdx = sortedGroups.findIndex(x => x.id === g.id);
                      const newIdx = currentIdx + dir;
                      if (newIdx < 0 || newIdx >= sortedGroups.length) return;
                      const reordered = arrayMove([...sortedGroups], currentIdx, newIdx);
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
                              className="flex h-9 w-9 items-center justify-center rounded hover:bg-black/10 disabled:opacity-30"
                              aria-label={`نقل مجموعة ${g.name} للأعلى`}
                              disabled={isViewer || groupOrderIndex === 0 || reorderGroupsMutation.isPending}
                              onClick={() => moveGroup(-1)}
                            >
                              <ChevronDown className="h-3 w-3 rotate-180" />
                            </button>
                            <button
                              className="flex h-9 w-9 items-center justify-center rounded hover:bg-black/10 disabled:opacity-30"
                              aria-label={`نقل مجموعة ${g.name} للأسفل`}
                              disabled={isViewer || groupOrderIndex === sortedGroups.length - 1 || reorderGroupsMutation.isPending}
                              onClick={() => moveGroup(1)}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </div>
                          <button
                            className="flex min-h-11 items-center gap-1 flex-1 min-w-0"
                            aria-expanded={!isCollapsed}
                            aria-label={`عرض بنود مجموعة ${g.name}`}
                            onClick={() => toggleGroupCollapse(g.id)}
                          >
                            {isCollapsed ? <ChevronLeft className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                            <span className="font-semibold text-sm flex-1 text-right truncate">{g.name}</span>
                            <span className="hidden text-xs text-muted-foreground shrink-0 min-[390px]:inline">{groupActs.length} بند</span>
                            <span dir="ltr" className="shrink-0 text-xs font-medium tabular-nums">{formatDisplayPercent(groupProgress)}</span>
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
        )}
      </div>

      <ActivityProgressDialog
        activity={progressActivity}
        saving={updatingId !== null}
        onClose={() => setProgressActivity(null)}
        onSave={async progress => {
          if (progressActivity && await setActivityProgress(progressActivity, progress)) {
            setProgressActivity(null);
            toast({ title: "تم تحديد نسبة الإنجاز" });
          }
        }}
      />
      <ActivityWeightDialog
        activity={weightActivity}
        saving={updatingId !== null}
        onClose={() => setWeightActivity(null)}
        onSave={async weight => {
          if (weightActivity && await setActivityWeight(weightActivity, weight)) {
            setWeightActivity(null);
            toast({ title: "تم تحديث الوزن النوعي" });
          }
        }}
      />

      {!isViewer && !isContractorBase && (
      <Dialog open={isGroupDialogOpen} onOpenChange={(open) => {
        setIsGroupDialogOpen(open);
        if (!open) setEditingGroupId(null);
      }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] min-w-0 sm:max-w-[500px] p-0 overflow-y-auto" dir="rtl">
          <div className="bg-muted/30 p-6 pb-4 border-b border-border/50">
            <DialogHeader>
              <DialogTitle className="text-xl">{editingGroupId ? "تعديل المجموعة" : "إضافة مجموعة جديدة"}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {editingGroupId ? "عدّل بيانات المجموعة دون تغيير بنودها أو الروابط المرتبطة بها." : "قم بإنشاء مجموعة جديدة لتنظيم بنود الأعمال الخاصة بالمشروع."}
              </p>
            </DialogHeader>
          </div>
          <div className="min-w-0 p-4 pt-4 space-y-6 sm:p-6">
            <div className="p-5 rounded-2xl border bg-muted/20 shadow-sm space-y-5">
              <div>
                <label className="text-sm font-semibold mb-2 block text-foreground/90">اسم المجموعة</label>
                <Input className="h-11 bg-background" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="مثال: الأعمال الخرسانية" />
              </div>
              <div>
                <label className="text-sm font-semibold mb-2 block text-foreground/90">لون المجموعة</label>
                <div className="flex flex-wrap gap-3">
                  {GROUP_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`w-9 h-9 rounded-full border-2 transition-all shadow-sm ${newGroupColor === c.value ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => setNewGroupColor(c.value)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold mb-2 block text-foreground/90">رمز الربط (اختياري)</label>
                <Input
                  className="h-11 bg-background"
                  value={newGroupLinkCode}
                  onChange={e => setNewGroupLinkCode(e.target.value)}
                  placeholder="رمز فريد لمشاركة مصدر الإنجاز"
                  dir="ltr"
                />
                <p className="mt-1 text-xs text-muted-foreground">يتيح هذا الرمز للمشاريع الأخرى ربط بنودها بهذه المجموعة.</p>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsGroupDialogOpen(false)}>إلغاء</Button>
              <Button
                className="w-full sm:w-auto shadow-md"
                disabled={!newGroupName.trim() || createGroup.isPending || updateGroup.isPending}
                onClick={() => editingGroupId
                  ? updateGroup.mutate({ id: editingGroupId, name: newGroupName.trim(), color: newGroupColor, linkCode: newGroupLinkCode.trim() || null })
                  : createGroup.mutate({ name: newGroupName.trim(), color: newGroupColor, linkCode: newGroupLinkCode.trim() || null })}
              >
                {createGroup.isPending || updateGroup.isPending ? "جاري الحفظ..." : editingGroupId ? "حفظ التغييرات" : "تأكيد وإنشاء"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {!isViewer && !isContractorBase && (
      <AlertDialog open={!!deletingGroup} onOpenChange={(open) => { if (!open) setDeletingGroup(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف مجموعة {deletingGroup?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              {(groupCounts.counts.get(deletingGroup?.id ?? -1) ?? 0) > 0
                ? "لا يمكن حذف هذه المجموعة قبل نقل أو حذف البنود الموجودة داخلها. لن تُنقل البنود أو تُحذف تلقائياً."
                : "هذه المجموعة فارغة. هل تريد حذفها؟ لا يمكن التراجع عن الحذف، وستظهر روابطها في المشاريع الأخرى كمصدر غير متاح إن وُجدت."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            {(groupCounts.counts.get(deletingGroup?.id ?? -1) ?? 0) === 0 && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteGroup.isPending}
                onClick={() => { if (deletingGroup) deleteGroup.mutate(deletingGroup.id); }}
              >
                {deleteGroup.isPending ? "جاري الحذف..." : "حذف المجموعة الفارغة"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}

      {!isContractorBase && (
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
      )}
    </div>
  );
}

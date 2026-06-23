import { useState, useEffect } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useListProjects, useCreateProject, useUpdateProject, useDeleteProject, getListProjectsQueryKey, getGetProjectQueryKey, getGetProjectSummaryQueryKey, getProject, getProjectSummary } from "@workspace/api-client-react";
import type { Project } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Search, Building2, MapPin, Calendar, Edit2, Trash2, CalendarOff, Folder, FolderOpen, ChevronRight, ArrowUp, Loader2, FlaskConical, X, FileText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

async function authFetchJson(url: string) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  // Surface a renewed session token to the central saver so this manual
  // fetch keeps the rolling session alive too.
  const renewed = res.headers.get("X-Renewed-Token");
  if (renewed && renewed !== token) {
    try {
      localStorage.setItem("auth_token", renewed);
      window.dispatchEvent(new CustomEvent("auth-token-renewed", { detail: renewed }));
    } catch { /* ignore */ }
  }
  if (res.status === 401) {
    // Let the central handler clear credentials and redirect to /login,
    // instead of silently rendering an empty list as if the user simply
    // had no data.
    try {
      const here = window.location.pathname + window.location.search;
      if (!here.endsWith("/login")) sessionStorage.setItem("auth_return_to", here);
      sessionStorage.setItem("auth_session_expired", "1");
    } catch { /* ignore */ }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user_cache");
    window.location.assign((import.meta.env.BASE_URL.replace(/\/$/, "") || "") + "/login");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface CompanyOption {
  id: number;
  name: string;
  type: "owner" | "contractor" | "supervisor";
  logoUrl: string | null;
}

const projectSchema = z.object({
  name: z.string().min(1, "اسم المشروع مطلوب"),
  location: z.string().min(1, "الموقع مطلوب"),
  ownerEntity: z.string().min(1, "الجهة المالكة مطلوبة"),
  supervisorEntity: z.string().min(1, "الجهة المشرفة مطلوبة"),
  contractor: z.string().min(1, "المقاول مطلوب"),
  noSchedule: z.boolean().default(false),
  startDate: z.string().optional().default(""),
  expectedEndDate: z.string().optional().default(""),
  status: z.enum(["active", "completed", "delayed", "suspended"]).default("active"),
  ownerCompanyId: z.string().optional(),
  contractorCompanyId: z.string().optional(),
  supervisorCompanyId: z.string().optional(),
  onedriveTestResultsFolderId: z.string().optional(),
}).refine((data) => {
  if (data.noSchedule) return true;
  return !!data.startDate && data.startDate.length > 0;
}, {
  message: "تاريخ البداية مطلوب",
  path: ["startDate"],
}).refine((data) => {
  if (data.noSchedule) return true;
  return !!data.expectedEndDate && data.expectedEndDate.length > 0;
}, {
  message: "تاريخ النهاية المتوقع مطلوب",
  path: ["expectedEndDate"],
}).refine((data) => {
  if (data.noSchedule) return true;
  if (!data.startDate || !data.expectedEndDate) return true;
  return data.expectedEndDate >= data.startDate;
}, {
  message: "تاريخ النهاية يجب أن يكون بعد تاريخ البداية",
  path: ["expectedEndDate"],
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export default function Projects() {
  usePageTitle("المشاريع");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [folderBrowserItems, setFolderBrowserItems] = useState<any[]>([]);
  const [folderBrowserLoading, setFolderBrowserLoading] = useState(false);
  const [folderBrowserParentId, setFolderBrowserParentId] = useState<string | null>(null);
  const [folderBrowserCurrentId, setFolderBrowserCurrentId] = useState<string>("root");
  const [folderBrowserPath, setFolderBrowserPath] = useState<{id: string; name: string}[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Companies barely change during a working session — trust the cache for
  // 10 minutes so opening / re-opening the projects screen doesn't trip a
  // network round-trip just to populate the dialog dropdowns.
  const { data: companies = [] } = useQuery<CompanyOption[]>({
    queryKey: ["companies"],
    queryFn: () => authFetchJson(`${API_BASE}/companies`),
    staleTime: 1000 * 60 * 10,
  });

  const ownerCompanies = companies.filter(c => c.type === "owner");
  const contractorCompanies = companies.filter(c => c.type === "contractor");
  const supervisorCompanies = companies.filter(c => c.type === "supervisor");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { user } = useAuth();
  const canManageProjects = user?.role === "admin" || user?.role === "project_manager";
  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;
  const getProjectLink = (projectId: number) => `/projects/${projectId}`;

  // Prefetch a project's core data the moment the user hovers/touches its
  // card. By the time the click navigates to the details screen, the data
  // is usually already in the React Query cache, making the transition
  // feel instant. Throttled by `staleTime` so it never fires twice in a row.
  const prefetchProject = (projectId: number) => {
    queryClient.prefetchQuery({
      queryKey: getGetProjectQueryKey(projectId),
      queryFn: ({ signal }) => getProject(projectId, { signal }),
      staleTime: 1000 * 60 * 5,
    });
    queryClient.prefetchQuery({
      queryKey: getGetProjectSummaryQueryKey(projectId),
      queryFn: ({ signal }) => getProjectSummary(projectId, { signal }),
      staleTime: 1000 * 60 * 5,
    });
  };

  // `placeholderData` keeps the previous list visible while a new search
  // / filter request is in flight, so typing in the search box (or
  // changing the status filter) no longer wipes the cards to a spinner
  // for every keystroke. `staleTime` of 5 min prevents revisits to the
  // page from re-fetching when the underlying data hasn't changed.
  const { data: projects, isLoading } = useListProjects(
    {
      search: debouncedSearch || undefined,
      status: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
    },
    {
      query: {
        staleTime: 1000 * 60 * 5,
        placeholderData: (prev: any) => prev,
      } as any,
    },
  );

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      location: "",
      ownerEntity: "",
      supervisorEntity: "",
      contractor: "",
      noSchedule: false,
      startDate: new Date().toISOString().split('T')[0],
      expectedEndDate: new Date(Date.now() + 31536000000).toISOString().split('T')[0],
      status: "active",
      ownerCompanyId: "",
      contractorCompanyId: "",
      supervisorCompanyId: "",
    }
  });

  const watchNoSchedule = form.watch("noSchedule");

  const browseFolders = async (folderId?: string) => {
    setFolderBrowserLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const url = folderId
        ? `${API_BASE}/onedrive/browse?folderId=${folderId}`
        : `${API_BASE}/onedrive/browse`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setFolderBrowserItems(data.items || []);
      setFolderBrowserParentId(data.parentId);
      setFolderBrowserCurrentId(data.currentFolderId);
    } catch {
      toast({ title: "حدث خطأ أثناء تصفح OneDrive", variant: "destructive" });
    } finally {
      setFolderBrowserLoading(false);
    }
  };

  const openFolderBrowser = () => {
    setFolderBrowserPath([]);
    setFolderBrowserItems([]);
    setFolderBrowserParentId(null);
    setFolderBrowserCurrentId("root");
    setFolderBrowserOpen(true);
    browseFolders();
  };

  const navigateToFolder = (folderId: string, folderName: string) => {
    setFolderBrowserPath(prev => [...prev, { id: folderId, name: folderName }]);
    browseFolders(folderId);
  };

  const navigateUp = () => {
    if (folderBrowserPath.length <= 1) {
      setFolderBrowserPath([]);
      browseFolders();
    } else {
      const newPath = folderBrowserPath.slice(0, -1);
      setFolderBrowserPath(newPath);
      browseFolders(newPath[newPath.length - 1].id);
    }
  };

  const selectFolder = (folderId: string) => {
    form.setValue("onedriveTestResultsFolderId", folderId);
    setFolderBrowserOpen(false);
  };

  const handleCompanySelect = (companyId: string, field: "ownerEntity" | "contractor" | "supervisorEntity") => {
    const company = companies.find(c => String(c.id) === companyId);
    if (company) {
      form.setValue(field, company.name);
    }
  };

  const openEdit = (p: Project) => {
    setEditingProject(p);
    const isNoSchedule = p.noSchedule === true;
    form.reset({
      name: p.name,
      location: p.location,
      ownerEntity: p.ownerEntity,
      supervisorEntity: p.supervisorEntity,
      contractor: p.contractor,
      noSchedule: isNoSchedule,
      startDate: p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : "",
      expectedEndDate: p.expectedEndDate ? new Date(p.expectedEndDate).toISOString().split('T')[0] : "",
      status: p.status as ProjectFormValues["status"],
      ownerCompanyId: (p as any).ownerCompanyId ? String((p as any).ownerCompanyId) : "",
      contractorCompanyId: (p as any).contractorCompanyId ? String((p as any).contractorCompanyId) : "",
      supervisorCompanyId: (p as any).supervisorCompanyId ? String((p as any).supervisorCompanyId) : "",
      onedriveTestResultsFolderId: (p as any).onedriveTestResultsFolderId || "",
    });
    setIsDialogOpen(true);
  };

  const openCreate = () => {
    setEditingProject(null);
    form.reset({
      name: "", location: "", ownerEntity: "", supervisorEntity: "",
      contractor: "",
      noSchedule: false,
      startDate: new Date().toISOString().split('T')[0],
      expectedEndDate: new Date(Date.now() + 31536000000).toISOString().split('T')[0],
      status: "active",
      ownerCompanyId: "",
      contractorCompanyId: "",
      supervisorCompanyId: "",
      onedriveTestResultsFolderId: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (values: ProjectFormValues) => {
    try {
      if (editingProject) {
        await updateProject.mutateAsync({ id: editingProject.id, data: values });
        toast({ title: "تم تحديث المشروع بنجاح" });
      } else {
        await createProject.mutateAsync({ data: values });
        toast({ title: "تم إنشاء المشروع بنجاح" });
      }
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      setEditingProject(null);
    } catch {
      toast({ variant: "destructive", title: editingProject ? "فشل تحديث المشروع" : "فشل إنشاء المشروع" });
    }
  };

  const confirmDelete = async () => {
    if (!deletingProject) return;
    try {
      await deleteProject.mutateAsync({ id: deletingProject.id });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: "تم حذف المشروع بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل حذف المشروع" });
    } finally {
      setDeletingProject(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="default" className="bg-primary hover:bg-primary text-white">نشط</Badge>;
      case 'completed': return <Badge variant="secondary" className="bg-emerald-500 hover:bg-emerald-600 text-white">مكتمل</Badge>;
      case 'delayed': return <Badge variant="destructive">منحرف عن الخطة</Badge>;
      case 'suspended': return <Badge variant="outline" className="bg-orange-500 text-white hover:bg-orange-600 border-none">متوقف</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isSubmitting = createProject.isPending || updateProject.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 rounded-xl">
            <Building2 className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold">المشاريع</h1>
            <p className="text-sm text-muted-foreground mt-0.5">إدارة ومتابعة جميع المشاريع</p>
          </div>
        </div>
        
        {canManageProjects && (
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            مشروع جديد
          </Button>
        )}

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) { setEditingProject(null); form.reset(); }
        }}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden p-0" dir="rtl">
            <div className="bg-gradient-to-br from-blue-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-xl">
                    <Building2 className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">{editingProject ? "تعديل بيانات المشروع" : "إضافة مشروع جديد"}</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {editingProject ? "قم بتحديث بيانات المشروع والجهات المشاركة فيه." : "أدخل تفاصيل المشروع الجديد لتتبعه في النظام."}
                    </p>
                  </div>
                </div>
              </DialogHeader>
            </div>

            <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="px-6 py-4 space-y-8">
                  
                  {/* Section 1: Basic Info */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      البيانات الأساسية
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">اسم المشروع</FormLabel>
                            <FormControl><Input {...field} className="h-11 bg-background" placeholder="أدخل اسم المشروع" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="location"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">موقع المشروع</FormLabel>
                            <FormControl><Input {...field} className="h-11 bg-background" placeholder="مثال: الرياض، حي الملقا" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                          <FormItem className="sm:col-span-2">
                            <FormLabel className="text-foreground/90">حالة المشروع</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange} dir="rtl">
                              <FormControl>
                                <SelectTrigger className="h-11 bg-background"><SelectValue /></SelectTrigger>
                              </FormControl>
                              <SelectContent dir="rtl">
                                <SelectItem value="active">نشط (قيد التنفيذ)</SelectItem>
                                <SelectItem value="completed">مكتمل</SelectItem>
                                <SelectItem value="delayed">منحرف عن الخطة</SelectItem>
                                <SelectItem value="suspended">متوقف</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Section 2: Parties */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      الجهات المشاركة
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                      <div className="sm:col-span-2 p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="ownerCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">الجهة المالكة</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "ownerEntity"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر شركة..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {ownerCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="ownerEntity"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المالك كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="contractorCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">المقاول</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "contractor"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر مقاول..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {contractorCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="contractor"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المقاول كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="p-4 rounded-xl border bg-background shadow-sm space-y-4">
                        <FormField
                          control={form.control}
                          name="supervisorCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-foreground/90">الاستشاري المشرف</FormLabel>
                              <Select value={field.value || ""} onValueChange={(v) => { field.onChange(v); handleCompanySelect(v, "supervisorEntity"); }} dir="rtl">
                                <FormControl><SelectTrigger className="h-11"><SelectValue placeholder="اختر استشاري..." /></SelectTrigger></FormControl>
                                <SelectContent dir="rtl">
                                  <SelectItem value="none">— إدخال يدوي —</SelectItem>
                                  {supervisorCompanies.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="supervisorEntity"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl><Input {...field} placeholder="اسم المشرف كتابة" /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Integrations & Dates */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      الجدول الزمني والربط
                    </h3>
                    
                    <div className="p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm space-y-5">
                      <FormField
                        control={form.control}
                        name="noSchedule"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-xl border bg-background p-4 gap-3 shadow-sm hover:border-primary/30 transition-colors">
                            <div className="space-y-0.5 flex-1 min-w-0">
                              <FormLabel className="text-sm font-semibold flex items-center gap-2">
                                <CalendarOff className="h-4 w-4 text-primary shrink-0" />
                                بدون جدول زمني معتمد
                              </FormLabel>
                              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                                عند التفعيل، لن يُحسب الانحراف الزمني أو التأخيرات، وتصبح تواريخ البداية والنهاية اختيارية تماماً.
                              </p>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                  field.onChange(checked);
                                  if (checked) {
                                    form.setValue("startDate", "");
                                    form.setValue("expectedEndDate", "");
                                  } else {
                                    form.setValue("startDate", new Date().toISOString().split('T')[0]);
                                    form.setValue("expectedEndDate", new Date(Date.now() + 31536000000).toISOString().split('T')[0]);
                                  }
                                }}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      {!watchNoSchedule && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border bg-background shadow-sm">
                          <FormField
                            control={form.control}
                            name="startDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/90">تاريخ البداية الفعلي</FormLabel>
                                <FormControl><Input type="date" {...field} className="h-11" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="expectedEndDate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-foreground/90">تاريخ النهاية المتوقع</FormLabel>
                                <FormControl><Input type="date" {...field} className="h-11" /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}

                      <FormField
                        control={form.control}
                        name="onedriveTestResultsFolderId"
                        render={({ field }) => (
                          <FormItem className="p-4 rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm">
                            <FormLabel className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-500 mb-3 font-semibold">
                              <FlaskConical className="h-4 w-4" />
                              الربط السحابي لنتائج الاختبارات (OneDrive)
                            </FormLabel>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} placeholder="لم يتم اختيار مجلد لنتائج الاختبارات" dir="ltr" className="text-left text-sm flex-1 bg-background" readOnly />
                              </FormControl>
                              <Button type="button" variant="outline" onClick={openFolderBrowser} className="shrink-0 gap-1.5 bg-background">
                                <FolderOpen className="h-4 w-4" />
                                تصفح
                              </Button>
                              {field.value && (
                                <Button type="button" variant="ghost" size="icon" onClick={() => form.setValue("onedriveTestResultsFolderId", "")} className="shrink-0 text-muted-foreground hover:text-red-500 bg-background border shadow-sm">
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء والتراجع</Button>
                    <Button type="submit" className="w-full sm:w-auto shadow-md" disabled={isSubmitting}>
                      {isSubmitting ? "جاري الحفظ..." : editingProject ? "حفظ تعديلات المشروع" : "تأكيد إضافة المشروع"}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="بحث عن مشروع..." 
            className="pr-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v)}>
            <SelectTrigger>
              <SelectValue placeholder="حالة المشروع" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="active">نشط</SelectItem>
              <SelectItem value="completed">مكتمل</SelectItem>
              <SelectItem value="delayed">منحرف عن الخطة</SelectItem>
              <SelectItem value="suspended">متوقف</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner text="جاري تحميل المشاريع..." />
      ) : projects?.length === 0 ? (
        <Card className="border-dashed">
          <EmptyState
            icon={<Building2 className="h-7 w-7 text-muted-foreground/60" />}
            title="لا توجد مشاريع"
            description="لم يتم العثور على مشاريع مطابقة للبحث"
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects?.map((project) => (
            <Card
              key={project.id}
              className="hover:shadow-md transition-shadow flex flex-col h-full"
              onMouseEnter={() => prefetchProject(project.id)}
              onTouchStart={() => prefetchProject(project.id)}
            >
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-lg line-clamp-2 flex-1">
                    <Link href={getProjectLink(project.id)} className="hover:text-primary transition-colors">
                      {project.name}
                    </Link>
                  </CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    {getStatusBadge(project.status)}
                    {canManageProjects && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(project)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeletingProject(project)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{project.location}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">المالك: {project.ownerEntity}</span>
                  </div>
                  {project.noSchedule ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CalendarOff className="h-4 w-4 shrink-0" />
                      <span className="text-xs">بدون جدول زمني معتمد</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4 shrink-0" />
                      <span>النهاية: <span className="font-mono">{fmtDate(project.expectedEndDate)}</span></span>
                    </div>
                  )}
                </div>
                
                <div className="space-y-1.5 mt-auto pt-4">
                  <div className="flex justify-between text-sm font-medium">
                    <span>نسبة الإنجاز</span>
                    <span>%{(project.overallProgress ?? 0).toFixed(1)}</span>
                  </div>
                  <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${project.overallProgress < 30 ? 'bg-destructive' : project.overallProgress < 70 ? 'bg-orange-500' : 'bg-emerald-500'}`}
                      style={{ width: `${project.overallProgress}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deletingProject} onOpenChange={(open) => { if (!open) setDeletingProject(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المشروع</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف مشروع "{deletingProject?.name}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteProject.isPending}
            >
              {deleteProject.isPending ? "جاري الحذف..." : "حذف المشروع"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={folderBrowserOpen} onOpenChange={setFolderBrowserOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-emerald-600" />
              اختيار مجلد من OneDrive
            </DialogTitle>
          </DialogHeader>

          {folderBrowserPath.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <button type="button" onClick={() => { setFolderBrowserPath([]); browseFolders(); }} className="hover:text-foreground hover:underline">
                OneDrive
              </button>
              {folderBrowserPath.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 rotate-180" />
                  <button
                    type="button"
                    onClick={() => {
                      const newPath = folderBrowserPath.slice(0, i + 1);
                      setFolderBrowserPath(newPath);
                      browseFolders(p.id);
                    }}
                    className="hover:text-foreground hover:underline"
                  >
                    {p.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="border rounded-lg max-h-[350px] overflow-y-auto">
            {folderBrowserLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
              </div>
            ) : folderBrowserItems.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                لا توجد عناصر في هذا المجلد
              </div>
            ) : (
              <div className="divide-y">
                {folderBrowserPath.length > 0 && (
                  <button
                    type="button"
                    onClick={navigateUp}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-right"
                  >
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">..</span>
                  </button>
                )}
                {folderBrowserItems.filter(i => i.isFolder).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
                    <button
                      type="button"
                      onClick={() => navigateToFolder(item.id, item.name)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-right"
                    >
                      <Folder className="h-5 w-5 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.childCount} عنصر</p>
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => selectFolder(item.id)}
                      className="shrink-0 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                    >
                      اختيار
                    </Button>
                  </div>
                ))}
                {folderBrowserItems.filter(i => !i.isFolder).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 opacity-50">
                    <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                    <p className="text-sm truncate">{item.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {folderBrowserCurrentId !== "root" && (
            <Button
              type="button"
              onClick={() => selectFolder(folderBrowserCurrentId)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              اختيار المجلد الحالي
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

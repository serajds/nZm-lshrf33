import { useMemo, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { 
  useListUsers, 
  useCreateUser, 
  useUpdateUser, 
  useDeleteUser,
  useListProjects,
  useListProjectMembers,
  useAddProjectMember,
  useUpdateProjectMember,
  useUpdateMemberTabPermissions,
  useUpdateMemberGroups,
  listProjectMembers,
  getListUsersQueryKey,
  getGetIncompleteUsersCountQueryKey,
  getListProjectMembersQueryKey,
  getGetMemberTabPermissionsQueryKey,
  getGetMyProjectPermissionsQueryKey,
} from "@workspace/api-client-react";
import type { User, UpdateUserBody, CreateUserBody, CreateUserBodyRole, TabPermissionsMap, TabAccess } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Edit2, Trash2, Users as UsersIcon, Building2, UserX, AlertTriangle, FolderKanban, Zap } from "lucide-react";
import { LoadingSpinner, EmptyState } from "@/components/ui/loading-spinner";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

const API = import.meta.env.VITE_API_URL || "/api";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

interface Company {
  id: number;
  name: string;
  type: string;
}

const QUICK_TAB_DEFS: { key: keyof TabPermissionsMap; label: string }[] = [
  { key: "overview", label: "ملخص المشروع" },
  { key: "activities", label: "الجدول الزمني" },
  { key: "extensions", label: "التمديدات" },
  { key: "suspensions", label: "التوقفات" },
  { key: "reports", label: "التقارير" },
  { key: "forms", label: "النماذج" },
  { key: "attendance", label: "الحضور" },
  { key: "files", label: "الملفات" },
  { key: "deviation", label: "تحليل الانحراف" },
];

const QUICK_TAB_ACCESS_OPTIONS: { value: "hidden" | "view" | "edit"; label: string }[] = [
  { value: "hidden", label: "مخفي" },
  { value: "view", label: "مشاهدة" },
  { value: "edit", label: "تعديل" },
];

const userSchema = z.object({
  fullName: z.string().min(1, "الاسم الكامل مطلوب"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  role: z.enum(["admin", "project_manager", "engineer"]),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل").optional().or(z.literal('')),
  companyIds: z.array(z.number()).optional(),
  projectIds: z.array(z.number()).optional(),
});

export default function Users() {
  usePageTitle("المستخدمين");
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<"all" | "incomplete">("all");
  // Quick-assign popup state: lets the admin pick one company + one project
  // for a given user from the row, without opening the full edit dialog.
  // Selected values are merged with the user's existing assignments.
  const [quickAssignUserId, setQuickAssignUserId] = useState<number | null>(null);
  const [quickCompanyId, setQuickCompanyId] = useState<string>("");
  const [quickProjectId, setQuickProjectId] = useState<string>("");
  const [quickRole, setQuickRole] = useState<"project_manager" | "engineer" | "contractor" | "viewer">("engineer");
  const [quickCustomizeTabs, setQuickCustomizeTabs] = useState<boolean>(false);
  const [quickTabDraft, setQuickTabDraft] = useState<Record<string, "hidden" | "view" | "edit">>({});
  const [quickGroupIds, setQuickGroupIds] = useState<number[]>([]);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users, isLoading } = useListUsers();

  const incompleteCount = useMemo(
    () => (users || []).filter((u) => u.incompleteProfile).length,
    [users],
  );

  const filteredUsers = useMemo<User[]>(() => {
    if (!users) return [];
    if (filter === "incomplete") return users.filter((u) => u.incompleteProfile);
    return users;
  }, [users, filter]);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const addProjectMember = useAddProjectMember();
  const updateProjectMember = useUpdateProjectMember();
  const updateMemberTabPermissions = useUpdateMemberTabPermissions();
  const updateMemberGroups = useUpdateMemberGroups();

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies"],
    queryFn: async () => {
      const res = await authFetch(`${API}/companies`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: projectsList = [] } = useListProjects();

  // Projects filtered by the chosen company in the Quick Assign dialog.
  // Server returns ownerCompanyId/contractorCompanyId/supervisorCompanyId on each
  // row even though the generated schema omits them.
  const quickFilteredProjects = useMemo(() => {
    if (!quickCompanyId) return projectsList;
    const cid = parseInt(quickCompanyId, 10);
    if (!Number.isFinite(cid)) return projectsList;
    return projectsList.filter((p) => {
      const anyP = p as any;
      return (
        anyP.ownerCompanyId === cid ||
        anyP.contractorCompanyId === cid ||
        anyP.supervisorCompanyId === cid
      );
    });
  }, [projectsList, quickCompanyId]);

  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      fullName: "",
      phone: "",
      role: "engineer",
      password: "",
      companyIds: [],
      projectIds: [],
    }
  });

  if (user?.role !== "admin") {
    setLocation("/");
    return null;
  }

  const handleEdit = (u: User) => {
    setEditingUserId(u.id);
    const cIds = u.companies?.map((c) => c.companyId) || [];
    const pIds = u.projects?.map((p) => p.projectId) || [];
    setSelectedCompanyIds(cIds);
    setSelectedProjectIds(pIds);
    const formRole: "admin" | "project_manager" | "engineer" =
      u.role === "admin" || u.role === "project_manager" ? u.role : "engineer";
    form.reset({
      fullName: u.fullName,
      phone: u.phone,
      role: formRole,
      password: "",
      companyIds: cIds,
      projectIds: pIds,
    });
    setIsDialogOpen(true);
  };

  const handleOpenNew = () => {
    setEditingUserId(null);
    setSelectedCompanyIds([]);
    setSelectedProjectIds([]);
    form.reset({
      fullName: "",
      phone: "",
      role: "engineer",
      password: "",
      companyIds: [],
      projectIds: [],
    });
    setIsDialogOpen(true);
  };

  const quickAssignUser = useMemo(
    () => (users || []).find((u) => u.id === quickAssignUserId) || null,
    [users, quickAssignUserId],
  );

  const quickProjectIdNum = quickProjectId ? parseInt(quickProjectId, 10) : NaN;
  const { data: quickProjectMembers = [] } = useListProjectMembers(
    Number.isFinite(quickProjectIdNum) ? quickProjectIdNum : 0,
    { query: { enabled: Number.isFinite(quickProjectIdNum) && quickProjectIdNum > 0 } },
  );
  const existingMember = useMemo(() => {
    if (!quickAssignUser) return undefined;
    return quickProjectMembers.find((m) => m.userId === quickAssignUser.id);
  }, [quickProjectMembers, quickAssignUser]);

  const { data: quickProjectGroups = [] } = useQuery<{ id: number; name: string; color: string; sortOrder: number }[]>({
    queryKey: [`/api/projects/${quickProjectIdNum}/activity-groups`],
    queryFn: async () => {
      const r = await authFetch(`${API}/projects/${quickProjectIdNum}/activity-groups`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: Number.isFinite(quickProjectIdNum) && quickProjectIdNum > 0,
  });
  const sortedQuickGroups = useMemo(
    () => [...quickProjectGroups].sort((a, b) => a.sortOrder - b.sortOrder),
    [quickProjectGroups],
  );

  const openQuickAssign = (u: User) => {
    setQuickAssignUserId(u.id);
    setQuickCompanyId("");
    setQuickProjectId("");
    setQuickRole("engineer");
    setQuickCustomizeTabs(false);
    setQuickTabDraft({});
    setQuickGroupIds([]);
  };

  const closeQuickAssign = () => {
    setQuickAssignUserId(null);
    setQuickCompanyId("");
    setQuickProjectId("");
    setQuickRole("engineer");
    setQuickCustomizeTabs(false);
    setQuickTabDraft({});
    setQuickGroupIds([]);
  };

  const handleQuickAssign = async () => {
    if (!quickAssignUser) return;
    const cidNum = quickCompanyId ? parseInt(quickCompanyId, 10) : NaN;
    const pidNum = quickProjectId ? parseInt(quickProjectId, 10) : NaN;
    const existingCompanyIds = (quickAssignUser.companies || []).map((c) => c.companyId);
    const existingProjectIds = (quickAssignUser.projects || []).map((p) => p.projectId);

    const nextCompanyIds = Number.isFinite(cidNum) && !existingCompanyIds.includes(cidNum)
      ? [...existingCompanyIds, cidNum]
      : existingCompanyIds;
    const nextProjectIds = Number.isFinite(pidNum) && !existingProjectIds.includes(pidNum)
      ? [...existingProjectIds, pidNum]
      : existingProjectIds;

    const hasUserAssignmentChanges =
      nextCompanyIds.length !== existingCompanyIds.length ||
      nextProjectIds.length !== existingProjectIds.length;
    const hasProjectMembership = Number.isFinite(pidNum);

    if (!hasUserAssignmentChanges && !hasProjectMembership) {
      toast({ variant: "destructive", title: "اختر شركة أو مشروع للتعيين" });
      return;
    }

    try {
      // 1) Update user-level company/project assignments (additive)
      if (hasUserAssignmentChanges) {
        await updateUser.mutateAsync({
          id: quickAssignUser.id,
          data: { companyIds: nextCompanyIds, projectIds: nextProjectIds },
        });
      }

      // 2) Add or update the user's project membership with chosen role.
      // updateUser above may have auto-created a project_members row, so we
      // try add first and fall back to update on 409 (already a member).
      let memberId: number | undefined = existingMember?.id;
      if (hasProjectMembership) {
        const groupsForRole = quickRole === "engineer" ? quickGroupIds : undefined;
        if (existingMember) {
          await updateProjectMember.mutateAsync({
            projectId: pidNum,
            id: existingMember.id,
            data: { role: quickRole, assignedGroupIds: groupsForRole },
          });
          memberId = existingMember.id;
        } else {
          try {
            const created = await addProjectMember.mutateAsync({
              projectId: pidNum,
              data: {
                userId: quickAssignUser.id,
                role: quickRole,
                assignedGroupIds: groupsForRole,
              },
            });
            memberId = created?.id;
          } catch (err: any) {
            if (err?.status === 409) {
              const fresh = await listProjectMembers(pidNum);
              const found = fresh.find((m) => m.userId === quickAssignUser.id);
              if (!found) throw err;
              await updateProjectMember.mutateAsync({
                projectId: pidNum,
                id: found.id,
                data: { role: quickRole, assignedGroupIds: groupsForRole },
              });
              memberId = found.id;
            } else {
              throw err;
            }
          }
        }
      }

      // 3) Apply manual tab permissions if customized
      if (hasProjectMembership && memberId && quickCustomizeTabs) {
        await updateMemberTabPermissions.mutateAsync({
          projectId: pidNum,
          id: memberId,
          data: { tabPermissions: quickTabDraft as TabPermissionsMap },
        });
        queryClient.invalidateQueries({
          queryKey: getGetMemberTabPermissionsQueryKey(pidNum, memberId),
        });
        queryClient.invalidateQueries({
          queryKey: getGetMyProjectPermissionsQueryKey(pidNum),
        });
      }

      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetIncompleteUsersCountQueryKey() });
      if (hasProjectMembership) {
        queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(pidNum) });
      }
      toast({ title: "تم تعيين المستخدم بنجاح" });
      closeQuickAssign();
    } catch (err: any) {
      const serverMsg =
        (err?.data && typeof err.data === "object" && "error" in err.data && typeof err.data.error === "string")
          ? err.data.error
          : err?.message;
      toast({
        variant: "destructive",
        title: "فشل تعيين المستخدم",
        description: serverMsg || undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteUser.mutateAsync({ id: deletingId });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetIncompleteUsersCountQueryKey() });
      toast({ title: "تم حذف المستخدم بنجاح" });
    } catch (e) {
      toast({ variant: "destructive", title: "حدث خطأ أثناء الحذف" });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleCompany = (companyId: number) => {
    setSelectedCompanyIds(prev => {
      const next = prev.includes(companyId)
        ? prev.filter(id => id !== companyId)
        : [...prev, companyId];
      form.setValue("companyIds", next);
      return next;
    });
  };

  const toggleProject = (projectId: number) => {
    setSelectedProjectIds(prev => {
      const next = prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId];
      form.setValue("projectIds", next);
      return next;
    });
  };

  const getCompanyTypeName = (type: string) => {
    switch (type) {
      case "owner": return "مالك";
      case "contractor": return "مقاول";
      case "supervisor": return "مشرف";
      default: return type;
    }
  };

  const onSubmit = async (values: z.infer<typeof userSchema>) => {
    try {
      if (editingUserId) {
        const updateData: UpdateUserBody = {
          fullName: values.fullName,
          phone: values.phone,
          role: values.role,
          companyIds: selectedCompanyIds,
          projectIds: selectedProjectIds,
        };
        if (values.password) updateData.password = values.password;
        await updateUser.mutateAsync({ id: editingUserId, data: updateData });
        toast({ title: "تم تحديث المستخدم بنجاح" });
      } else {
        if (!values.password) {
            toast({ variant: "destructive", title: "كلمة المرور مطلوبة للمستخدم الجديد" });
            return;
        }
        const createData: CreateUserBody = {
          fullName: values.fullName,
          phone: values.phone,
          role: values.role as CreateUserBodyRole,
          password: values.password,
          companyIds: selectedCompanyIds,
          projectIds: selectedProjectIds,
        };
        await createUser.mutateAsync({ data: createData });
        toast({ title: "تم إنشاء المستخدم بنجاح" });
      }
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetIncompleteUsersCountQueryKey() });
      setIsDialogOpen(false);
      form.reset();
      setEditingUserId(null);
      setSelectedCompanyIds([]);
      setSelectedProjectIds([]);
    } catch (e) {
      toast({ variant: "destructive", title: "فشل حفظ المستخدم" });
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin': return <Badge className="bg-destructive hover:bg-destructive">مدير نظام</Badge>;
      case 'project_manager': return <Badge className="bg-amber-600 hover:bg-amber-600">مدير مشروع</Badge>;
      case 'engineer': return <Badge className="bg-primary hover:bg-primary">مهندس</Badge>;
      case 'contractor': return <Badge className="bg-orange-600 hover:bg-orange-600">مقاول</Badge>;
      case 'owner': return <Badge className="bg-emerald-600 hover:bg-emerald-600">مالك</Badge>;
      default: return <Badge variant="outline">{role}</Badge>;
    }
  };

  const renderCompanyBadges = (u: any) => {
    const comps = u.companies || [];
    if (comps.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {comps.map((c: any) => (
          <Badge key={c.companyId} variant="outline" className="gap-1 text-xs">
            <Building2 className="h-3 w-3" />
            {c.companyName}
          </Badge>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-500/10 rounded-xl">
            <UsersIcon className="h-6 w-6 text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-bold flex items-center gap-2">
              المستخدمون
              {incompleteCount > 0 && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-300 bg-amber-50 text-amber-700"
                  data-testid="badge-incomplete-count"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {incompleteCount} بانتظار التعيين
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">إدارة حسابات المستخدمين والصلاحيات</p>
          </div>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            form.reset();
            setEditingUserId(null);
            setSelectedCompanyIds([]);
            setSelectedProjectIds([]);
          }
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={handleOpenNew}>
              <Plus className="h-4 w-4" />
              إضافة مستخدم
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl" className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingUserId ? "تعديل مستخدم" : "مستخدم جديد"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>الاسم الكامل</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>رقم الهاتف</FormLabel>
                        <FormControl><Input type="tel" {...field} dir="ltr" className="text-right" placeholder="09XXXXXXXX" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>الصلاحية</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                          <FormControl>
                            <SelectTrigger dir="rtl">
                              <SelectValue placeholder="اختر الصلاحية" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent dir="rtl">
                            <SelectItem value="admin">مدير نظام</SelectItem>
                            <SelectItem value="project_manager">مدير مشروع</SelectItem>
                            <SelectItem value="engineer">مهندس</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>{editingUserId ? "كلمة المرور (اتركها فارغة لعدم التغيير)" : "كلمة المرور"}</FormLabel>
                        <FormControl><Input type="password" {...field} dir="ltr" className="text-right" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="sm:col-span-2 space-y-2">
                    <Label>الشركات</Label>
                    {companies.length === 0 ? (
                      <p className="text-xs text-muted-foreground">لا توجد شركات مسجلة</p>
                    ) : (
                      <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                        {companies.map(c => (
                          <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={selectedCompanyIds.includes(c.id)}
                              onCheckedChange={() => toggleCompany(c.id)}
                            />
                            <span className="text-sm">{c.name}</span>
                            <span className="text-xs text-muted-foreground">({getCompanyTypeName(c.type)})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <Label className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4" />
                      المشاريع
                    </Label>
                    {projectsList.length === 0 ? (
                      <p className="text-xs text-muted-foreground">لا توجد مشاريع</p>
                    ) : (
                      <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto" data-testid="project-membership-picker">
                        {projectsList.map(p => (
                          <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={selectedProjectIds.includes(p.id)}
                              onCheckedChange={() => toggleProject(p.id)}
                              data-testid={`checkbox-project-${p.id}`}
                            />
                            <span className="text-sm">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      سيتم تعيين المستخدم في المشاريع المختارة بدور افتراضي بناءً على صلاحيته في النظام.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                  <Button type="submit" disabled={createUser.isPending || updateUser.isPending}>حفظ</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            filter === "all"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-all-users"
        >
          الكل {users ? `(${users.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setFilter("incomplete")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
            filter === "incomplete"
              ? "border-amber-500 text-amber-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-incomplete-users"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          بيانات ناقصة ({incompleteCount})
        </button>
      </div>

      {isLoading ? (
        <LoadingSpinner text="جاري تحميل المستخدمين..." />
      ) : filteredUsers.length === 0 ? (
        <Card>
          <EmptyState
            icon={filter === "incomplete" ? <AlertTriangle className="h-7 w-7 text-amber-500/70" /> : <UserX className="h-7 w-7 text-muted-foreground/60" />}
            title={filter === "incomplete" ? "لا يوجد مستخدمين ببيانات ناقصة" : "لا يوجد مستخدمين"}
            description={filter === "incomplete" ? "جميع المستخدمين تم تعيينهم لشركات ومشاريع" : "أضف مستخدمين جدد لمنحهم صلاحيات الوصول للنظام"}
          />
        </Card>
      ) : (
      <>
      <Card className="shadow-sm">
        {/* Desktop Table */}
        <CardContent className="p-0 overflow-x-auto hidden sm:block">
          <Table className="min-w-[540px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-right">رقم الهاتف</TableHead>
                <TableHead className="text-right">الشركات</TableHead>
                <TableHead className="text-right">الصلاحية</TableHead>
                <TableHead className="text-left">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {
                filteredUsers.map((u) => (
                  <TableRow
                    key={u.id}
                    className={u.incompleteProfile ? "bg-amber-50/40 hover:bg-amber-50/60" : undefined}
                    data-testid={u.incompleteProfile ? `row-incomplete-${u.id}` : `row-user-${u.id}`}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {u.incompleteProfile && (
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-label="بيانات ناقصة" />
                        )}
                        <span>{u.fullName}</span>
                      </div>
                    </TableCell>
                    <TableCell dir="ltr" className="text-right">{u.phone}</TableCell>
                    <TableCell>{renderCompanyBadges(u)}</TableCell>
                    <TableCell>{getRoleBadge(u.role)}</TableCell>
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-2">
                        {u.incompleteProfile && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openQuickAssign(u)}
                            title="تعيين سريع لشركة ومشروع"
                            data-testid={`button-quick-assign-${u.id}`}
                          >
                            <Zap className="h-4 w-4 text-amber-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(u)}>
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeletingId(u.id)} disabled={user?.id === u.id}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>

        {/* Mobile Card View */}
        <CardContent className="sm:hidden space-y-3 p-3">
          {filteredUsers.map((u) => (
              <div
                key={u.id}
                className={`rounded-lg border p-3 space-y-2 ${u.incompleteProfile ? "border-amber-300 bg-amber-50/40" : ""}`}
                data-testid={u.incompleteProfile ? `card-incomplete-${u.id}` : `card-user-${u.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium flex items-center gap-2">
                    {u.incompleteProfile && (
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-label="بيانات ناقصة" />
                    )}
                    {u.fullName}
                  </span>
                  {getRoleBadge(u.role)}
                </div>
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {u.phone}
                </div>
                {(u as any).companies?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(u as any).companies.map((c: any) => (
                      <Badge key={c.companyId} variant="outline" className="gap-1 text-xs">
                        <Building2 className="h-3 w-3" />
                        {c.companyName}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex justify-end gap-1 pt-1 border-t">
                  {u.incompleteProfile && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openQuickAssign(u)}
                      title="تعيين سريع لشركة ومشروع"
                      data-testid={`button-quick-assign-mobile-${u.id}`}
                    >
                      <Zap className="h-4 w-4 text-amber-600" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(u)}>
                    <Edit2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeletingId(u.id)} disabled={user?.id === u.id}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      </>
      )}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!quickAssignUserId}
        onOpenChange={(open) => { if (!open) closeQuickAssign(); }}
      >
        <DialogContent dir="rtl" className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto" data-testid="dialog-quick-assign">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-600" />
              تعيين سريع
            </DialogTitle>
          </DialogHeader>
          {quickAssignUser && (
            <div className="space-y-4 pt-2">
              <div className="text-sm">
                <div className="font-medium">{quickAssignUser.fullName}</div>
                <div className="text-xs text-muted-foreground" dir="ltr">{quickAssignUser.phone}</div>
              </div>

              <div className="space-y-2">
                <Label>الشركة</Label>
                {companies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد شركات مسجلة</p>
                ) : (
                  <Select
                    value={quickCompanyId}
                    onValueChange={(v) => {
                      setQuickCompanyId(v);
                      // Reset project if it no longer belongs to the new company
                      if (quickProjectId) {
                        const cid = parseInt(v, 10);
                        const stillValid = projectsList.some((p) => {
                          if (String(p.id) !== quickProjectId) return false;
                          const anyP = p as any;
                          return (
                            anyP.ownerCompanyId === cid ||
                            anyP.contractorCompanyId === cid ||
                            anyP.supervisorCompanyId === cid
                          );
                        });
                        if (!stillValid) setQuickProjectId("");
                      }
                    }}
                  >
                    <SelectTrigger dir="rtl" data-testid="select-quick-company">
                      <SelectValue placeholder="اختر شركة" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {companies.map((c) => {
                        const already = (quickAssignUser.companies || []).some((x) => x.companyId === c.id);
                        return (
                          <SelectItem key={c.id} value={String(c.id)} disabled={already}>
                            {c.name}
                            <span className="text-xs text-muted-foreground"> ({getCompanyTypeName(c.type)})</span>
                            {already && <span className="text-xs text-muted-foreground"> — مُعيَّنة</span>}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4" />
                  المشروع
                </Label>
                {projectsList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد مشاريع</p>
                ) : quickCompanyId && quickFilteredProjects.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    لا توجد مشاريع مرتبطة بالشركة المختارة
                  </p>
                ) : (
                  <Select value={quickProjectId} onValueChange={setQuickProjectId}>
                    <SelectTrigger dir="rtl" data-testid="select-quick-project">
                      <SelectValue placeholder={quickCompanyId ? "اختر مشروع للشركة" : "اختر مشروع"} />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      {quickFilteredProjects.map((p) => {
                        const already = (quickAssignUser.projects || []).some((x) => x.projectId === p.id);
                        return (
                          <SelectItem key={p.id} value={String(p.id)} disabled={already}>
                            {p.name}
                            {already && <span className="text-xs text-muted-foreground"> — مُعيَّن</span>}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {quickProjectId && (
                <>
                  <div className="space-y-2">
                    <Label>الدور في المشروع</Label>
                    <Select
                      value={quickRole}
                      onValueChange={(v) => setQuickRole(v as typeof quickRole)}
                    >
                      <SelectTrigger dir="rtl" data-testid="select-quick-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="project_manager">مدير مشروع</SelectItem>
                        <SelectItem value="engineer">مهندس</SelectItem>
                        <SelectItem value="contractor">مقاول</SelectItem>
                        <SelectItem value="viewer">مشاهد (قراءة فقط)</SelectItem>
                      </SelectContent>
                    </Select>
                    {existingMember && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        هذا المستخدم عضو بالفعل في المشروع — سيتم تحديث دوره فقط.
                      </p>
                    )}
                  </div>

                  {quickRole === "engineer" && sortedQuickGroups.length > 0 && (
                    <div className="space-y-2">
                      <Label>المجموعات المسموح بإدارتها في الجدول الزمني</Label>
                      <p className="text-xs text-muted-foreground">
                        إذا لم تختر أي مجموعة، سيتمكن المهندس من تعديل جميع البنود.
                      </p>
                      <div className="space-y-2 max-h-[160px] overflow-y-auto border rounded-md p-2">
                        {sortedQuickGroups.map((g) => {
                          const checked = quickGroupIds.includes(g.id);
                          return (
                            <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() =>
                                  setQuickGroupIds((prev) =>
                                    prev.includes(g.id)
                                      ? prev.filter((x) => x !== g.id)
                                      : [...prev, g.id],
                                  )
                                }
                                data-testid={`quick-group-${g.id}`}
                              />
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: g.color }}
                              />
                              <span className="text-sm">{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 border-t pt-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={quickCustomizeTabs}
                        onCheckedChange={(v) => setQuickCustomizeTabs(v === true)}
                        data-testid="checkbox-quick-customize-tabs"
                      />
                      <span className="text-sm font-medium">تخصيص صلاحيات التبويبات يدوياً</span>
                    </label>
                    <p className="text-xs text-muted-foreground">
                      عند التفعيل، يمكنك تحديد صلاحية كل تبويب. وإلا ستُستخدم الإعدادات الافتراضية حسب الدور.
                    </p>

                    {quickCustomizeTabs && (
                      <div className="border rounded-md divide-y mt-2 max-h-[260px] overflow-y-auto">
                        {QUICK_TAB_DEFS.map((tab) => {
                          const current = quickTabDraft[tab.key] ?? "hidden";
                          return (
                            <div
                              key={tab.key}
                              className="flex items-center justify-between gap-2 px-3 py-2"
                            >
                              <span className="text-sm">{tab.label}</span>
                              <div className="flex items-center gap-1">
                                {QUICK_TAB_ACCESS_OPTIONS.map((opt) => {
                                  const active = current === opt.value;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() =>
                                        setQuickTabDraft((prev) => ({ ...prev, [tab.key]: opt.value }))
                                      }
                                      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                        active
                                          ? opt.value === "edit"
                                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                            : opt.value === "view"
                                              ? "bg-blue-100 text-blue-800 border-blue-300"
                                              : "bg-slate-200 text-slate-700 border-slate-300"
                                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                                      }`}
                                      data-testid={`quick-tab-${tab.key}-${opt.value}`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              <p className="text-xs text-muted-foreground">
                ستُضاف الشركة/المشروع المختارَين إلى تعيينات المستخدم الحالية دون استبدالها.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeQuickAssign}>
                  إلغاء
                </Button>
                <Button
                  type="button"
                  onClick={handleQuickAssign}
                  disabled={
                    updateUser.isPending ||
                    addProjectMember.isPending ||
                    updateProjectMember.isPending ||
                    updateMemberTabPermissions.isPending ||
                    (!quickCompanyId && !quickProjectId)
                  }
                  data-testid="button-quick-assign-save"
                >
                  حفظ التعيين
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  useListProjectMembers,
  useAddProjectMember,
  useUpdateProjectMember,
  useRemoveProjectMember,
  useGetEligibleUsers,
  useGetMemberTabPermissions,
  useUpdateMemberTabPermissions,
  getListProjectMembersQueryKey,
  getGetMemberTabPermissionsQueryKey,
  getGetMyProjectPermissionsQueryKey,
} from "@workspace/api-client-react";
import type { ProjectMember } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus, Trash2, Shield, Users, FolderOpen, Building2, ShieldCheck, RotateCcw } from "lucide-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface ActivityGroup {
  id: number;
  projectId: number;
  name: string;
  color: string;
  sortOrder: number;
}

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  return fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

interface ProjectMembersProps {
  projectId: number;
}

export function ProjectMembers({ projectId }: ProjectMembersProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("engineer");
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [editingGroupsMemberId, setEditingGroupsMemberId] = useState<number | null>(null);
  const [editGroupIds, setEditGroupIds] = useState<number[]>([]);
  const [permissionsMemberId, setPermissionsMemberId] = useState<number | null>(null);

  const isAdmin = user?.role === "admin";

  const { data: members = [], isLoading } = useListProjectMembers(projectId, {
    query: { enabled: !!projectId }
  });

  const { data: groups = [] } = useQuery<ActivityGroup[]>({
    queryKey: [`/api/projects/${projectId}/activity-groups`],
    queryFn: async () => {
      const r = await authFetch(`/api/projects/${projectId}/activity-groups`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  const isProjectManager = members.some(
    m => m.userId === user?.id && m.role === "project_manager"
  );
  const canManageMembers = isAdmin || isProjectManager;

  const { data: allUsers = [] } = useGetEligibleUsers(projectId, {
    query: { enabled: canManageMembers }
  });
  const addMember = useAddProjectMember();
  const updateMember = useUpdateProjectMember();
  const removeMember = useRemoveProjectMember();

  const updateGroupsMutation = useMutation({
    mutationFn: async ({ memberId, groupIds }: { memberId: number; groupIds: number[] }) => {
      const r = await authFetch(`/api/projects/${projectId}/members/${memberId}/groups`, {
        method: "PUT",
        body: JSON.stringify({ groupIds }),
      });
      if (!r.ok) throw new Error("فشل تحديث المجموعات");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم تحديث المجموعات بنجاح" });
      setEditingGroupsMemberId(null);
    },
  });

  const availableUsers = allUsers.filter(
    u => !members.some(m => m.userId === u.id) && u.role !== "owner"
  );

  const handleAdd = async () => {
    if (!selectedUserId || !selectedRole) {
      toast({ variant: "destructive", title: "يرجى اختيار المستخدم والدور" });
      return;
    }
    try {
      await addMember.mutateAsync({
        projectId,
        data: {
          userId: parseInt(selectedUserId),
          role: selectedRole as "project_manager" | "engineer" | "contractor" | "viewer",
          assignedGroupIds: selectedRole === "engineer" ? selectedGroupIds : undefined,
        }
      });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم إضافة العضو بنجاح" });
      setIsDialogOpen(false);
      setSelectedUserId("");
      setSelectedRole("engineer");
      setSelectedGroupIds([]);
    } catch {
      toast({ variant: "destructive", title: "فشل إضافة العضو" });
    }
  };

  const handleChangeRole = async (member: ProjectMember, newRole: string) => {
    try {
      await updateMember.mutateAsync({
        projectId,
        id: member.id,
        data: { role: newRole as "project_manager" | "engineer" | "contractor" | "viewer" }
      });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم تحديث الدور بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الدور" });
    }
  };

  const handleRemove = async () => {
    if (!removingId) return;
    try {
      await removeMember.mutateAsync({ projectId, id: removingId });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم إزالة العضو بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل إزالة العضو" });
    } finally {
      setRemovingId(null);
    }
  };

  const openGroupsEditor = (member: ProjectMember) => {
    setEditingGroupsMemberId(member.id);
    setEditGroupIds(member.assignedGroupIds ?? []);
  };

  const toggleGroupId = (id: number, list: number[], setList: (v: number[]) => void) => {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const getRoleBadge = (role: string) => {
    if (role === "project_manager") {
      return <Badge className="bg-amber-600 hover:bg-amber-600">مدير مشروع</Badge>;
    }
    if (role === "contractor") {
      return <Badge className="bg-orange-600 hover:bg-orange-600">مقاول</Badge>;
    }
    if (role === "viewer") {
      return <Badge className="bg-slate-500 hover:bg-slate-500">مشاهد</Badge>;
    }
    return <Badge className="bg-primary hover:bg-primary">مهندس</Badge>;
  };

  const sortedGroups = [...groups].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            فريق العمل
          </CardTitle>
          {canManageMembers && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  إضافة عضو
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl" className="sm:max-w-[440px]">
                <DialogHeader>
                  <DialogTitle>إضافة عضو للمشروع</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>المستخدم</Label>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger dir="rtl" className="w-full">
                        <span className="truncate block text-right">
                          {selectedUserId
                            ? (() => {
                                const u = availableUsers.find(u => String(u.id) === selectedUserId);
                                return u ? u.fullName : "اختر مستخدم";
                              })()
                            : "اختر مستخدم"}
                        </span>
                      </SelectTrigger>
                      <SelectContent dir="rtl" className="max-w-[400px]">
                        {availableUsers.map(u => (
                          <SelectItem key={u.id} value={String(u.id)} className="max-w-full">
                            <span className="font-medium">{u.fullName}</span>
                          </SelectItem>
                        ))}
                        {availableUsers.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            لا يوجد مستخدمين متاحين
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>الدور في المشروع</Label>
                    <Select value={selectedRole} onValueChange={setSelectedRole}>
                      <SelectTrigger dir="rtl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        <SelectItem value="project_manager">مدير مشروع</SelectItem>
                        <SelectItem value="engineer">مهندس</SelectItem>
                        <SelectItem value="contractor">مقاول</SelectItem>
                        <SelectItem value="viewer">مشاهد (قراءة فقط)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedRole === "engineer" && sortedGroups.length > 0 && (
                    <div className="space-y-2">
                      <Label>المجموعات المسموح بتعديلها</Label>
                      <p className="text-xs text-muted-foreground">إذا لم تختر أي مجموعة، سيتمكن المهندس من تعديل جميع البنود</p>
                      <div className="space-y-2 max-h-[160px] overflow-y-auto border rounded-md p-2">
                        {sortedGroups.map(g => (
                          <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={selectedGroupIds.includes(g.id)}
                              onCheckedChange={() => toggleGroupId(g.id, selectedGroupIds, setSelectedGroupIds)}
                            />
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                            <span className="text-sm">{g.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                    <Button onClick={handleAdd} disabled={addMember.isPending}>إضافة</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">جاري التحميل...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">لا يوجد أعضاء في هذا المشروع</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">العضو</TableHead>
                <TableHead className="text-right">الشركة</TableHead>
                {canManageMembers && <TableHead className="text-right">الدور في المشروع</TableHead>}
                <TableHead className="text-right">المجموعات</TableHead>
                {canManageMembers && <TableHead className="text-left w-[100px]">الإجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(member => {
                const memberGroups = (member.assignedGroupIds ?? [])
                  .map(gid => groups.find(g => g.id === gid))
                  .filter(Boolean) as ActivityGroup[];
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{member.fullName}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">{member.phone}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {(member as any).companyNames?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {(member as any).companyNames.map((name: string, i: number) => (
                            <Badge key={i} variant="outline" className="gap-1 text-xs">
                              <Building2 className="h-3 w-3" />
                              {name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canManageMembers && (
                    <TableCell>
                      {member.userId !== user?.id ? (
                        <Select
                          value={member.role}
                          onValueChange={(val) => handleChangeRole(member, val)}
                        >
                          <SelectTrigger className="w-[140px]" dir="rtl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent dir="rtl">
                            <SelectItem value="project_manager">مدير مشروع</SelectItem>
                            <SelectItem value="engineer">مهندس</SelectItem>
                            <SelectItem value="contractor">مقاول</SelectItem>
                            <SelectItem value="viewer">مشاهد (قراءة فقط)</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        getRoleBadge(member.role)
                      )}
                    </TableCell>
                    )}
                    <TableCell>
                      {member.role === "engineer" ? (
                        <div className="flex flex-wrap gap-1">
                          {memberGroups.length > 0 ? (
                            memberGroups.map(g => (
                              <Badge key={g.id} variant="outline" className="gap-1 text-xs">
                                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                                {g.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">جميع المجموعات</span>
                          )}
                          {canManageMembers && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => {
                                if (sortedGroups.length === 0) {
                                  toast({ title: "لا توجد مجموعات بنود", description: "يرجى إنشاء مجموعات بنود أولاً من صفحة بنود الأعمال" });
                                  return;
                                }
                                openGroupsEditor(member);
                              }}
                              title="مجموعات البنود"
                            >
                              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      ) : member.role === "viewer" ? (
                        <span className="text-xs text-muted-foreground">قراءة فقط</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">صلاحية كاملة</span>
                      )}
                    </TableCell>
                    {canManageMembers && (
                      <TableCell className="text-left">
                        <div className="flex items-center gap-1">
                          {member.role === "contractor" ? (
                            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground" title="صلاحيات المقاول ثابتة وغير قابلة للتعديل">
                              صلاحيات ثابتة
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPermissionsMemberId(member.id)}
                              title="إدارة صلاحيات التبويبات"
                            >
                              <ShieldCheck className="h-4 w-4 text-primary" />
                            </Button>
                          )}
                          {member.userId !== user?.id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRemovingId(member.id)}
                              disabled={removeMember.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <AlertDialog open={!!removingId} onOpenChange={(open) => { if (!open) setRemovingId(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الإزالة</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من إزالة هذا العضو من المشروع؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              إزالة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TabPermissionsDialog
        projectId={projectId}
        memberId={permissionsMemberId}
        memberName={members.find(m => m.id === permissionsMemberId)?.fullName ?? ""}
        onClose={() => setPermissionsMemberId(null)}
      />
      <Dialog open={editingGroupsMemberId !== null} onOpenChange={(open) => { if (!open) setEditingGroupsMemberId(null); }}>
        <DialogContent dir="rtl" className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>تعديل المجموعات المسموحة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              حدد المجموعات التي يمكن لهذا المهندس تعديل بنودها. إذا لم تحدد أي مجموعة، سيتمكن من تعديل جميع البنود.
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-3">
              {sortedGroups.map(g => (
                <label key={g.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={editGroupIds.includes(g.id)}
                    onCheckedChange={() => toggleGroupId(g.id, editGroupIds, setEditGroupIds)}
                  />
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="text-sm">{g.name}</span>
                </label>
              ))}
              {sortedGroups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">لا توجد مجموعات في هذا المشروع</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingGroupsMemberId(null)}>إلغاء</Button>
              <Button
                onClick={() => {
                  if (editingGroupsMemberId) {
                    updateGroupsMutation.mutate({ memberId: editingGroupsMemberId, groupIds: editGroupIds });
                  }
                }}
                disabled={updateGroupsMutation.isPending}
              >
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const TAB_DEFS: { key: string; label: string }[] = [
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

const ACCESS_OPTIONS: { value: "hidden" | "view" | "edit"; label: string; className: string }[] = [
  { value: "hidden", label: "مخفي", className: "data-[state=on]:bg-slate-200 data-[state=on]:text-slate-800" },
  { value: "view", label: "مشاهدة", className: "data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700" },
  { value: "edit", label: "تعديل", className: "data-[state=on]:bg-emerald-100 data-[state=on]:text-emerald-700" },
];

interface TabPermissionsDialogProps {
  projectId: number;
  memberId: number | null;
  memberName: string;
  onClose: () => void;
}

function TabPermissionsDialog({ projectId, memberId, memberName, onClose }: TabPermissionsDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, "hidden" | "view" | "edit">>({});
  const [overrideEnabled, setOverrideEnabled] = useState(false);

  const { data, isLoading } = useGetMemberTabPermissions(projectId, memberId ?? 0, {
    query: { enabled: !!memberId },
  });

  const updateMutation = useUpdateMemberTabPermissions();

  // Sync draft state from server response whenever the dialog opens or data refreshes.
  useEffect(() => {
    if (!memberId || !data) return;
    const eff = (data.effective ?? {}) as Record<string, "hidden" | "view" | "edit">;
    setDraft({ ...eff });
    setOverrideEnabled(!!data.overrides);
  }, [memberId, data]);

  const handleSave = async () => {
    if (!memberId) return;
    try {
      await updateMutation.mutateAsync({
        projectId,
        id: memberId,
        data: { tabPermissions: overrideEnabled ? draft : null },
      });
      queryClient.invalidateQueries({ queryKey: getGetMemberTabPermissionsQueryKey(projectId, memberId) });
      queryClient.invalidateQueries({ queryKey: getGetMyProjectPermissionsQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم حفظ الصلاحيات" });
      onClose();
    } catch {
      toast({ variant: "destructive", title: "فشل حفظ الصلاحيات" });
    }
  };

  const handleResetToDefaults = () => {
    setOverrideEnabled(false);
    if (data?.effective) {
      setDraft({ ...(data.effective as Record<string, "hidden" | "view" | "edit">) });
    }
  };

  const setTabAccess = (tab: string, access: "hidden" | "view" | "edit") => {
    setOverrideEnabled(true);
    setDraft(prev => ({ ...prev, [tab]: access }));
  };

  const open = memberId !== null;
  const effective = (overrideEnabled ? draft : (data?.effective as Record<string, "hidden" | "view" | "edit"> | undefined)) ?? {};

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent dir="rtl" className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            صلاحيات التبويبات — {memberName}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">جاري التحميل...</p>
        ) : (
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">
              حدد لكل تبويب: مخفي / مشاهدة فقط / تعديل. الإعدادات الافتراضية مشتقة من دور العضو في المشروع.
              {overrideEnabled && (
                <span className="block mt-1 text-amber-700 dark:text-amber-400">
                  وضع التخصيص مُفعَّل لهذا العضو.
                </span>
              )}
            </p>

            <div className="border rounded-md divide-y">
              {TAB_DEFS.map(tab => {
                const current = effective[tab.key] ?? "hidden";
                return (
                  <div key={tab.key} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-medium">{tab.label}</span>
                    <div className="flex items-center gap-1">
                      {ACCESS_OPTIONS.map(opt => {
                        const active = current === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setTabAccess(tab.key, opt.value)}
                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                              active
                                ? opt.value === "edit"
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                  : opt.value === "view"
                                    ? "bg-blue-100 text-blue-800 border-blue-300"
                                    : "bg-slate-200 text-slate-700 border-slate-300"
                                : "bg-background text-muted-foreground border-border hover:bg-muted"
                            }`}
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

            <div className="flex flex-row-reverse justify-between gap-2 pt-3">
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>إلغاء</Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  حفظ
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetToDefaults}
                className="gap-1"
                title="استعادة الإعدادات الافتراضية حسب الدور"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                إعادة للافتراضي
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}



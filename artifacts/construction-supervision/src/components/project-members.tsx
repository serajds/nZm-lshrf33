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
import type { ProjectMember as ApiProjectMember } from "@workspace/api-client-react";

// The /projects/:id/members response includes a server-computed flag that
// is not yet in the generated OpenAPI types. We extend the shape locally
// until the next codegen run picks it up.
type ProjectMember = ApiProjectMember & { isContractorLocked?: boolean };
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
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";

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

  const { data: rawMembers = [], isLoading } = useListProjectMembers(projectId, {
    query: { enabled: !!projectId }
  });
  const members = rawMembers as ProjectMember[];

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
      return <Badge className="bg-amber-600 hover:bg-amber-600 text-white">مدير مشروع</Badge>;
    }
    if (role === "contractor") {
      return <Badge className="bg-orange-600 hover:bg-orange-600 text-white">مقاول</Badge>;
    }
    if (role === "viewer") {
      return <Badge className="bg-slate-500 hover:bg-slate-500 text-white">مشاهد</Badge>;
    }
    return <Badge className="bg-primary hover:bg-primary text-white">مهندس</Badge>;
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
              <DialogContent dir="rtl" className="sm:max-w-[550px] p-0 overflow-hidden">
                <div className="bg-gradient-to-br from-primary/10 via-background to-background p-6 pb-4 border-b border-border/50">
                  <DialogHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-primary/10 rounded-xl">
                        <UserPlus className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <DialogTitle className="text-xl">إضافة عضو للمشروع</DialogTitle>
                        <p className="text-sm text-muted-foreground mt-1">أضف مستخدم جديد وحدد دوره وصلاحياته داخل هذا المشروع.</p>
                      </div>
                    </div>
                  </DialogHeader>
                </div>
                <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
                  <div className="px-6 py-4 space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        بيانات العضو والدور
                      </h3>
                      <div className="grid grid-cols-1 gap-5 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                        <div className="space-y-2">
                          <Label className="text-foreground/90 font-semibold">المستخدم</Label>
                          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                            <SelectTrigger dir="rtl" className="w-full bg-background">
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
                                <div className="p-4 text-sm text-muted-foreground text-center">
                                  لا يوجد مستخدمين متاحين
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-foreground/90 font-semibold">الدور في المشروع</Label>
                          <Select value={selectedRole} onValueChange={setSelectedRole}>
                            <SelectTrigger dir="rtl" className="bg-background">
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
                      </div>
                    </div>
                    {selectedRole === "engineer" && sortedGroups.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-primary/80 uppercase tracking-wide flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                          المجموعات المسموحة (للمهندس)
                        </h3>
                        <div className="space-y-3 p-5 rounded-2xl border bg-gradient-to-br from-muted/30 to-background shadow-sm">
                          <p className="text-xs text-muted-foreground bg-amber-50/50 border border-amber-200/50 p-3 rounded-xl flex items-center gap-2">
                            <Shield className="h-4 w-4 text-amber-500 shrink-0" />
                            إذا لم تختر أي مجموعة، سيتمكن المهندس من تعديل جميع البنود.
                          </p>
                          <div className="space-y-2 max-h-[160px] overflow-y-auto border bg-background rounded-xl p-3 shadow-inner">
                            {sortedGroups.map(g => {
                              const isChecked = selectedGroupIds.includes(g.id);
                              return (
                                <label key={g.id} className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors border border-transparent">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => toggleGroupId(g.id, selectedGroupIds, setSelectedGroupIds)}
                                    className="data-[state=checked]:bg-primary"
                                  />
                                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                                  <span className="text-sm font-medium">{g.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                      <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
                      <Button type="submit" className="w-full sm:w-auto shadow-md" onClick={handleAdd} disabled={addMember.isPending}>إضافة العضو</Button>
                    </div>
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
          <>
          <div className="overflow-x-auto hidden sm:block">
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
                          {(member.isContractorLocked || member.role === "contractor") ? (
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
          </div>

          {/* Mobile card view */}
          <div className="sm:hidden space-y-3">
            {members.map(member => {
              const memberGroups = (member.assignedGroupIds ?? [])
                .map(gid => groups.find(g => g.id === gid))
                .filter(Boolean) as ActivityGroup[];
              return (
                <div key={member.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{member.fullName}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{member.phone}</p>
                    </div>
                    {canManageMembers && (
                      <div className="flex items-center gap-1 shrink-0">
                        {(member.isContractorLocked || member.role === "contractor") ? (
                          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground" title="صلاحيات المقاول ثابتة وغير قابلة للتعديل">
                            صلاحيات ثابتة
                          </Badge>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPermissionsMemberId(member.id)} title="إدارة صلاحيات التبويبات">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                          </Button>
                        )}
                        {member.userId !== user?.id && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRemovingId(member.id)} disabled={removeMember.isPending}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {(member as any).companyNames?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(member as any).companyNames.map((name: string, i: number) => (
                        <Badge key={i} variant="outline" className="gap-1 text-xs">
                          <Building2 className="h-3 w-3" />
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">الدور في المشروع</span>
                    {canManageMembers && member.userId !== user?.id ? (
                      <Select value={member.role} onValueChange={(val) => handleChangeRole(member, val)}>
                        <SelectTrigger className="w-[150px] h-8" dir="rtl">
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
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-muted-foreground shrink-0 pt-0.5">المجموعات</span>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {member.role === "engineer" ? (
                        <>
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
                        </>
                      ) : member.role === "viewer" ? (
                        <span className="text-xs text-muted-foreground">قراءة فقط</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">صلاحية كاملة</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
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
        <DialogContent dir="rtl" className="sm:max-w-[480px] p-0 overflow-hidden">
          <div className="bg-gradient-to-br from-indigo-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 rounded-xl">
                  <FolderOpen className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                  <DialogTitle className="text-xl">تعديل المجموعات المسموحة</DialogTitle>
                  <p className="text-sm text-muted-foreground mt-1">تحديد بنود الأعمال التي يحق للمهندس الإشراف عليها.</p>
                </div>
              </div>
            </DialogHeader>
          </div>
          <div className="overflow-y-auto max-h-[calc(90vh-140px)] px-6 py-4 space-y-6">
            <p className="text-sm text-foreground bg-indigo-50/50 border border-indigo-200/50 p-4 rounded-2xl leading-relaxed">
              إذا لم تحدد أي مجموعة، <strong className="text-indigo-700">سيتمكن المهندس من تعديل جميع البنود</strong> في المشروع كصلاحية افتراضية.
            </p>
            <div className="space-y-2 max-h-[240px] overflow-y-auto border bg-gradient-to-br from-muted/20 to-background rounded-2xl p-3 shadow-inner">
              {sortedGroups.map(g => (
                <label key={g.id} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-background transition-colors border border-transparent hover:border-border/50 hover:shadow-sm">
                  <Checkbox
                    checked={editGroupIds.includes(g.id)}
                    onCheckedChange={() => toggleGroupId(g.id, editGroupIds, setEditGroupIds)}
                    className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                  />
                  <span className="inline-block w-3 h-3 rounded-full border shadow-sm" style={{ backgroundColor: g.color }} />
                  <span className="text-sm font-medium">{g.name}</span>
                </label>
              ))}
              {sortedGroups.length === 0 && (
                <div className="p-6 text-center">
                  <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">لا توجد مجموعات أعمال مسجلة في هذا المشروع حتى الآن.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-6 border-t mt-4 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setEditingGroupsMemberId(null)}>إلغاء</Button>
              <Button
                type="submit"
                className="w-full sm:w-auto shadow-md bg-indigo-600 hover:bg-indigo-700"
                onClick={() => {
                  if (editingGroupsMemberId) {
                    updateGroupsMutation.mutate({ memberId: editingGroupsMemberId, groupIds: editGroupIds });
                  }
                }}
                disabled={updateGroupsMutation.isPending}
              >
                حفظ التعديلات
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
      <DialogContent dir="rtl" className="sm:max-w-[650px] p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-teal-500/10 via-background to-background p-6 pb-4 border-b border-border/50">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-teal-500/10 rounded-xl">
                <ShieldCheck className="h-6 w-6 text-teal-600" />
              </div>
              <div>
                <DialogTitle className="text-xl">تخصيص صلاحيات التبويبات</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">تحديد مستوى الوصول الفردي للعضو: <span className="font-semibold text-foreground">{memberName}</span></p>
              </div>
            </div>
          </DialogHeader>
        </div>
        
        <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
          {isLoading ? (
            <div className="p-12 flex items-center justify-center">
              <LoadingSpinner text="جاري تحميل الصلاحيات..." />
            </div>
          ) : (
            <div className="px-6 py-4 space-y-6">
              <div className="bg-muted/30 border border-muted-foreground/10 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1 text-sm text-foreground/90 leading-relaxed">
                  <p>حدد لكل تبويب مستوى الوصول: <strong className="text-slate-600 bg-slate-100 px-1 rounded">مخفي</strong> أو <strong className="text-blue-600 bg-blue-100 px-1 rounded">مشاهدة</strong> أو <strong className="text-emerald-600 bg-emerald-100 px-1 rounded">تعديل</strong>.</p>
                  {overrideEnabled ? (
                    <p className="text-amber-600 font-medium flex items-center gap-1"><Shield className="h-3 w-3" /> وضع التخصيص مُفعَّل: هذا العضو يمتلك صلاحيات استثنائية.</p>
                  ) : (
                    <p className="text-muted-foreground">تستخدم الآن الإعدادات الافتراضية المرتبطة بدور العضو في المشروع.</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetToDefaults}
                  className="gap-2 shrink-0 bg-background"
                  disabled={!overrideEnabled}
                >
                  <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  العودة للافتراضي
                </Button>
              </div>

              <div className="border rounded-2xl overflow-hidden shadow-sm bg-background divide-y">
                {TAB_DEFS.map(tab => {
                  const current = effective[tab.key] ?? "hidden";
                  return (
                    <div key={tab.key} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 hover:bg-muted/20 transition-colors">
                      <span className="text-sm font-semibold text-foreground/90">{tab.label}</span>
                      <div className="flex items-center p-1 bg-muted/40 rounded-lg border w-full sm:w-auto overflow-x-auto hide-scrollbar">
                        {ACCESS_OPTIONS.map(opt => {
                          const active = current === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setTabAccess(tab.key, opt.value)}
                              className={cn(
                                "flex-1 sm:flex-none px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200 min-w-[70px]",
                                active
                                  ? opt.value === "edit"
                                    ? "bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-600/20"
                                    : opt.value === "view"
                                      ? "bg-blue-500 text-white shadow-sm ring-1 ring-blue-600/20"
                                      : "bg-slate-600 text-white shadow-sm ring-1 ring-slate-700/20"
                                  : "text-muted-foreground hover:bg-background hover:text-foreground"
                              )}
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

              <div className="flex justify-end gap-3 pt-6 border-t mt-8 sticky bottom-0 bg-background/95 backdrop-blur-xl pb-2 z-10 -mx-2 px-2">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>إلغاء والتراجع</Button>
                <Button type="submit" className="w-full sm:w-auto shadow-md" onClick={handleSave} disabled={updateMutation.isPending}>
                  حفظ الصلاحيات المُخصصة
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}



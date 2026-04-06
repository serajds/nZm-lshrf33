import { useState } from "react";
import {
  useListProjectMembers,
  useAddProjectMember,
  useUpdateProjectMember,
  useRemoveProjectMember,
  useListUsers,
  getListProjectMembersQueryKey,
} from "@workspace/api-client-react";
import type { ProjectMember } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { UserPlus, Trash2, Shield, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface ProjectMembersProps {
  projectId: number;
}

export function ProjectMembers({ projectId }: ProjectMembersProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<string>("engineer");

  const isAdmin = user?.role === "admin";

  const { data: members = [], isLoading } = useListProjectMembers(projectId, {
    query: { enabled: !!projectId }
  });

  const isProjectManager = members.some(
    m => m.userId === user?.id && m.role === "project_manager"
  );
  const canManageMembers = isAdmin || isProjectManager;

  const { data: allUsers = [] } = useListUsers({
    query: { enabled: canManageMembers }
  });
  const addMember = useAddProjectMember();
  const updateMember = useUpdateProjectMember();
  const removeMember = useRemoveProjectMember();

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
          role: selectedRole as "project_manager" | "engineer",
        }
      });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم إضافة العضو بنجاح" });
      setIsDialogOpen(false);
      setSelectedUserId("");
      setSelectedRole("engineer");
    } catch {
      toast({ variant: "destructive", title: "فشل إضافة العضو" });
    }
  };

  const handleChangeRole = async (member: ProjectMember, newRole: string) => {
    try {
      await updateMember.mutateAsync({
        projectId,
        id: member.id,
        data: { role: newRole as "project_manager" | "engineer" }
      });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم تحديث الدور بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الدور" });
    }
  };

  const handleRemove = async (memberId: number) => {
    if (!confirm("هل أنت متأكد من إزالة هذا العضو؟")) return;
    try {
      await removeMember.mutateAsync({ projectId, id: memberId });
      queryClient.invalidateQueries({ queryKey: getListProjectMembersQueryKey(projectId) });
      toast({ title: "تم إزالة العضو بنجاح" });
    } catch {
      toast({ variant: "destructive", title: "فشل إزالة العضو" });
    }
  };

  const getRoleBadge = (role: string) => {
    if (role === "project_manager") {
      return <Badge className="bg-amber-600 hover:bg-amber-600">مدير مشروع</Badge>;
    }
    return <Badge className="bg-primary hover:bg-primary">مهندس</Badge>;
  };

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
              <DialogContent dir="rtl" className="sm:max-w-[400px]">
                <DialogHeader>
                  <DialogTitle>إضافة عضو للمشروع</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>المستخدم</Label>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger dir="rtl">
                        <SelectValue placeholder="اختر مستخدم" />
                      </SelectTrigger>
                      <SelectContent dir="rtl">
                        {availableUsers.map(u => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.fullName} ({u.username})
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
                      </SelectContent>
                    </Select>
                  </div>
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
                <TableHead className="text-right">الدور في المشروع</TableHead>
                {canManageMembers && <TableHead className="text-left w-[100px]">الإجراءات</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(member => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{member.fullName}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{member.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManageMembers ? (
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
                        </SelectContent>
                      </Select>
                    ) : (
                      getRoleBadge(member.role)
                    )}
                  </TableCell>
                  {canManageMembers && (
                    <TableCell className="text-left">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(member.id)}
                        disabled={removeMember.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

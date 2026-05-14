import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import {
  ApiError, apiAddProjectMember, apiListEligibleUsers, apiListProjectMembers,
  apiMyProjectPermissions, apiRemoveProjectMember,
} from "@/lib/api";

const ROLES: { value: string; label: string }[] = [
  { value: "project_manager", label: "مدير مشروع" },
  { value: "engineer", label: "مهندس" },
  { value: "contractor", label: "مقاول" },
  { value: "viewer", label: "مشاهد" },
];

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const qc = useQueryClient();
  const [picking, setPicking] = useState<{ userId: number; userName: string } | null>(null);

  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId) });
  const isPM = permsQ.data?.role === "admin" || permsQ.data?.projectRole === "project_manager";

  const membersQ = useQuery({ queryKey: ["members", projectId], queryFn: () => apiListProjectMembers(projectId), enabled: Number.isFinite(projectId) });
  const eligibleQ = useQuery({ queryKey: ["eligible", projectId], queryFn: () => apiListEligibleUsers(projectId), enabled: isPM });

  const remove = useMutation({
    mutationFn: (memberId: number) => apiRemoveProjectMember(projectId, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "تعذّر الحذف"),
  });

  const add = useMutation({
    mutationFn: (vars: { userId: number; role: string }) => apiAddProjectMember(projectId, vars),
    onSuccess: () => {
      setPicking(null);
      qc.invalidateQueries({ queryKey: ["members", projectId] });
      qc.invalidateQueries({ queryKey: ["eligible", projectId] });
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل الإضافة"),
  });

  const memberUserIds = new Set((membersQ.data ?? []).map(m => m.userId));
  const candidates = (eligibleQ.data ?? []).filter(u => !memberUserIds.has(u.id));

  return (
    <Screen
      title="أعضاء المشروع"
      back
      refreshing={membersQ.isFetching}
      onRefresh={() => { membersQ.refetch(); eligibleQ.refetch(); }}
    >
      {!membersQ.data?.length ? (
        <Empty icon="users" title="لا يوجد أعضاء بعد" />
      ) : (
        membersQ.data.map(m => (
          <Card key={m.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{m.userName}</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>{m.userPhone}</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                  الدور: {ROLES.find(r => r.value === m.role)?.label ?? m.role}
                  {m.companyNames.length ? ` • ${m.companyNames.join("، ")}` : ""}
                </Text>
              </View>
              {isPM && (
                <TouchableOpacity
                  onPress={() => Alert.alert("حذف العضو", `حذف ${m.userName} من المشروع؟`, [
                    { text: "إلغاء", style: "cancel" },
                    { text: "حذف", style: "destructive", onPress: () => remove.mutate(m.id) },
                  ])}
                  style={[styles.iconBtn, { backgroundColor: colors.destructive + "22" }]}
                >
                  <Feather name="trash-2" size={16} color={colors.destructive} />
                </TouchableOpacity>
              )}
            </View>
          </Card>
        ))
      )}

      {isPM && (
        <Card>
          <Text style={[styles.section, { color: colors.foreground }]}>إضافة عضو جديد</Text>
          {candidates.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular", marginTop: 6 }}>
              لا يوجد مستخدمون متاحون لهذا المشروع.
            </Text>
          ) : picking ? (
            <View>
              <Text style={[styles.sub, { color: colors.foreground, marginVertical: 8 }]}>
                اختر دور {picking.userName}:
              </Text>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r.value}
                  onPress={() => add.mutate({ userId: picking.userId, role: r.value })}
                  disabled={add.isPending}
                  style={[styles.roleBtn, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.foreground, fontFamily: "Cairo_600SemiBold" }}>{r.label}</Text>
                </TouchableOpacity>
              ))}
              <PrimaryButton label="إلغاء" icon="x" kind="secondary" onPress={() => setPicking(null)} />
            </View>
          ) : (
            candidates.map(u => (
              <TouchableOpacity
                key={u.id}
                onPress={() => setPicking({ userId: u.id, userName: u.fullName ?? u.phone ?? `#${u.id}` })}
                style={[styles.candidate, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Cairo_600SemiBold" }}>
                  {u.fullName ?? u.phone}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular", fontSize: 12 }}>
                  {u.phone}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  name: { fontFamily: "Cairo_700Bold", fontSize: 15, marginBottom: 2 },
  sub: { fontFamily: "Cairo_400Regular", fontSize: 12 },
  section: { fontFamily: "Cairo_700Bold", fontSize: 15 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  candidate: { padding: 10, borderWidth: 1, borderRadius: 10, marginTop: 8 },
  roleBtn: { padding: 12, borderWidth: 1, borderRadius: 10, marginTop: 8, alignItems: "center" },
});

import { useQuery } from "@tanstack/react-query";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiListUsers } from "@/lib/api";

const ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام", project_manager: "مدير مشروع", engineer: "مهندس",
  contractor: "مقاول", owner: "مالك",
};

export default function AdminUsersScreen() {
  const { user } = useAuth();
  const colors = useColors();
  const q = useQuery({ queryKey: ["admin-users"], queryFn: apiListUsers, enabled: user?.role === "admin" });

  if (user?.role !== "admin") {
    return <Screen title="المستخدمون" back><Empty icon="lock" title="غير مصرح" description="هذه الشاشة للمسؤولين فقط." /></Screen>;
  }
  const users = q.data ?? [];

  return (
    <Screen title="المستخدمون" back refreshing={q.isFetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : users.length === 0 ? (
        <Empty icon="users" title="لا يوجد مستخدمون" />
      ) : (
        users.map(u => (
          <Card key={u.id}>
            <View style={styles.headerRow}>
              <Text style={[styles.name, { color: colors.foreground }]}>{u.fullName}</Text>
              <Text style={[styles.role, { color: colors.primary }]}>{ROLE_LABEL[u.role] ?? u.role}</Text>
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>{u.phone}</Text>
            {u.companies?.length > 0 ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>الشركات: {u.companies.map(c => c.companyName).join("، ")}</Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>المشاريع: {u.projectMembershipsCount}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  name: { fontFamily: "Cairo_700Bold", fontSize: 15, flex: 1 },
  role: { fontFamily: "Cairo_600SemiBold", fontSize: 12 },
  meta: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
});

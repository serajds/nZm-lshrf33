import { useQuery } from "@tanstack/react-query";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiAuditLog } from "@/lib/api";

const ACTION_LABEL: Record<string, string> = {
  create: "إنشاء", update: "تعديل", delete: "حذف", login: "دخول", logout: "خروج",
};

export default function AuditLogScreen() {
  const { user } = useAuth();
  const colors = useColors();
  const q = useQuery({ queryKey: ["audit-log"], queryFn: () => apiAuditLog(100), enabled: user?.role === "admin" });

  if (user?.role !== "admin") {
    return <Screen title="سجل الأحداث" back><Empty icon="lock" title="غير مصرح" /></Screen>;
  }
  const items = q.data ?? [];

  return (
    <Screen title="سجل الأحداث" back refreshing={q.isFetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : items.length === 0 ? (
        <Empty icon="file-text" title="لا توجد أحداث" />
      ) : (
        items.map(e => (
          <Card key={e.id}>
            <View style={styles.row}>
              <Text style={[styles.action, { color: colors.primary }]}>{ACTION_LABEL[e.action] ?? e.action}</Text>
              <Text style={[styles.date, { color: colors.mutedForeground }]}>{formatDate(e.createdAt)}</Text>
            </View>
            <Text style={[styles.summary, { color: colors.foreground }]}>
              {e.userName ?? "—"} • {e.entityType}
              {e.entityName ? ` "${e.entityName}"` : ""}
            </Text>
            {e.projectName ? (
              <Text style={[styles.proj, { color: colors.mutedForeground }]}>المشروع: {e.projectName}</Text>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-LY", {
      timeZone: "Africa/Tripoli",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  action: { fontFamily: "Cairo_700Bold", fontSize: 13 },
  date: { fontFamily: "Cairo_400Regular", fontSize: 11 },
  summary: { fontFamily: "Cairo_600SemiBold", fontSize: 13, marginTop: 6 },
  proj: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
});

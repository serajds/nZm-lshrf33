import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { apiListReports, apiMyProjectPermissions } from "@/lib/api";

export default function ReportsListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const reportsQ = useQuery({ queryKey: ["reports", projectId], queryFn: () => apiListReports(projectId), enabled: Number.isFinite(projectId) });
  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId), enabled: Number.isFinite(projectId) });
  const canEdit = !!permsQ.data?.tabPermissions?.reports?.edit || !!permsQ.data?.canEditAll;
  const reports = reportsQ.data ?? [];

  return (
    <Screen
      title="التقارير"
      back
      refreshing={reportsQ.isFetching}
      onRefresh={() => reportsQ.refetch()}
      right={canEdit ? (
        <TouchableOpacity onPress={() => router.push(`/projects/${projectId}/reports/new` as never)}>
          <Feather name="plus-circle" size={24} color={colors.primary} />
        </TouchableOpacity>
      ) : null}
    >
      {reportsQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : reports.length === 0 ? (
        <Empty
          icon="file-text" title="لا توجد تقارير" description="لم يتم إنشاء أي تقرير لهذا المشروع بعد."
          action={canEdit ? <View style={{ marginTop: 16 }}><PrimaryButton label="إضافة تقرير" icon="plus" onPress={() => router.push(`/projects/${projectId}/reports/new` as never)} /></View> : undefined}
        />
      ) : (
        reports.map(r => (
          <TouchableOpacity key={r.id} onPress={() => router.push(`/projects/${projectId}/reports/${r.id}` as never)} activeOpacity={0.85}>
            <Card>
              <View style={styles.row}>
                <Text style={[styles.title, { color: colors.foreground }]}>تقرير #{r.reportNumber}</Text>
                <View style={[styles.badge, { backgroundColor: (r.status === "approved" ? colors.success : colors.warning) + "22", borderColor: r.status === "approved" ? colors.success : colors.warning }]}>
                  <Text style={[styles.badgeText, { color: r.status === "approved" ? colors.success : colors.warning }]}>{r.status === "approved" ? "معتمد" : "مسودة"}</Text>
                </View>
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{r.type} · {r.reportDate}</Text>
              {r.workDescription ? (
                <Text style={[styles.desc, { color: colors.foreground }]} numberOfLines={2}>{r.workDescription}</Text>
              ) : null}
              {r.progressPercentage != null ? (
                <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 4 }]}>التقدم: {r.progressPercentage}%</Text>
              ) : null}
            </Card>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontFamily: "Cairo_700Bold", fontSize: 15, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontFamily: "Cairo_600SemiBold", fontSize: 11 },
  meta: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
  desc: { fontFamily: "Cairo_400Regular", fontSize: 13, marginTop: 6 },
});

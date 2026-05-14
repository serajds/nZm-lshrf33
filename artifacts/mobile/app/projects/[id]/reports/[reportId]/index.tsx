import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ApiError, apiDeleteReport, apiGetReport, apiMyProjectPermissions, apiSetReportStatus } from "@/lib/api";

export default function ReportDetailScreen() {
  const { id, reportId } = useLocalSearchParams<{ id: string; reportId: string }>();
  const projectId = Number(id);
  const rId = Number(reportId);
  const colors = useColors();
  const qc = useQueryClient();
  const { user } = useAuth();

  const reportQ = useQuery({ queryKey: ["report", projectId, rId], queryFn: () => apiGetReport(projectId, rId), enabled: Number.isFinite(projectId) && Number.isFinite(rId) });
  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId), enabled: Number.isFinite(projectId) });

  const setStatus = useMutation({
    mutationFn: (s: "draft" | "approved") => apiSetReportStatus(projectId, rId, s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report", projectId, rId] }); qc.invalidateQueries({ queryKey: ["reports", projectId] }); },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل تحديث الحالة"),
  });
  const del = useMutation({
    mutationFn: () => apiDeleteReport(projectId, rId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports", projectId] }); router.back(); },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل حذف التقرير"),
  });

  const r = reportQ.data;
  const isPM = permsQ.data?.role === "admin" || permsQ.data?.projectRole === "project_manager";
  const canEdit = !!permsQ.data?.tabPermissions?.reports?.edit || !!permsQ.data?.canEditAll;

  return (
    <Screen title={r ? `تقرير #${r.reportNumber}` : "تقرير"} back refreshing={reportQ.isFetching} onRefresh={() => reportQ.refetch()}>
      {reportQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : !r ? (
        <Empty icon="alert-circle" title="تعذّر تحميل التقرير" />
      ) : (
        <>
          <Card>
            <View style={styles.row}>
              <Text style={[styles.title, { color: colors.foreground }]}>{r.type}</Text>
              <View style={[styles.badge, { backgroundColor: (r.status === "approved" ? colors.success : colors.warning) + "22", borderColor: r.status === "approved" ? colors.success : colors.warning }]}>
                <Text style={[styles.badgeText, { color: r.status === "approved" ? colors.success : colors.warning }]}>{r.status === "approved" ? "معتمد" : "مسودة"}</Text>
              </View>
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>التاريخ: {r.reportDate}</Text>
            {r.progressPercentage != null ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>نسبة التقدم: {r.progressPercentage}%</Text>
            ) : null}
          </Card>

          {r.workDescription ? (
            <Card>
              <Text style={[styles.sectionLabel, { color: colors.foreground }]}>وصف الأعمال</Text>
              <Text style={[styles.body, { color: colors.foreground }]}>{r.workDescription}</Text>
            </Card>
          ) : null}
          {r.technicalNotes ? (
            <Card>
              <Text style={[styles.sectionLabel, { color: colors.foreground }]}>ملاحظات فنية</Text>
              <Text style={[styles.body, { color: colors.foreground }]}>{r.technicalNotes}</Text>
            </Card>
          ) : null}
          {r.recommendations ? (
            <Card>
              <Text style={[styles.sectionLabel, { color: colors.foreground }]}>التوصيات</Text>
              <Text style={[styles.body, { color: colors.foreground }]}>{r.recommendations}</Text>
            </Card>
          ) : null}

          {r.imageUrls && r.imageUrls.length > 0 ? (
            <Card>
              <Text style={[styles.sectionLabel, { color: colors.foreground }]}>الصور ({r.imageUrls.length})</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                {r.imageUrls.map((u, i) => (
                  <Image key={i} source={{ uri: u }} style={styles.thumb} resizeMode="cover" />
                ))}
              </ScrollView>
            </Card>
          ) : null}

          <View style={{ gap: 10, marginTop: 8 }}>
            {isPM && r.status === "draft" ? (
              <PrimaryButton label="اعتماد التقرير" icon="check-circle" loading={setStatus.isPending} onPress={() => setStatus.mutate("approved")} />
            ) : null}
            {isPM && r.status === "approved" ? (
              <PrimaryButton label="إرجاع لمسودة" kind="secondary" icon="rotate-ccw" loading={setStatus.isPending} onPress={() => setStatus.mutate("draft")} />
            ) : null}
            {canEdit && r.status === "draft" && (r.createdById === user?.id || isPM) ? (
              <PrimaryButton label="تعديل" icon="edit-2" kind="secondary" onPress={() => router.push(`/projects/${projectId}/reports/${rId}/edit` as never)} />
            ) : null}
            {canEdit && r.status === "draft" && (r.createdById === user?.id || isPM) ? (
              <PrimaryButton label="حذف" kind="destructive" icon="trash-2" loading={del.isPending} onPress={() =>
                Alert.alert("تأكيد", "حذف التقرير نهائياً؟", [
                  { text: "إلغاء", style: "cancel" },
                  { text: "حذف", style: "destructive", onPress: () => del.mutate() },
                ])
              } />
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontFamily: "Cairo_700Bold", fontSize: 16, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontFamily: "Cairo_600SemiBold", fontSize: 11 },
  meta: { fontFamily: "Cairo_400Regular", fontSize: 13, marginTop: 6 },
  sectionLabel: { fontFamily: "Cairo_700Bold", fontSize: 14, marginBottom: 6 },
  body: { fontFamily: "Cairo_400Regular", fontSize: 14, lineHeight: 22 },
  thumb: { width: 110, height: 110, borderRadius: 10, marginEnd: 8, backgroundColor: "#e5e7eb" },
});

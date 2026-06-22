import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Card, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { ApiError, apiGetReport, apiUpdateReport } from "@/lib/api";

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "weekly", label: "أسبوعي" },
  { value: "monthly", label: "شهري" },
];

export default function EditReportScreen() {
  const { id, reportId } = useLocalSearchParams<{ id: string; reportId: string }>();
  const projectId = Number(id);
  const reportIdNum = Number(reportId);
  const colors = useColors();
  const qc = useQueryClient();

  const reportQ = useQuery({
    queryKey: ["report", projectId, reportIdNum],
    queryFn: () => apiGetReport(projectId, reportIdNum),
    enabled: Number.isFinite(projectId) && Number.isFinite(reportIdNum),
  });

  const [type, setType] = useState("weekly");
  const [reportDate, setReportDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [technicalNotes, setTechnicalNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const r = reportQ.data;
    if (!r) return;
    setType(r.type ?? "weekly");
    setReportDate((r.reportDate ?? "").slice(0, 10));
    setPeriodStart((r.periodStart ?? "").slice(0, 10));
    setPeriodEnd((r.periodEnd ?? "").slice(0, 10));
    setWorkDescription(r.workDescription ?? "");
    setTechnicalNotes(r.technicalNotes ?? "");
    setRecommendations(r.recommendations ?? "");
    setProgress(r.progressPercentage != null ? String(r.progressPercentage) : "");
  }, [reportQ.data]);

  const update = useMutation({
    mutationFn: () => apiUpdateReport(projectId, reportIdNum, {
      type, reportDate, periodStart, periodEnd,
      workDescription,
      technicalNotes: technicalNotes || null,
      recommendations: recommendations || null,
      progressPercentage: progress.trim() ? Number(progress) : null,
    } as never),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report", projectId, reportIdNum] });
      qc.invalidateQueries({ queryKey: ["reports", projectId] });
      router.back();
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل تحديث التقرير"),
  });

  if (reportQ.isLoading) {
    return <Screen title="تعديل التقرير" back><Card><ActivityIndicator color={colors.primary} /></Card></Screen>;
  }

  return (
    <Screen title={`تعديل تقرير #${reportQ.data?.reportNumber ?? ""}`} back>
      <Card>
        <Label colors={colors}>نوع التقرير</Label>
        <View style={styles.chipsRow}>
          {REPORT_TYPES.map(t => (
            <Text
              key={t.value}
              onPress={() => setType(t.value)}
              style={[
                styles.chip,
                {
                  backgroundColor: type === t.value ? colors.primary : colors.secondary,
                  color: type === t.value ? colors.primaryForeground : colors.foreground,
                  borderColor: type === t.value ? colors.primary : colors.border,
                },
              ]}
            >
              {t.label}
            </Text>
          ))}
        </View>

        <Label colors={colors}>تاريخ التقرير</Label>
        <TextInput value={reportDate} onChangeText={setReportDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />

        <Label colors={colors}>بداية الفترة</Label>
        <TextInput value={periodStart} onChangeText={setPeriodStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />

        <Label colors={colors}>نهاية الفترة</Label>
        <TextInput value={periodEnd} onChangeText={setPeriodEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />

        <Label colors={colors}>نسبة التقدم (%)</Label>
        <TextInput value={progress} onChangeText={setProgress} keyboardType="numeric" placeholder="مثال: 35" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />

        <Label colors={colors}>وصف الأعمال</Label>
        <TextInput value={workDescription} onChangeText={setWorkDescription} multiline placeholder="ما تم إنجازه…" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.area, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" textAlignVertical="top" />

        <Label colors={colors}>ملاحظات فنية</Label>
        <TextInput value={technicalNotes} onChangeText={setTechnicalNotes} multiline placeholder="ملاحظات (اختياري)" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.area, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" textAlignVertical="top" />

        <Label colors={colors}>التوصيات</Label>
        <TextInput value={recommendations} onChangeText={setRecommendations} multiline placeholder="توصيات (اختياري)" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.area, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" textAlignVertical="top" />
      </Card>

      <PrimaryButton
        label="حفظ التعديلات"
        icon="save"
        loading={update.isPending}
        disabled={!reportDate || !periodStart || !periodEnd || !workDescription.trim()}
        onPress={() => update.mutate()}
      />
    </Screen>
  );
}

function Label({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return <Text style={{ fontFamily: "Cairo_600SemiBold", fontSize: 13, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Cairo_400Regular", fontSize: 14, minHeight: 44 },
  area: { minHeight: 92 },
  chipsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, fontFamily: "Cairo_600SemiBold", fontSize: 13, overflow: "hidden" },
});

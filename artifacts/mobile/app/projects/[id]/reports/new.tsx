import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Card, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { ApiError, apiCreateReport } from "@/lib/api";

const REPORT_TYPES = ["يومي", "أسبوعي", "شهري"];

export default function NewReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<string>("يومي");
  const [reportDate, setReportDate] = useState(today);
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [workDescription, setWorkDescription] = useState("");
  const [technicalNotes, setTechnicalNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [progress, setProgress] = useState("");

  // Auto-fill period from reportDate when type changes (daily=same, weekly=7d, monthly=30d).
  function shiftDays(iso: string, days: number): string {
    const d = new Date(iso + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function applyType(t: string) {
    setType(t);
    if (t === "أسبوعي") { setPeriodStart(shiftDays(reportDate, -6)); setPeriodEnd(reportDate); }
    else if (t === "شهري") { setPeriodStart(shiftDays(reportDate, -29)); setPeriodEnd(reportDate); }
    else { setPeriodStart(reportDate); setPeriodEnd(reportDate); }
  }

  const create = useMutation({
    mutationFn: () => {
      if (!workDescription.trim()) throw new ApiError("وصف الأعمال مطلوب", 400, null);
      return apiCreateReport(projectId, {
        type, reportDate,
        periodStart, periodEnd,
        workDescription,
        technicalNotes: technicalNotes || null,
        recommendations: recommendations || null,
        progressPercentage: progress.trim() ? Number(progress) : null,
      } as never);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["reports", projectId] });
      router.replace(`/projects/${projectId}/reports/${r.id}` as never);
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل حفظ التقرير"),
  });

  return (
    <Screen title="تقرير جديد" back>
      <Card>
        <Label colors={colors}>نوع التقرير</Label>
        <View style={styles.chipsRow}>
          {REPORT_TYPES.map(t => (
            <Text
              key={t}
              onPress={() => applyType(t)}
              style={[
                styles.chip,
                {
                  backgroundColor: type === t ? colors.primary : colors.secondary,
                  color: type === t ? colors.primaryForeground : colors.foreground,
                  borderColor: type === t ? colors.primary : colors.border,
                },
              ]}
            >
              {t}
            </Text>
          ))}
        </View>

        <Label colors={colors}>تاريخ التقرير</Label>
        <TextInput value={reportDate} onChangeText={(v) => { setReportDate(v); applyType(type); }} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />

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
        label="حفظ التقرير"
        icon="save"
        loading={create.isPending}
        disabled={!type || !reportDate || !periodStart || !periodEnd || !workDescription.trim()}
        onPress={() => create.mutate()}
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

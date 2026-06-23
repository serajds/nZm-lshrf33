import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import {
  ApiError, apiCreateSuspension, apiDeleteSuspension, apiListSuspensions, apiMyProjectPermissions,
} from "@/lib/api";

const TYPES: { value: string; label: string }[] = [
  { value: "official_holiday", label: "عطلة رسمية" },
  { value: "force_majeure", label: "قوة قاهرة" },
  { value: "contractor_delay", label: "تأخير المقاول" },
];

export default function SuspensionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState("official_holiday");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId) });
  const canEdit = !!permsQ.data?.tabPermissions?.suspensions?.edit || !!permsQ.data?.canEditAll;
  const listQ = useQuery({ queryKey: ["suspensions", projectId], queryFn: () => apiListSuspensions(projectId), enabled: Number.isFinite(projectId) });

  const create = useMutation({
    mutationFn: () => apiCreateSuspension(projectId, {
      type, title, startDate, endDate,
      reason: reason || null, documentRef: null, approvedBy: null, notes: null,
      shiftDates: type !== "contractor_delay",
    }),
    onSuccess: () => {
      setShowForm(false); setTitle(""); setStartDate(""); setEndDate(""); setReason("");
      qc.invalidateQueries({ queryKey: ["suspensions", projectId] });
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل الحفظ"),
  });

  const remove = useMutation({
    mutationFn: (suspId: number) => apiDeleteSuspension(projectId, suspId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suspensions", projectId] }),
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "تعذّر الحذف"),
  });

  return (
    <Screen
      title="فترات التوقف"
      back
      refreshing={listQ.isFetching}
      onRefresh={() => listQ.refetch()}
    >
      {canEdit && !showForm && (
        <PrimaryButton label="إضافة توقّف جديد" icon="plus" onPress={() => setShowForm(true)} />
      )}
      {canEdit && showForm && (
        <Card>
          <Label colors={colors}>النوع</Label>
          <View style={styles.chipsRow}>
            {TYPES.map(t => (
              <Text
                key={t.value}
                onPress={() => setType(t.value)}
                style={[styles.chip, {
                  backgroundColor: type === t.value ? colors.primary : colors.secondary,
                  color: type === t.value ? colors.primaryForeground : colors.foreground,
                  borderColor: type === t.value ? colors.primary : colors.border,
                }]}
              >
                {t.label}
              </Text>
            ))}
          </View>
          <Label colors={colors}>العنوان</Label>
          <TextInput value={title} onChangeText={setTitle} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <Label colors={colors}>تاريخ البداية</Label>
          <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <Label colors={colors}>تاريخ النهاية</Label>
          <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <Label colors={colors}>السبب (اختياري)</Label>
          <TextInput value={reason} onChangeText={setReason} multiline placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input, minHeight: 70 }]} textAlign="right" textAlignVertical="top" />
          <View style={{ flexDirection: "row-reverse", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label="حفظ" icon="save" loading={create.isPending} disabled={!title || !startDate || !endDate} onPress={() => create.mutate()} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton label="إلغاء" icon="x" kind="secondary" onPress={() => setShowForm(false)} />
            </View>
          </View>
        </Card>
      )}
      {!listQ.data?.length ? (
        <Empty icon="pause-circle" title="لا توجد فترات توقّف" />
      ) : (
        listQ.data.map(s => (
          <Card key={s.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{s.title}</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>
                  {TYPES.find(t => t.value === s.type)?.label ?? s.type} • {s.calendarDays} يوم
                </Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>{s.startDate} → {s.endDate}</Text>
                {s.reason ? <Text style={[styles.sub, { color: colors.mutedForeground, marginTop: 4 }]}>{s.reason}</Text> : null}
              </View>
              {canEdit && (
                <TouchableOpacity
                  onPress={() => Alert.alert("حذف التوقّف", "هل تريد الحذف؟", [
                    { text: "إلغاء", style: "cancel" },
                    { text: "حذف", style: "destructive", onPress: () => remove.mutate(s.id) },
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
    </Screen>
  );
}

function Label({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return <Text style={{ fontFamily: "Cairo_600SemiBold", fontSize: 13, color: colors.foreground, marginTop: 12, marginBottom: 6 }}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  name: { fontFamily: "Cairo_700Bold", fontSize: 15, marginBottom: 2 },
  sub: { fontFamily: "Cairo_400Regular", fontSize: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: "Cairo_400Regular", fontSize: 14, minHeight: 44 },
  chipsRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, fontFamily: "Cairo_600SemiBold", fontSize: 13, overflow: "hidden" },
});

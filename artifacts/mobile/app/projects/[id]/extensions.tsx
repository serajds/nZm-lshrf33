import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Card, Empty, PrimaryButton, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import {
  ApiError, apiCreateExtension, apiDeleteExtension, apiListExtensions, apiMyProjectPermissions,
} from "@/lib/api";

export default function ExtensionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [extensionDate, setExtensionDate] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");

  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId) });
  const canEdit = !!permsQ.data?.tabPermissions?.extensions?.edit || !!permsQ.data?.canEditAll;
  const listQ = useQuery({ queryKey: ["extensions", projectId], queryFn: () => apiListExtensions(projectId), enabled: Number.isFinite(projectId) });

  const create = useMutation({
    mutationFn: () => apiCreateExtension(projectId, {
      extensionDate, daysAdded: Number(days),
      reason: reason || null, approvedBy: approvedBy || null,
    }),
    onSuccess: () => {
      setShowForm(false); setExtensionDate(""); setDays(""); setReason(""); setApprovedBy("");
      qc.invalidateQueries({ queryKey: ["extensions", projectId] });
    },
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "فشل الحفظ"),
  });

  const remove = useMutation({
    mutationFn: (extId: number) => apiDeleteExtension(projectId, extId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["extensions", projectId] }),
    onError: (e) => Alert.alert("خطأ", e instanceof ApiError ? e.message : "تعذّر الحذف"),
  });

  return (
    <Screen
      title="تمديدات المدّة"
      back
      refreshing={listQ.isFetching}
      onRefresh={() => listQ.refetch()}
    >
      {canEdit && !showForm && (
        <PrimaryButton label="إضافة تمديد جديد" icon="plus" onPress={() => setShowForm(true)} />
      )}
      {canEdit && showForm && (
        <Card>
          <Label colors={colors}>تاريخ التمديد</Label>
          <TextInput value={extensionDate} onChangeText={setExtensionDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <Label colors={colors}>عدد الأيام المضافة</Label>
          <TextInput value={days} onChangeText={setDays} keyboardType="numeric" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <Label colors={colors}>السبب (اختياري)</Label>
          <TextInput value={reason} onChangeText={setReason} multiline placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input, minHeight: 70 }]} textAlign="right" textAlignVertical="top" />
          <Label colors={colors}>اعتُمد من قِبل (اختياري)</Label>
          <TextInput value={approvedBy} onChangeText={setApprovedBy} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.input }]} textAlign="right" />
          <View style={{ flexDirection: "row-reverse", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton label="حفظ" icon="save" loading={create.isPending} disabled={!extensionDate || !days || Number(days) <= 0} onPress={() => create.mutate()} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton label="إلغاء" icon="x" kind="secondary" onPress={() => setShowForm(false)} />
            </View>
          </View>
        </Card>
      )}
      {!listQ.data?.length ? (
        <Empty icon="calendar" title="لا توجد تمديدات" />
      ) : (
        listQ.data.map(e => (
          <Card key={e.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{e.daysAdded} يوم</Text>
                <Text style={[styles.sub, { color: colors.mutedForeground }]}>تاريخ التمديد: {e.extensionDate}</Text>
                {e.newEndDate ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>نهاية جديدة: {e.newEndDate}</Text> : null}
                {e.reason ? <Text style={[styles.sub, { color: colors.mutedForeground, marginTop: 4 }]}>{e.reason}</Text> : null}
                {e.approvedBy ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>اعتُمد: {e.approvedBy}</Text> : null}
              </View>
              {canEdit && (
                <TouchableOpacity
                  onPress={() => Alert.alert("حذف التمديد", "هل تريد الحذف؟", [
                    { text: "إلغاء", style: "cancel" },
                    { text: "حذف", style: "destructive", onPress: () => remove.mutate(e.id) },
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
});

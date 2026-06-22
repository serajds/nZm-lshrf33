import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { apiListFormTemplates } from "@/lib/api";

export default function FormsListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const q = useQuery({ queryKey: ["forms", projectId], queryFn: () => apiListFormTemplates(projectId), enabled: Number.isFinite(projectId) });
  const list = q.data ?? [];

  return (
    <Screen title="النماذج" back refreshing={q.isFetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : list.length === 0 ? (
        <Empty icon="clipboard" title="لا توجد نماذج" />
      ) : (
        list.map(t => (
          <TouchableOpacity key={t.id} onPress={() => router.push(`/projects/${projectId}/forms/${t.id}` as never)} activeOpacity={0.85}>
            <Card>
              <Text style={[styles.name, { color: colors.foreground }]}>{t.name}</Text>
              {t.description ? <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{t.description}</Text> : null}
              <Text style={[styles.fields, { color: colors.primary }]}>{t.fields.length} حقل · اضغط للتعبئة <Feather name="chevron-left" size={12} /></Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: "Cairo_700Bold", fontSize: 15 },
  desc: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
  fields: { fontFamily: "Cairo_600SemiBold", fontSize: 12, marginTop: 8 },
});

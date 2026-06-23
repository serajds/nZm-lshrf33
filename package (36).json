import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { apiListActivities, apiListActivityGroups } from "@/lib/api";

export default function ActivitiesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();
  const actsQ = useQuery({ queryKey: ["acts", projectId], queryFn: () => apiListActivities(projectId), enabled: Number.isFinite(projectId) });
  const grpQ = useQuery({ queryKey: ["act-groups", projectId], queryFn: () => apiListActivityGroups(projectId), enabled: Number.isFinite(projectId) });

  const groupedView = useMemo(() => {
    const groups = grpQ.data ?? [];
    const acts = actsQ.data ?? [];
    const byGroup = new Map<number | string, typeof acts>();
    for (const a of acts) {
      const k = a.groupId ?? "_none";
      const arr = byGroup.get(k) ?? [];
      arr.push(a); byGroup.set(k, arr);
    }
    const ordered: Array<{ id: number | string; name: string; color: string; items: typeof acts }> = [];
    for (const g of [...groups].sort((x, y) => x.sortOrder - y.sortOrder)) {
      const items = byGroup.get(g.id);
      if (items?.length) ordered.push({ id: g.id, name: g.name, color: g.color, items });
    }
    const orphans = byGroup.get("_none");
    if (orphans?.length) ordered.push({ id: "_none", name: "بدون تصنيف", color: "#94a3b8", items: orphans });
    return ordered;
  }, [actsQ.data, grpQ.data]);

  return (
    <Screen title="الأنشطة" back refreshing={actsQ.isFetching || grpQ.isFetching} onRefresh={() => { actsQ.refetch(); grpQ.refetch(); }}>
      {actsQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : groupedView.length === 0 ? (
        <Empty icon="list" title="لا توجد أنشطة" />
      ) : (
        groupedView.map(g => (
          <View key={g.id} style={{ marginBottom: 16 }}>
            <View style={[styles.groupHeader, { borderColor: g.color, backgroundColor: g.color + "22" }]}>
              <Text style={[styles.groupName, { color: colors.foreground }]}>{g.name}</Text>
              <Text style={[styles.groupCount, { color: colors.mutedForeground }]}>({g.items.length})</Text>
            </View>
            {g.items.map(a => {
              const pct = Math.min(100, Math.max(0, a.actualProgress ?? 0));
              return (
                <Card key={a.id}>
                  <Text style={[styles.actName, { color: colors.foreground }]}>{a.name}</Text>
                  {a.description ? (
                    <Text style={[styles.actDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{a.description}</Text>
                  ) : null}
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${pct}%` }]} />
                  </View>
                  <View style={styles.actMetaRow}>
                    <Text style={[styles.actMeta, { color: colors.mutedForeground }]}>التقدم: {pct}%</Text>
                    {a.weight != null ? <Text style={[styles.actMeta, { color: colors.mutedForeground }]}>الوزن: {a.weight}</Text> : null}
                  </View>
                </Card>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  groupName: { fontFamily: "Cairo_700Bold", fontSize: 14 },
  groupCount: { fontFamily: "Cairo_400Regular", fontSize: 12 },
  actName: { fontFamily: "Cairo_700Bold", fontSize: 14 },
  actDesc: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
  progressTrack: { height: 6, backgroundColor: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginTop: 10 },
  progressFill: { height: "100%", borderRadius: 4 },
  actMetaRow: { flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 6 },
  actMeta: { fontFamily: "Cairo_400Regular", fontSize: 12 },
});

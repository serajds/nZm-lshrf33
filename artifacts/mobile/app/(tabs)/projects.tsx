import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Screen, Card, Empty } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { apiListProjects } from "@/lib/api";

export default function ProjectsScreen() {
  const colors = useColors();
  const q = useQuery({ queryKey: ["projects"], queryFn: apiListProjects });
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const list = q.data ?? [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter(p => p.name.toLowerCase().includes(s) || (p.location ?? "").toLowerCase().includes(s));
  }, [q.data, search]);

  return (
    <Screen title="المشاريع" refreshing={q.isFetching} onRefresh={() => q.refetch()}>
      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="ابحث عن مشروع…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          textAlign="right"
        />
      </View>

      {q.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : filtered.length === 0 ? (
        <Empty icon="folder" title="لا توجد مشاريع" />
      ) : (
        filtered.map(p => (
          <TouchableOpacity key={p.id} onPress={() => router.push(`/projects/${p.id}` as never)} activeOpacity={0.85}>
            <Card>
              <View style={styles.row}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                <View style={[styles.badge, { backgroundColor: statusColor(p.status, colors) + "22", borderColor: statusColor(p.status, colors) }]}>
                  <Text style={[styles.badgeText, { color: statusColor(p.status, colors) }]}>{statusLabel(p.status)}</Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{p.location}</Text>
              </View>
              {p.contractor ? (
                <View style={styles.metaRow}>
                  <Feather name="briefcase" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{p.contractor}</Text>
                </View>
              ) : null}
            </Card>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

function statusLabel(s: string): string {
  return s === "active" ? "نشط" : s === "completed" ? "مكتمل" : s === "delayed" ? "متأخر" : s === "suspended" ? "متوقف" : s;
}
function statusColor(s: string, c: ReturnType<typeof useColors>): string {
  if (s === "active") return c.success;
  if (s === "delayed") return c.warning;
  if (s === "suspended") return c.destructive;
  return c.mutedForeground;
}

const styles = StyleSheet.create({
  searchWrap: { flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: "Cairo_400Regular", fontSize: 14, padding: 0 },
  row: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontFamily: "Cairo_700Bold", fontSize: 15 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontFamily: "Cairo_600SemiBold", fontSize: 11 },
  metaRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6, marginTop: 6 },
  meta: { fontFamily: "Cairo_400Regular", fontSize: 12, flex: 1 },
});

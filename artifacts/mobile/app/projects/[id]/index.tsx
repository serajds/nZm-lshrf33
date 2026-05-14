import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useColors } from "@/hooks/useColors";
import { apiGetProject, apiMyProjectPermissions } from "@/lib/api";

type IconName = React.ComponentProps<typeof Feather>["name"];

export default function ProjectOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = Number(id);
  const colors = useColors();

  const projectQ = useQuery({ queryKey: ["project", projectId], queryFn: () => apiGetProject(projectId), enabled: Number.isFinite(projectId) });
  const permsQ = useQuery({ queryKey: ["project-perms", projectId], queryFn: () => apiMyProjectPermissions(projectId), enabled: Number.isFinite(projectId) });

  const p = projectQ.data;
  const perms = permsQ.data;
  const tabs = perms?.tabPermissions ?? {};
  const can = (k: string) => !!tabs[k]?.view || !!perms?.canEditAll;

  if (!Number.isFinite(projectId)) {
    return <Screen title="مشروع" back><Empty icon="alert-circle" title="معرّف المشروع غير صالح" /></Screen>;
  }

  return (
    <Screen
      title={p?.name ?? "مشروع"}
      back
      refreshing={projectQ.isFetching || permsQ.isFetching}
      onRefresh={() => { projectQ.refetch(); permsQ.refetch(); }}
    >
      {projectQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : !p ? (
        <Empty icon="alert-circle" title="تعذّر تحميل المشروع" />
      ) : (
        <>
          <Card>
            <Text style={[styles.name, { color: colors.foreground }]}>{p.name}</Text>
            <Row icon="map-pin" label={p.location} colors={colors} />
            {p.contractor ? <Row icon="briefcase" label={`المقاول: ${p.contractor}`} colors={colors} /> : null}
            {p.ownerEntity ? <Row icon="user" label={`المالك: ${p.ownerEntity}`} colors={colors} /> : null}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.min(100, Math.max(0, p.overallProgress ?? 0))}%` }]} />
            </View>
            <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>التقدم الكلي: {p.overallProgress ?? 0}%</Text>
          </Card>

          <View style={styles.grid}>
            {can("reports") && (
              <NavTile icon="file-text" label="التقارير" onPress={() => router.push(`/projects/${projectId}/reports` as never)} colors={colors} />
            )}
            {can("activities") && (
              <NavTile icon="list" label="الأنشطة" onPress={() => router.push(`/projects/${projectId}/activities` as never)} colors={colors} />
            )}
            {can("forms") && (
              <NavTile icon="clipboard" label="النماذج" onPress={() => router.push(`/projects/${projectId}/forms` as never)} colors={colors} />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

function Row({ icon, label, colors }: { icon: IconName; label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.row}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[styles.rowText, { color: colors.mutedForeground }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function NavTile({ icon, label, onPress, colors }: { icon: IconName; label: string; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.tileIcon, { backgroundColor: colors.primary + "15" }]}>
        <Feather name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={[styles.tileLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: "Cairo_700Bold", fontSize: 18 },
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 6, marginTop: 8 },
  rowText: { fontFamily: "Cairo_400Regular", fontSize: 13, flex: 1 },
  progressTrack: { height: 8, backgroundColor: "#e5e7eb", borderRadius: 6, overflow: "hidden", marginTop: 14 },
  progressFill: { height: "100%", borderRadius: 6 },
  progressLabel: { fontFamily: "Cairo_600SemiBold", fontSize: 12, marginTop: 6 },
  grid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 12 },
  tile: { flexBasis: "47%", flexGrow: 1, padding: 16, borderRadius: 14, borderWidth: 1, alignItems: "center", gap: 10 },
  tileIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  tileLabel: { fontFamily: "Cairo_700Bold", fontSize: 14 },
});

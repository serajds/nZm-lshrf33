import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Screen, Card, Empty } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiListProjects, apiMyAttendanceStatus } from "@/lib/api";

export default function HomeScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: apiListProjects });
  const attendanceQ = useQuery({
    queryKey: ["my-attendance-status"],
    queryFn: apiMyAttendanceStatus,
    enabled: user?.role !== "owner" && user?.role !== "contractor",
  });

  const projects = projectsQ.data ?? [];
  const checkedIn = (attendanceQ.data ?? []).filter(p => p.currentlyCheckedIn);

  return (
    <Screen
      title="الرئيسية"
      refreshing={projectsQ.isFetching || attendanceQ.isFetching}
      onRefresh={() => { projectsQ.refetch(); attendanceQ.refetch(); }}
    >
      <View style={styles.welcomeRow}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Feather name="user" color={colors.primaryForeground} size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.welcomeHi, { color: colors.mutedForeground }]}>أهلاً بك</Text>
          <Text style={[styles.welcomeName, { color: colors.foreground }]} numberOfLines={1}>{user?.fullName ?? ""}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Card style={{ flex: 1, marginEnd: 6 }}>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>المشاريع</Text>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{projects.length}</Text>
        </Card>
        {user?.role !== "owner" && user?.role !== "contractor" ? (
          <Card style={{ flex: 1, marginStart: 6 }}>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>حضور حالي</Text>
            <Text style={[styles.statValue, { color: checkedIn.length > 0 ? colors.success : colors.foreground }]}>{checkedIn.length}</Text>
          </Card>
        ) : null}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>أحدث المشاريع</Text>
      {projectsQ.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : projects.length === 0 ? (
        <Empty icon="inbox" title="لا توجد مشاريع" description="لم يتم ربطك بأي مشروع بعد." />
      ) : (
        projects.slice(0, 5).map(p => (
          <TouchableOpacity key={p.id} onPress={() => router.push(`/projects/${p.id}` as never)} activeOpacity={0.85}>
            <Card>
              <Text style={[styles.projName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
              <View style={styles.projMeta}>
                <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                <Text style={[styles.projMetaText, { color: colors.mutedForeground }]} numberOfLines={1}>{p.location}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { backgroundColor: colors.primary, width: `${Math.min(100, Math.max(0, p.overallProgress ?? 0))}%` }]} />
              </View>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>التقدم: {p.overallProgress ?? 0}%</Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcomeRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12, marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  welcomeHi: { fontFamily: "Cairo_400Regular", fontSize: 13 },
  welcomeName: { fontFamily: "Cairo_700Bold", fontSize: 17 },
  statsRow: { flexDirection: "row-reverse", marginBottom: 16 },
  statLabel: { fontFamily: "Cairo_600SemiBold", fontSize: 13 },
  statValue: { fontFamily: "Cairo_700Bold", fontSize: 26, marginTop: 4 },
  sectionTitle: { fontFamily: "Cairo_700Bold", fontSize: 16, marginBottom: 10, marginTop: 4 },
  projName: { fontFamily: "Cairo_700Bold", fontSize: 15 },
  projMeta: { flexDirection: "row-reverse", alignItems: "center", gap: 4, marginTop: 6 },
  projMetaText: { fontFamily: "Cairo_400Regular", fontSize: 12 },
  progressTrack: { height: 6, backgroundColor: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginTop: 10 },
  progressFill: { height: "100%", borderRadius: 4 },
  progressLabel: { marginTop: 4, fontFamily: "Cairo_400Regular", fontSize: 12 },
});

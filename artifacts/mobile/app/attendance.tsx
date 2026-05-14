import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Redirect, router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  apiAttendanceCheck,
  apiMyAttendanceStatus,
  ApiError,
  type MyAttendanceProjectStatus,
} from "@/lib/api";

const ROLES_BLOCKED = new Set(["owner", "contractor"]);

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ar-LY", {
      timeZone: "Africa/Tripoli",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export default function AttendanceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { ready, token, user, logout } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<"check_in" | "check_out" | null>(null);

  const blocked = !!user && ROLES_BLOCKED.has(user.role);

  const statusQuery = useQuery({
    queryKey: ["my-attendance-status", user?.id ?? null],
    queryFn: apiMyAttendanceStatus,
    enabled: !blocked && !!token,
  });

  // Route guard: if the auth state finished loading and there's no token
  // (e.g. user reached this screen via deep link or stale back-stack),
  // bounce them to /login instead of letting an unauthenticated 401 appear.
  if (ready && !token) {
    return <Redirect href="/login" />;
  }

  const projects = statusQuery.data ?? [];
  const selected = useMemo<MyAttendanceProjectStatus | null>(() => {
    if (selectedProjectId == null) return projects[0] ?? null;
    return projects.find((p) => p.projectId === selectedProjectId) ?? projects[0] ?? null;
  }, [projects, selectedProjectId]);

  async function handleLogout() {
    Alert.alert("تسجيل الخروج", "هل تريد تسجيل الخروج من التطبيق؟", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "تسجيل الخروج",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  }

  async function ensureLocation(): Promise<Location.LocationObject | null> {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "إذن الموقع مطلوب",
        "يجب السماح بالوصول إلى الموقع الجغرافي لتسجيل الحضور.",
      );
      return null;
    }
    try {
      return await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      Alert.alert("تعذّر تحديد الموقع", "حاول مرة أخرى في مكان مفتوح.");
      return null;
    }
  }

  async function ensureSelfie(): Promise<string | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "إذن الكاميرا مطلوب",
        "يجب السماح باستخدام الكاميرا لالتقاط صورة سيلفي.",
      );
      return null;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      cameraType: ImagePicker.CameraType.front,
      quality: 0.5,
      allowsEditing: false,
      exif: false,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return null;
    return res.assets[0].uri;
  }

  async function doCheck(type: "check_in" | "check_out") {
    if (!selected) return;
    if (busy) return;
    setBusy(type);
    try {
      const selfieUri = await ensureSelfie();
      if (!selfieUri) { setBusy(null); return; }

      const loc = await ensureLocation();
      if (!loc) { setBusy(null); return; }

      await apiAttendanceCheck({
        projectId: selected.projectId,
        type,
        selfieUri,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? null,
      });

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("تم", type === "check_in" ? "تم تسجيل الحضور بنجاح" : "تم تسجيل الانصراف بنجاح");
      await statusQuery.refetch();
    } catch (e) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      let msg = "حدث خطأ أثناء تسجيل العملية";
      let outOfRange = false;
      if (e instanceof ApiError) {
        msg = e.message || msg;
        if (e.data && typeof e.data === "object" && "outOfRange" in e.data) {
          outOfRange = !!(e.data as Record<string, unknown>).outOfRange;
        }
      }
      Alert.alert(outOfRange ? "خارج نطاق الموقع" : "تعذّر التسجيل", msg);
    } finally {
      setBusy(null);
    }
  }

  // ---------- Render branches ----------
  if (statusQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.helloLabel, { color: colors.mutedForeground }]}>مرحبًا</Text>
          <Text style={[styles.helloName, { color: colors.foreground }]} numberOfLines={1}>
            {user?.fullName ?? ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleLogout}
          style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="logout-button"
        >
          <Feather name="log-out" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isFetching && !statusQuery.isLoading}
            onRefresh={() => statusQuery.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {blocked ? (
          <EmptyCard
            icon="lock"
            title="الحضور غير مفعّل لدورك"
            description="حسابك بصلاحية لا تسمح بتسجيل الحضور (مالك / مقاول). تواصل مع المسؤول."
            colors={colors}
          />
        ) : statusQuery.isError ? (
          <EmptyCard
            icon="alert-circle"
            title="تعذّر تحميل البيانات"
            description={statusQuery.error instanceof Error ? statusQuery.error.message : "حاول مجددًا"}
            actionLabel="إعادة المحاولة"
            onAction={() => statusQuery.refetch()}
            colors={colors}
          />
        ) : projects.length === 0 ? (
          <EmptyCard
            icon="inbox"
            title="لا توجد مشاريع"
            description="لم يتم ربطك بأي مشروع بعد. تواصل مع مسؤول النظام."
            colors={colors}
          />
        ) : (
          <>
            {/* Project picker */}
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>المشروع</Text>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.85}
              style={[
                styles.pickerBtn,
                { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14 },
              ]}
              testID="project-picker"
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerName, { color: colors.foreground }]} numberOfLines={1}>
                  {selected?.projectName ?? "—"}
                </Text>
                {selected ? (
                  <View style={styles.pickerMetaRow}>
                    <Feather
                      name={selected.hasSiteLocation ? "map-pin" : "alert-triangle"}
                      size={13}
                      color={selected.hasSiteLocation ? colors.mutedForeground : colors.warning}
                    />
                    <Text
                      style={[
                        styles.pickerMeta,
                        { color: selected.hasSiteLocation ? colors.mutedForeground : colors.warning },
                      ]}
                    >
                      {selected.hasSiteLocation
                        ? `نطاق الموقع: ${selected.siteRadiusMeters ?? "—"} م`
                        : "لم يُحدَّد موقع الموقع بعد"}
                    </Text>
                  </View>
                ) : null}
              </View>
              {projects.length > 1 ? (
                <Feather name="chevron-down" size={20} color={colors.mutedForeground} />
              ) : null}
            </TouchableOpacity>

            {/* Status card */}
            {selected ? (
              <StatusCard status={selected} colors={colors} />
            ) : null}

            {/* Action buttons */}
            <View style={{ marginTop: 24, gap: 12 }}>
              <ActionButton
                kind="primary"
                disabled={!selected || !!busy || (selected?.currentlyCheckedIn ?? false)}
                loading={busy === "check_in"}
                icon="log-in"
                label="تسجيل الحضور"
                onPress={() => doCheck("check_in")}
                colors={colors}
                testID="check-in-button"
              />
              <ActionButton
                kind="destructive"
                disabled={!selected || !!busy || !(selected?.currentlyCheckedIn ?? false)}
                loading={busy === "check_out"}
                icon="log-out"
                label="تسجيل الانصراف"
                onPress={() => doCheck("check_out")}
                colors={colors}
                testID="check-out-button"
              />
            </View>

            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              سيتم طلب إذن الكاميرا والموقع عند أول استخدام.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Project picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
          style={styles.modalBackdrop}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>اختر المشروع</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {projects.map((p) => {
                const isActive = selected?.projectId === p.projectId;
                return (
                  <TouchableOpacity
                    key={p.projectId}
                    onPress={() => {
                      setSelectedProjectId(p.projectId);
                      setPickerOpen(false);
                    }}
                    style={[
                      styles.modalItem,
                      { borderColor: colors.border, backgroundColor: isActive ? colors.accent : "transparent" },
                    ]}
                  >
                    <Text style={[styles.modalItemText, { color: colors.foreground }]} numberOfLines={1}>
                      {p.projectName}
                    </Text>
                    {isActive ? <Feather name="check" size={18} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ---------- Sub-components ----------

interface ColorsType {
  background: string; foreground: string; card: string; border: string;
  primary: string; primaryForeground: string; muted: string; mutedForeground: string;
  destructive: string; destructiveForeground: string; success: string;
  warning: string; accent: string; secondary: string;
}

function StatusCard({ status, colors }: { status: MyAttendanceProjectStatus; colors: ColorsType }) {
  const checkedIn = status.currentlyCheckedIn;
  const lastTime = status.lastRecord ? formatTime(status.lastRecord.recordedAt) : null;
  const lastType = status.lastRecord?.type;
  return (
    <View
      style={[
        styles.statusCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: 16,
        },
      ]}
    >
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            { backgroundColor: checkedIn ? colors.success : colors.mutedForeground },
          ]}
        />
        <Text style={[styles.statusText, { color: colors.foreground }]}>
          {checkedIn ? "أنت حاليًا داخل الموقع" : "أنت حاليًا خارج الموقع"}
        </Text>
      </View>
      {status.lastRecord ? (
        <View style={[styles.statusMetaRow, { borderTopColor: colors.border }]}>
          <Feather
            name={lastType === "check_in" ? "log-in" : "log-out"}
            size={14}
            color={colors.mutedForeground}
          />
          <Text style={[styles.statusMeta, { color: colors.mutedForeground }]}>
            آخر عملية: {lastType === "check_in" ? "حضور" : "انصراف"} في {lastTime}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  kind, disabled, loading, icon, label, onPress, colors, testID,
}: {
  kind: "primary" | "destructive";
  disabled: boolean;
  loading: boolean;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  colors: ColorsType;
  testID?: string;
}) {
  const bg = disabled
    ? colors.muted
    : kind === "primary" ? colors.primary : colors.destructive;
  const fg = disabled
    ? colors.mutedForeground
    : kind === "primary" ? colors.primaryForeground : colors.destructiveForeground;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[styles.actionBtn, { backgroundColor: bg, borderRadius: 14 }]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          <Feather name={icon} size={20} color={fg} />
          <Text style={[styles.actionBtnText, { color: fg }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function EmptyCard({
  icon, title, description, actionLabel, onAction, colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  colors: ColorsType;
}) {
  return (
    <View
      style={[
        styles.emptyCard,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 16 },
      ]}
    >
      <Feather name={icon} size={36} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{description}</Text>
      {actionLabel ? (
        <TouchableOpacity
          onPress={onAction}
          style={[styles.emptyAction, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
        >
          <Text style={{ color: colors.primaryForeground, fontFamily: "Cairo_700Bold" }}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  helloLabel: { fontSize: 12, fontFamily: "Cairo_400Regular" },
  helloName: { fontSize: 16, fontFamily: "Cairo_700Bold", marginTop: 2 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },

  sectionLabel: { fontSize: 13, fontFamily: "Cairo_600SemiBold", marginBottom: 8 },
  pickerBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1,
  },
  pickerName: { fontSize: 16, fontFamily: "Cairo_700Bold" },
  pickerMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  pickerMeta: { fontSize: 12, fontFamily: "Cairo_400Regular" },

  statusCard: { marginTop: 18, padding: 16, borderWidth: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontFamily: "Cairo_600SemiBold" },
  statusMetaRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusMeta: { fontSize: 13, fontFamily: "Cairo_400Regular" },

  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 16, minHeight: 56,
  },
  actionBtnText: { fontSize: 16, fontFamily: "Cairo_700Bold" },

  hint: { textAlign: "center", marginTop: 22, fontSize: 12, fontFamily: "Cairo_400Regular" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 16,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
  },
  modalTitle: { fontSize: 16, fontFamily: "Cairo_700Bold", marginBottom: 12, textAlign: "center" },
  modalItem: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  modalItemText: { flex: 1, fontSize: 15, fontFamily: "Cairo_600SemiBold" },

  emptyCard: {
    padding: 24, alignItems: "center", borderWidth: 1, gap: 10,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center", marginTop: 6 },
  emptyDesc: { fontSize: 13, fontFamily: "Cairo_400Regular", textAlign: "center" },
  emptyAction: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
});

import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function PendingAssignmentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.iconCircle, { backgroundColor: "#fef3c7" }]}>
          <Feather name="clock" size={32} color="#b45309" />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>
          مرحباً {user?.fullName ?? ""}
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          تم إنشاء حسابك بنجاح. حسابك الآن بانتظار التعيين من قبل مسؤول النظام،
          حيث سيتم إضافتك إلى الشركة والمشاريع المناسبة.
          {"\n\n"}يرجى التواصل مع المسؤول لتفعيل صلاحياتك.
        </Text>

        <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Row label="الاسم" value={user?.fullName ?? "—"} colors={colors} />
          <Row label="رقم الهاتف" value={user?.phone ?? "—"} colors={colors} />
        </View>

        <PrimaryButton label="تسجيل الخروج" icon="log-out" kind="secondary" onPress={() => logout()} />
      </ScrollView>
    </View>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}:</Text>
      <Text style={[styles.rowValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 24, alignItems: "center" },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontFamily: "Cairo_700Bold", fontSize: 20, marginBottom: 8 },
  body: { fontFamily: "Cairo_400Regular", fontSize: 14, textAlign: "center", lineHeight: 24, marginBottom: 20 },
  box: { width: "100%", borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 20 },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { fontFamily: "Cairo_400Regular", fontSize: 13 },
  rowValue: { fontFamily: "Cairo_600SemiBold", fontSize: 13 },
});

import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Screen, Card } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function MoreScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";

  function handleLogout() {
    Alert.alert("تسجيل الخروج", "هل تريد تسجيل الخروج؟", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "تسجيل الخروج", style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  }

  const items: Array<{ icon: React.ComponentProps<typeof Feather>["name"]; label: string; href?: string; onPress?: () => void; danger?: boolean; admin?: boolean }> = [
    { icon: "users", label: "المستخدمون", href: "/admin/users", admin: true },
    { icon: "briefcase", label: "الشركات", href: "/admin/companies", admin: true },
    { icon: "file-text", label: "سجل الأحداث", href: "/admin/audit-log", admin: true },
    { icon: "log-out", label: "تسجيل الخروج", onPress: handleLogout, danger: true },
  ];

  return (
    <Screen title="المزيد">
      <Card>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <Feather name="user" color={colors.primaryForeground} size={24} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>{user?.fullName}</Text>
            <Text style={[styles.profileMeta, { color: colors.mutedForeground }]}>{user?.phone}</Text>
            <Text style={[styles.profileRole, { color: colors.primary }]}>{roleLabel(user?.role)}</Text>
          </View>
        </View>
      </Card>

      {items
        .filter(i => !i.admin || isAdmin)
        .map((item, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => item.href ? router.push(item.href as never) : item.onPress?.()}
            activeOpacity={0.85}
          >
            <Card>
              <View style={styles.itemRow}>
                <Feather name={item.icon} size={20} color={item.danger ? colors.destructive : colors.foreground} />
                <Text style={[styles.itemLabel, { color: item.danger ? colors.destructive : colors.foreground }]}>{item.label}</Text>
                <Feather name="chevron-left" size={18} color={colors.mutedForeground} />
              </View>
            </Card>
          </TouchableOpacity>
        ))}
    </Screen>
  );
}

function roleLabel(r?: string): string {
  switch (r) {
    case "admin": return "مدير النظام";
    case "project_manager": return "مدير مشروع";
    case "engineer": return "مهندس";
    case "contractor": return "مقاول";
    case "owner": return "مالك";
    default: return "—";
  }
}

const styles = StyleSheet.create({
  profileRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  profileName: { fontFamily: "Cairo_700Bold", fontSize: 16 },
  profileMeta: { fontFamily: "Cairo_400Regular", fontSize: 13, marginTop: 2 },
  profileRole: { fontFamily: "Cairo_600SemiBold", fontSize: 12, marginTop: 4 },
  itemRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  itemLabel: { flex: 1, fontFamily: "Cairo_600SemiBold", fontSize: 15 },
});

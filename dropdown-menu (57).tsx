import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, ViewStyle, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface ScreenProps {
  title: string;
  children: React.ReactNode;
  back?: boolean;
  right?: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: ViewStyle;
}

export function Screen({ title, children, back, right, scroll = true, refreshing, onRefresh, contentStyle }: ScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        {back ? (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="chevron-right" size={22} color={colors.foreground} />
          </TouchableOpacity>
        ) : <View style={{ width: 32 }} />}
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
        <View style={{ minWidth: 32, alignItems: "flex-start" }}>{right}</View>
      </View>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[{ padding: 16, paddingBottom: 32 }, contentStyle]}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, padding: 16 }, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>
  );
}

export function Empty({ icon, title, description, action }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; description?: string; action?: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={42} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {description ? <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>{description}</Text> : null}
      {action}
    </View>
  );
}

export function PrimaryButton({ label, onPress, loading, disabled, icon, kind = "primary", testID }: {
  label: string; onPress: () => void; loading?: boolean; disabled?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"]; kind?: "primary" | "secondary" | "destructive"; testID?: string;
}) {
  const colors = useColors();
  const bg = kind === "destructive" ? colors.destructive : kind === "secondary" ? colors.secondary : colors.primary;
  const fg = kind === "secondary" ? colors.foreground : colors.primaryForeground;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!!disabled || !!loading}
      activeOpacity={0.85}
      testID={testID}
      style={[styles.btn, { backgroundColor: disabled ? colors.muted : bg, opacity: loading ? 0.7 : 1 }]}
    >
      {icon ? <Feather name={icon} size={18} color={fg} style={{ marginEnd: 6 }} /> : null}
      <Text style={[styles.btnText, { color: disabled ? colors.mutedForeground : fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10, paddingTop: 6, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 6, minWidth: 32 },
  title: { flex: 1, textAlign: "center", fontFamily: "Cairo_700Bold", fontSize: 18 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  empty: { alignItems: "center", padding: 28, gap: 6 },
  emptyTitle: { fontFamily: "Cairo_700Bold", fontSize: 15, marginTop: 6 },
  emptyDesc: { fontFamily: "Cairo_400Regular", fontSize: 13, textAlign: "center" },
  btn: {
    minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center",
    flexDirection: "row-reverse",
  },
  btnText: { fontFamily: "Cairo_700Bold", fontSize: 15 },
});

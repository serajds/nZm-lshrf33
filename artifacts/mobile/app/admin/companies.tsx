import { useQuery } from "@tanstack/react-query";
import React from "react";
import { StyleSheet, Text } from "react-native";
import { Card, Empty, Screen } from "@/components/Screen";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiListCompanies } from "@/lib/api";

const TYPE_LABEL: Record<string, string> = {
  contractor: "مقاول", supervisor: "إشراف", owner: "مالك", consultant: "استشاري",
};

export default function AdminCompaniesScreen() {
  const { user } = useAuth();
  const colors = useColors();
  const q = useQuery({ queryKey: ["companies"], queryFn: apiListCompanies, enabled: user?.role === "admin" });

  if (user?.role !== "admin") {
    return <Screen title="الشركات" back><Empty icon="lock" title="غير مصرح" /></Screen>;
  }
  const list = q.data ?? [];

  return (
    <Screen title="الشركات" back refreshing={q.isFetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? (
        <Card><Text style={{ color: colors.mutedForeground, fontFamily: "Cairo_400Regular" }}>جاري التحميل…</Text></Card>
      ) : list.length === 0 ? (
        <Empty icon="briefcase" title="لا توجد شركات" />
      ) : (
        list.map(c => (
          <Card key={c.id}>
            <Text style={[styles.name, { color: colors.foreground }]}>{c.name}</Text>
            <Text style={[styles.type, { color: colors.primary }]}>{TYPE_LABEL[c.type] ?? c.type}</Text>
            {c.phone ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>{c.phone}</Text> : null}
            {c.email ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>{c.email}</Text> : null}
            {c.address ? <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={2}>{c.address}</Text> : null}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: "Cairo_700Bold", fontSize: 15 },
  type: { fontFamily: "Cairo_600SemiBold", fontSize: 12, marginTop: 2 },
  meta: { fontFamily: "Cairo_400Regular", fontSize: 12, marginTop: 4 },
});

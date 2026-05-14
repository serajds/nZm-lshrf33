import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function TabsLayout() {
  const { ready, token, user } = useAuth();
  const colors = useColors();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  const isAdmin = user?.role === "admin";
  const fieldRole = user?.role !== "owner" && user?.role !== "contractor";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: "Cairo_600SemiBold", fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "الرئيسية", tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: "المشاريع", tabBarIcon: ({ color, size }) => <Feather name="folder" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "الحضور",
          tabBarIcon: ({ color, size }) => <Feather name="check-circle" color={color} size={size} />,
          href: fieldRole ? "/(tabs)/attendance" : null,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: isAdmin ? "إدارة" : "المزيد",
          tabBarIcon: ({ color, size }) => <Feather name="menu" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

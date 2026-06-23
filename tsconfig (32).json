import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function IndexScreen() {
  const { ready, token, user } = useAuth();
  const colors = useColors();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;
  if (user?.incompleteProfile) return <Redirect href="/pending-assignment" />;
  return <Redirect href="/(tabs)/home" />;
}

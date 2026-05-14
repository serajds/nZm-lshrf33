import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  useFonts,
} from "@expo-google-fonts/cairo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { I18nManager, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

if (Platform.OS !== "web" && !I18nManager.isRTL) {
  try {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  } catch { /* swallow */ }
}

function RootLayoutNav() {
  // Deep-link push notifications: when the user taps a notification, route
  // them to the relevant screen if our payload tells us where to go.
  useEffect(() => {
    function routeFromData(data: Record<string, unknown> | undefined) {
      if (!data) return;
      try {
        if (data.projectId && data.reportId) {
          router.push(`/projects/${Number(data.projectId)}/reports/${Number(data.reportId)}` as never);
        } else if (data.projectId) {
          router.push(`/projects/${Number(data.projectId)}` as never);
        }
      } catch { /* ignore */ }
    }

    // Cold-start: app opened by tapping a notification while killed.
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) routeFromData(resp.notification.request.content.data as Record<string, unknown> | undefined);
    }).catch(() => {});

    // Foreground/background tap.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeFromData(resp.notification.request.content.data as Record<string, unknown> | undefined);
    });
    return () => sub.remove();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackTitle: "رجوع",
        contentStyle: { backgroundColor: "#f1f3f6" },
      }}
    />
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Cairo_400Regular,
    Cairo_600SemiBold,
    Cairo_700Bold,
  });
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    if ((fontsLoaded || fontError) && !splashHidden) {
      SplashScreen.hideAsync().catch(() => {});
      setSplashHidden(true);
    }
  }, [fontsLoaded, fontError, splashHidden]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

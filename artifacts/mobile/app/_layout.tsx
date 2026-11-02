import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
  useFonts,
} from "@expo-google-fonts/cairo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, I18nManager, Platform, View, Text, Pressable } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { startGeofenceReminder, stopGeofenceReminder } from "@/lib/geofenceReminder";
import { flushQueue } from "@/lib/offlineQueue";

const TypedGestureHandlerRootView = GestureHandlerRootView as React.ComponentType<
  React.PropsWithChildren<React.ComponentProps<typeof GestureHandlerRootView>>
>;

SplashScreen.preventAutoHideAsync();

if (Platform.OS !== "web" && !I18nManager.isRTL) {
  try {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  } catch { /* swallow */ }
}

function GeofenceReminderBoot() {
  const { user, ready } = useAuth();
  useEffect(() => {
    if (!ready) return;
    const update = () => {
      if (user && AppState.currentState === "active") void startGeofenceReminder(user.id);
      else stopGeofenceReminder();
    };
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => { subscription.remove(); stopGeofenceReminder(); };
  }, [ready, user?.id]);
  return null;
}

function IdentityQueryProvider({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  const identity = ready ? (user ? `user:${user.id}` : "anonymous") : "loading";
  // A separate client makes it impossible for a same-key query from the
  // previous account to render while the new account's request is in flight.
  const queryClient = useMemo(() => new QueryClient(), [identity]);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function OfflineAttendanceBoot() {
  const { ready, user } = useAuth();
  const activeUserId = useRef<number | null>(user?.id ?? null);
  activeUserId.current = user?.id ?? null;

  useEffect(() => {
    if (!ready || !user) return;
    const ownerUserId = user.id;
    const flush = () => {
      void flushQueue(ownerUserId, () => activeUserId.current === ownerUserId).catch(() => {});
    };
    flush();
    let wasConnected: boolean | null = null;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      if (connected && wasConnected === false) flush();
      wasConnected = connected;
    });
    return unsubscribe;
  }, [ready, user?.id]);

  return null;
}

function RootLayoutNav() {
  const { connectionError, isRetryingAuth, retryAuth, token } = useAuth();
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
    <>
    {connectionError && token && <View style={{ padding: 12, backgroundColor: "#fff4db" }}>
      <Text style={{ textAlign: "right", color: "#754b00" }}>تعذّر التحقق من الجلسة. لم يتم تسجيل خروجك.</Text>
      <Pressable disabled={isRetryingAuth} onPress={() => { void retryAuth(); }}>
        <Text style={{ textAlign: "right", color: "#086c85", paddingTop: 6 }}>{isRetryingAuth ? "جارٍ التحقق..." : "إعادة المحاولة"}</Text>
      </Pressable>
    </View>}
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackTitle: "رجوع",
        contentStyle: { backgroundColor: "#f1f3f6" },
      }}
    />
    </>
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
        <TypedGestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AuthProvider>
              <IdentityQueryProvider>
                <GeofenceReminderBoot />
                <OfflineAttendanceBoot />
                <RootLayoutNav />
              </IdentityQueryProvider>
            </AuthProvider>
          </KeyboardProvider>
        </TypedGestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

import React, { useEffect } from "react";
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nManager } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/auth-context";
import { queryClient } from "@/lib/query-client";
import {
  NotoKufiArabic_400Regular,
  NotoKufiArabic_500Medium,
  NotoKufiArabic_600SemiBold,
  NotoKufiArabic_700Bold,
  useFonts,
} from "@expo-google-fonts/noto-kufi-arabic";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    NotoKufiArabic_400Regular,
    NotoKufiArabic_500Medium,
    NotoKufiArabic_600SemiBold,
    NotoKufiArabic_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <StatusBar style="auto" />
              <Stack screenOptions={{ headerShown: false }} />
            </KeyboardProvider>
          </GestureHandlerRootView>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

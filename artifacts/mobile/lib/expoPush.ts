/**
 * Expo Push: register the device's token with our API after login,
 * unregister on logout. Notifications API is no-op in Expo Go (SDK 53+) —
 * the token is only obtained inside a development build / EAS preview APK.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiRegisterExpoPushToken, apiUnregisterExpoPushToken } from "./api";

const TOKEN_STORAGE_KEY = "expo_push_token_v1";
let _currentToken: string | null = null;

export function getCurrentExpoPushToken(): string | null { return _currentToken; }

async function loadStoredToken(): Promise<string | null> {
  if (_currentToken) return _currentToken;
  try {
    const stored = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (stored) _currentToken = stored;
  } catch { /* ignore */ }
  return _currentToken;
}

async function persistToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch { /* ignore */ }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "إشعارات",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#285a93",
    });
  } catch {}
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) return null;
  await ensureAndroidChannel();

  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return null;

    const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
    const projectId = typeof extra.eas?.projectId === "string" && extra.eas.projectId.length > 0
      ? extra.eas.projectId
      : undefined;

    const tokenResp = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    const token = tokenResp.data;
    if (!token) return null;
    _currentToken = token;
    await persistToken(token);
    try {
      await apiRegisterExpoPushToken(
        token,
        Platform.OS,
        `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim() || "device",
      );
    } catch {
      // Network failure is fine — we'll re-try on next launch.
    }
    return token;
  } catch {
    return null;
  }
}

export async function unregisterCurrentToken(): Promise<void> {
  // Recover the token from storage if it was registered in a prior session
  // and we haven't re-initialized this module yet — keeps unregister
  // deterministic across app restarts.
  const token = await loadStoredToken();
  if (!token) return;
  try { await apiUnregisterExpoPushToken(token); } catch { /* ignore */ }
  _currentToken = null;
  await persistToken(null);
}

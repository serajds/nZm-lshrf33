/**
 * Expo Push: register the device's token with our API after login,
 * unregister on logout. Notifications API is no-op in Expo Go (SDK 53+) —
 * the token is only obtained inside a development build / EAS preview APK.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiRegisterExpoPushToken, apiUnregisterExpoPushToken } from "./api";

let _currentToken: string | null = null;
export function getCurrentExpoPushToken(): string | null { return _currentToken; }

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
  if (!_currentToken) return;
  try { await apiUnregisterExpoPushToken(_currentToken); } catch {}
  _currentToken = null;
}

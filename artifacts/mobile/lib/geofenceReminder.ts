/**
 * Geofence reminder: while the app is open, watch the device's location and
 * fire a local notification when the user enters the radius of any project
 * site they have access to — reminding them to check in.
 *
 * Notes:
 * - Uses foreground location only (no background permission required → can
 *   be shipped via OTA update without rebuilding the APK).
 * - Per-project debounce: we never re-notify the same project within
 *   REMINDER_COOLDOWN_MS (default 6 hours).
 * - Skips a project if the user is already checked in there.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

import { apiListProjects, apiMyAttendanceStatus, type ApiProject, type MyAttendanceProjectStatus } from "./api";

const STORAGE_KEY = "geofence_reminder_last_v1";
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per project

let _watcher: Location.LocationSubscription | null = null;
let _projects: Array<{ id: number; name: string; lat: number; lng: number; radius: number }> = [];
let _lastSentByProject: Record<string, number> = {};
let _lastRefreshAt = 0;
let _refreshing = false;

async function loadLastSent(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) _lastSentByProject = JSON.parse(raw) as Record<string, number>;
  } catch { /* ignore */ }
}

async function persistLastSent(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_lastSentByProject));
  } catch { /* ignore */ }
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function refreshProjectsCache(): Promise<void> {
  if (_refreshing) return;
  if (Date.now() - _lastRefreshAt < 5 * 60 * 1000 && _projects.length > 0) return;
  _refreshing = true;
  try {
    const list = await apiListProjects();
    _projects = (list as ApiProject[])
      .filter((p) => typeof p.siteLatitude === "number" && typeof p.siteLongitude === "number")
      .map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.siteLatitude as number,
        lng: p.siteLongitude as number,
        radius: typeof p.siteRadiusMeters === "number" && p.siteRadiusMeters > 0 ? p.siteRadiusMeters : 200,
      }));
    _lastRefreshAt = Date.now();
  } catch { /* ignore — keep last cache */ }
  finally { _refreshing = false; }
}

async function isCheckedIn(projectId: number): Promise<boolean> {
  try {
    const statuses = await apiMyAttendanceStatus();
    const arr = statuses as MyAttendanceProjectStatus[];
    return !!arr.find((s) => s.projectId === projectId && s.currentlyCheckedIn);
  } catch {
    return false;
  }
}

async function maybeNotify(projectId: number, projectName: string): Promise<void> {
  const key = String(projectId);
  const last = _lastSentByProject[key] ?? 0;
  if (Date.now() - last < REMINDER_COOLDOWN_MS) return;
  if (await isCheckedIn(projectId)) return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "تذكير بتسجيل الحضور",
        body: `أنت الآن داخل نطاق موقع المشروع: ${projectName}`,
        data: { type: "attendance_reminder", projectId },
        sound: "default",
      },
      trigger: null,
    });
    _lastSentByProject[key] = Date.now();
    await persistLastSent();
  } catch { /* ignore */ }
}

async function onLocation(loc: Location.LocationObject): Promise<void> {
  if (_projects.length === 0) return;
  const { latitude, longitude } = loc.coords;
  for (const p of _projects) {
    const d = distanceMeters(latitude, longitude, p.lat, p.lng);
    if (d <= p.radius) {
      // Fire & forget; debouncing happens inside maybeNotify.
      void maybeNotify(p.id, p.name);
    }
  }
}

/**
 * Start watching location and firing reminders. Safe to call repeatedly —
 * subsequent calls are no-ops while a watcher is active.
 */
export async function startGeofenceReminder(): Promise<void> {
  if (_watcher) return;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return; // attendance flow will request it; we don't prompt here.

    await loadLastSent();
    await refreshProjectsCache();
    if (_projects.length === 0) return;

    _watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 50,
      },
      (loc) => { void onLocation(loc); },
    );
  } catch { /* ignore */ }
}

export function stopGeofenceReminder(): void {
  if (_watcher) {
    try { _watcher.remove(); } catch { /* ignore */ }
    _watcher = null;
  }
  _projects = [];
  _lastRefreshAt = 0;
}

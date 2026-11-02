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

import { apiListProjects, apiMyAttendanceStatus, type ApiProject } from "./api";

const STORAGE_KEY = "geofence_reminder_last_v1";
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per project

let _watcher: Location.LocationSubscription | null = null;
let _projects: Array<{ id: number; name: string; lat: number; lng: number; radius: number }> = [];
let _lastSentByProject: Record<string, number> = {};
let _lastRefreshAt = 0;
let _refreshing = false;
let generation = 0;
let starting: Promise<void> | null = null;
let checking: number | null = null;
let storageKey = STORAGE_KEY;

async function loadLastSent(): Promise<void> {
  try {
    const current = generation;
    const raw = await AsyncStorage.getItem(storageKey);
    if (current === generation && raw) _lastSentByProject = JSON.parse(raw) as Record<string, number>;
  } catch { /* ignore */ }
}

async function persistLastSent(): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(_lastSentByProject));
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
  const current = generation;
  try {
    const list = await apiListProjects();
    if (current !== generation) return;
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
  finally { if (current === generation) _refreshing = false; }
}

async function maybeNotify(projectId: number, projectName: string, current: number): Promise<void> {
  const key = String(projectId);
  const last = _lastSentByProject[key] ?? 0;
  if (Date.now() - last < REMINDER_COOLDOWN_MS) return;
  if (current !== generation) return;

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
    if (current !== generation) return;
    _lastSentByProject[key] = Date.now();
    await persistLastSent();
  } catch { /* ignore */ }
}

async function onLocation(loc: Location.LocationObject): Promise<void> {
  if (_projects.length === 0 || checking === generation) return;
  const current = generation;
  checking = current; // Reserve before the first await, not after the request.
  const { latitude, longitude } = loc.coords;
  try {
    await refreshProjectsCache();
    if (current !== generation) return;
    const nearby = _projects.filter(p => distanceMeters(latitude, longitude, p.lat, p.lng) <= p.radius
      && Date.now() - (_lastSentByProject[String(p.id)] ?? 0) >= REMINDER_COOLDOWN_MS);
    if (!nearby.length) return;
    // One authoritative status list for all nearby sites, not one per project.
    const statuses = await apiMyAttendanceStatus();
    if (current !== generation) return;
    for (const project of nearby) {
      const status = statuses.find(s => s.projectId === project.id);
      // A missing row or failed read is unknown, never proof of absence.
      if (status?.currentlyCheckedIn === false) await maybeNotify(project.id, project.name, current);
    }
  } catch { /* Unknown attendance: retry on a later location event, no notification. */ }
  finally { if (checking === current) checking = null; }
}

/**
 * Start watching location and firing reminders. Safe to call repeatedly —
 * subsequent calls are no-ops while a watcher is active.
 */
export async function startGeofenceReminder(userId: number): Promise<void> {
  if (_watcher) return;
  if (starting) return starting;
  const current = generation;
  storageKey = `${STORAGE_KEY}:${userId}`;
  const pending = (async () => { try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted || current !== generation) return;

    await loadLastSent();
    if (current !== generation) return;
    await refreshProjectsCache();
    if (_projects.length === 0 || current !== generation) return;

    const watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 50,
      },
      (loc) => { if (current === generation) void onLocation(loc); },
    );
    if (current !== generation) watcher.remove();
    else _watcher = watcher;
  } catch { /* ignore */ } })();
  starting = pending;
  try { await pending; } finally { if (starting === pending) starting = null; }
}

export function stopGeofenceReminder(): void {
  generation++;
  starting = null;
  checking = null;
  _refreshing = false;
  if (_watcher) {
    try { _watcher.remove(); } catch { /* ignore */ }
    _watcher = null;
  }
  _projects = [];
  _lastSentByProject = {};
  _lastRefreshAt = 0;
}

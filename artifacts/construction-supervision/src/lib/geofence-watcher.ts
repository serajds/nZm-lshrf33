/**
 * Foreground geofence "arrival reminder".
 *
 * While the user has the app open and is *not* yet checked in to a project,
 * we watch their position and trigger a single, debounced alert (Notification
 * + vibration + audio cue) the moment they cross into the project's site
 * radius. The aim is to nudge them to record their attendance the second
 * they arrive, instead of forgetting and doing it from across the city
 * later in the day.
 *
 * Important constraints:
 *   - Strictly client-side; works without push-notification permission
 *     (it falls back to in-page UI when Notification permission is denied).
 *   - Fires at most ONCE per session per project until the user leaves the
 *     radius again (re-arms on exit). Prevents spam if GPS jitters around
 *     the boundary.
 *   - Cleans up its watchPosition handle when the caller disposes.
 */

/**
 * Great-circle distance in meters between two WGS-84 points.
 * Self-contained so this module has zero dependencies on the wider attendance
 * surface — the geofence watcher needs to keep working even if attendance
 * helpers are refactored.
 */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface GeofenceWatchOptions {
  projectId: number;
  projectName: string;
  siteLatitude: number;
  siteLongitude: number;
  /** Radius in meters; defaults to 200 to match the server-side default. */
  radiusMeters: number;
  /** Called when the user enters the radius. */
  onArrive: () => void;
}

export interface GeofenceWatchHandle {
  stop: () => void;
}

/**
 * Begin watching the user's position relative to a project's site geofence.
 * Returns a handle whose `stop()` method must be called by the caller when
 * unmounting / when the user checks in (whichever comes first).
 *
 * No-op (returns a stop-able handle that does nothing) when geolocation is
 * not available or the project has no site coordinates.
 */
export function startGeofenceWatch(opts: GeofenceWatchOptions): GeofenceWatchHandle {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { stop: () => {} };
  }

  // We need the user to actually leave the radius before re-firing,
  // otherwise GPS noise inside the geofence would trigger repeatedly.
  let inside = false;
  let firedThisVisit = false;

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      // Skip wildly inaccurate fixes — an "urban canyon" reading with
      // 500m accuracy that happens to land near the site would cause a
      // false arrival. We require accuracy to be at least as tight as
      // the geofence radius itself.
      const accuracy = pos.coords.accuracy;
      if (Number.isFinite(accuracy) && accuracy > opts.radiusMeters) {
        return;
      }

      const distance = haversineMeters(
        pos.coords.latitude,
        pos.coords.longitude,
        opts.siteLatitude,
        opts.siteLongitude,
      );

      // Add a small hysteresis band so jitter at the exact radius doesn't
      // toggle the state on every reading: enter at radius, exit only after
      // 1.25× radius. With the default 200m radius the exit boundary is 250m.
      const enterBoundary = opts.radiusMeters;
      const exitBoundary = opts.radiusMeters * 1.25;

      if (!inside && distance <= enterBoundary) {
        inside = true;
        if (!firedThisVisit) {
          firedThisVisit = true;
          try { opts.onArrive(); } catch (_e) { /* never let UI errors abort the watcher */ }
        }
      } else if (inside && distance > exitBoundary) {
        inside = false;
        firedThisVisit = false; // re-arm for the next arrival
      }
    },
    (_err) => {
      // Permission denied / position unavailable / timeout — silently ignore.
      // We don't want to blast errors at the user just for opening a page.
    },
    {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 30_000,
    },
  );

  return {
    stop: () => {
      try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
    },
  };
}

/**
 * Best-effort "ding": vibrate (where supported) and play a short tone using
 * the WebAudio API. Falls back gracefully on platforms that don't support
 * either. Safe to call from any event handler.
 */
export function chimeAndVibrate(): void {
  // Vibration: 200ms on, 100ms pause, 200ms on. iOS Safari ignores this.
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
  }

  // Short two-tone chime — uses the browser's audio context. We must NOT
  // pre-create the context at module load (Chrome will warn about an
  // "AudioContext was not allowed to start"); only construct it when called
  // from a user-gesture-adjacent code path.
  try {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;

    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    };

    beep(880, 0, 0.18);
    beep(1175, 0.22, 0.22);

    // Close the context after the chime to free resources.
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    /* ignore — chime is non-essential */
  }
}

/* eslint-disable no-undef */
/**
 * Custom service-worker glue for Web Push, imported into the
 * vite-plugin-pwa generated SW via `workbox.importScripts`.
 *
 * Two responsibilities:
 *   1. Show a notification when a push event arrives from the server.
 *   2. When the user taps the notification, focus an existing app window
 *      (or open a new one) at the URL embedded in the payload.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_e) {
      payload = { title: "إشعار", body: event.data.text() };
    }
  }

  const title = payload.title || "إشعار";
  const options = {
    body: payload.body || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    dir: "rtl",
    lang: "ar",
    data: { url: payload.url || "/", ...(payload.data || {}) },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Try to focus an existing window first.
    for (const c of allClients) {
      try {
        const url = new URL(c.url);
        if (url.origin === self.location.origin) {
          await c.focus();
          if ("navigate" in c) {
            try { await c.navigate(targetUrl); } catch (_e) { /* cross-origin navigate not allowed; ignore */ }
          }
          return;
        }
      } catch (_e) { /* ignore parse errors */ }
    }
    // Otherwise open a new window.
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

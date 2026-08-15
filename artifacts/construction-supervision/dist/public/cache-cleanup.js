// Deletes legacy runtime caches that older service worker versions created.
// Most importantly "api-cache": it used to store /api responses (NetworkFirst,
// 24h) and could replay a stale 401 from /auth/me, kicking freshly logged-in
// users back to the login page. API responses are never cached anymore, and
// this script scrubs the old cache from every device on SW activation.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key === "api-cache" || key.endsWith("-api-cache"))
            .map((key) => caches.delete(key)),
        ),
      )
      .catch(() => {}),
  );
});

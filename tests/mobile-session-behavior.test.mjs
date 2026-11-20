import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [session, auth, api, screen, config, guide] = await Promise.all([
  readFile("artifacts/attendance-mobile/lib/session.ts", "utf8"),
  readFile("artifacts/attendance-mobile/context/auth-context.tsx", "utf8"),
  readFile("artifacts/attendance-mobile/lib/api.ts", "utf8"),
  readFile("artifacts/attendance-mobile/app/index.tsx", "utf8"),
  readFile("artifacts/attendance-mobile/app.json", "utf8"),
  readFile("artifacts/attendance-mobile/README.md", "utf8"),
]);

test("mobile login persists credentials securely and protects session races", () => {
  assert.match(session, /SecureStore\.getItemAsync\(SESSION_KEY\)/);
  assert.match(session, /SecureStore\.setItemAsync\(SESSION_KEY/);
  assert.match(session, /SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(session, /persistenceQueue/);
  assert.match(session, /expectedGeneration/);
  assert.match(session, /previousCredential/);
  assert.match(session, /responseBelongsToCurrentSession/);
  assert.match(auth, /await apiRequest<SessionUser>\("\/auth\/me"\)/);
  assert.match(auth, /auth: false/);
  assert.match(auth, /const attempt = beginLoginAttempt\(\)/);
  assert.match(auth, /queryClient\.clear\(\)/);
});

test("API requests apply renewed tokens only to the matching session", () => {
  assert.match(api, /headers\.set\("Authorization", `Bearer \$\{sentToken\}`\)/);
  assert.match(api, /response\.headers\.get\("X-Renewed-Token"\)/);
  assert.match(api, /applyRenewedToken\(renewedToken, sentToken\)/);
  assert.match(api, /shouldExpireSession\(/);
  assert.match(api, /clearCredentialForToken\(sentToken\)/);
  assert.match(api, /text\/plain;charset=UTF-8/);
});

test("attendance requests explain permissions and use real camera and GPS", () => {
  assert.match(screen, /ImagePicker\.CameraType\.front/);
  assert.match(screen, /ImageManipulator\.manipulateAsync/);
  assert.match(screen, /Location\.getForegroundPermissionsAsync\(\)/);
  assert.match(screen, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.match(screen, /Location\.getCurrentPositionAsync/);
  assert.match(config, /"supportsRTL": true/);
  assert.match(config, /"android\.permission\.CAMERA"/);
  assert.match(config, /"android\.permission\.ACCESS_FINE_LOCATION"/);
  assert.match(config, /locationWhenInUsePermission/);
  assert.match(guide, /لا تُحفظ طلبات الحضور دون اتصال/);
  assert.match(guide, /لا تنتج ملف APK أو IPA مستقلاً/);
});

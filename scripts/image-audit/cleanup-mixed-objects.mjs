import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadSource, output, save } from "./common.mjs";

assert.equal(process.env.NODE_ENV, "development");
assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID, "Separate development bucket required");
assert.notEqual(process.env.IMAGE_AUDIT_BUCKET_ID, process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID);

const ledger = JSON.parse(await readFile(path.join(output, "mixed-cleanup-ledger.json"), "utf8"));
assert.ok(["pending", "needs_recovery", "delete_requests_completed"].includes(ledger.state));
assert.ok(Array.isArray(ledger.keys) && ledger.keys.length > 0);
const keys = [...new Set(ledger.keys)];
assert.equal(keys.length, ledger.keys.length, "Cleanup ledger must not duplicate object keys");
const legacyFixtureKey = /^uploads\/image-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:-thumb)?\.jpg$/i;
assert.ok(
  /^Only this private fixture process/.test(ledger.scope ?? "")
    || keys.every(key => legacyFixtureKey.test(key)),
  "Cleanup ledger must be scoped to the isolated synthetic fixture",
);
for (const key of keys) {
  assert.match(key, /^uploads\/[a-zA-Z0-9._/-]+$/);
  assert.ok(!key.includes(".."));
}

const { objectStorageClient } = await loadSource("artifacts/api-server/src/lib/objectStorage.ts");
const bucket = objectStorageClient.bucket(process.env.IMAGE_AUDIT_BUCKET_ID);
let deleteFailures = 0;
let stillPresent = 0;
const chunkSize = 8;
for (let offset = 0; offset < keys.length; offset += chunkSize) {
  await Promise.all(keys.slice(offset, offset + chunkSize).map(async key => {
    let deleted = false;
    for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
      try {
        await bucket.file(key).delete({ ignoreNotFound: true });
        deleted = true;
      } catch {
        if (attempt === 4) deleteFailures++;
        else await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    try {
      const [exists] = await bucket.file(key).exists();
      if (exists) stillPresent++;
    } catch {
      stillPresent++;
    }
  }));
}

const result = {
  attempted: keys.length,
  deleteFailures,
  stillPresent,
  verifiedAbsent: keys.length - stillPresent,
  scope: "Only exact keys recorded by the isolated synthetic image fixture",
};
await save("mixed-cleanup.json", result);
await save("mixed-cleanup-ledger.json", {
  keys, state: deleteFailures || stillPresent ? "needs_recovery" : "verified_absent",
  scope: ledger.scope,
});
console.log(JSON.stringify({ attempted: result.attempted, deleteFailures, stillPresent, verifiedAbsent: result.verifiedAbsent }));
if (deleteFailures || stillPresent) process.exitCode = 1;

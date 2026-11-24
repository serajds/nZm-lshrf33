// Recovery for an interrupted diagnostic run only, never application assets.
// The first run predated the explicit cleanup ledger: establish ownership by
// the run's timestamp, exact synthetic content hash and reserved key layout.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { output, loadSource, save } from "./common.mjs";

async function recover() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  assert.ok(bucketId);
  assert.ok(bucketId !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Separate test storage required");
  const evidence = JSON.parse(await readFile(path.join(output, "storage-transport-baseline.json"), "utf8"));
  const at = Date.parse(evidence.recordedAt);
  assert.ok(Number.isFinite(at));
  const source = await readFile(path.join(output, "fixtures/detail.jpg"));
  const hash = buffer => createHash("sha256").update(buffer).digest("hex");
  const { objectStorageClient } = await loadSource("artifacts/api-server/src/lib/objectStorage.ts");
  const bucket = objectStorageClient.bucket(bucketId);
  const [files, next] = await bucket.getFiles({ prefix: "development-image-audit/", maxResults: 50, autoPaginate: false });
  assert.ok(!next, "Inventory limit reached; stop without deleting anything");
  const owned = [];
  for (const file of files) {
    if (!/^development-image-audit\/[a-f0-9-]{36}\/(?:base64|binary|direct)\.jpg$/.test(file.name)) continue;
    const [meta] = await file.getMetadata();
    const created = Date.parse(meta.timeCreated);
    if (!(created >= at - 120_000 && created <= at + 5000 && Number(meta.size) === source.length)) continue;
    const [bytes] = await file.download();
    assert.equal(hash(bytes), hash(source), "Content is not the benchmark fixture; stop without deletion");
    owned.push({ key: file.name, generation: meta.generation });
  }
  assert.equal(owned.length, 3, "Expected only this interrupted run's three synthetic objects");
  assert.equal(new Set(owned.map(row => row.key.split("/")[1])).size, 1);
  await save("storage-transport-cleanup-ledger.json", {
    bucketFingerprint: hash(Buffer.from(bucketId)), state: "pending", keys: owned.map(row => row.key),
  });
  for (const row of owned) {
    await bucket.file(row.key).delete({ ifGenerationMatch: row.generation, ignoreNotFound: true });
  }
  await save("storage-transport-cleanup-ledger.json", {
    bucketFingerprint: hash(Buffer.from(bucketId)), state: "cleaned", keys: owned.map(row => row.key),
  });
  await save("storage-transport-cleanup.json", { attempted: 3, cleanupFailures: 0, recoveredInterruptedRun: true });
  console.log("Recovered the interrupted run: verified and removed only its three synthetic objects.");
}
await recover().catch(error => {
  console.error(JSON.stringify({
    status: "BLOCKED", reason: "Ownership verification or cleanup did not complete",
    code: /^[A-Z0-9_]{1,40}$/.test(String(error.code)) ? error.code : null,
  }));
  process.exitCode = 1;
});

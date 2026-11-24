import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

test("image identities survive retries and transitions reject incomplete or stale success", async t => {
  process.env.NODE_ENV = "development";
  const pg = await isolatedPostgres();
  let pool;
  try {
    const schema = await import("../lib/db/src/index.ts");
    const { db, imageAssetsTable } = schema;
    pool = schema.pool;
    const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
    const { eq } = require("drizzle-orm");
    const { imageAssetStore: store } = await import("../artifacts/api-server/src/lib/image-asset-store.ts");
    const { imageAssetObjectKeys } = await import("../artifacts/api-server/src/lib/image-asset-keys.ts");
    const identity = () => ({
      scope: "synthetic:project:user", clientKey: randomUUID(), sourceSha256: "a".repeat(64),
      profile: "report", projectId: null, userId: null,
    });
    await t.test("50 simultaneous retries create one persistent identity", async () => {
      const input = identity();
      const claims = await Promise.all(Array.from({ length: 50 }, () => store.claim(input)));
      assert.equal(claims.filter(row => row.kind === "claimed").length, 1);
      assert.equal(claims.filter(row => row.kind === "in_progress").length, 49);
      assert.equal(new Set(claims.map(row => row.asset.id)).size, 1);
      await assert.rejects(store.claim({ ...input, sourceSha256: "b".repeat(64) }),
        error => error.code === "idempotency_content_conflict");
    });
    await t.test("ready requires a primary and required thumbnail; successful retries reuse it", async () => {
      const input = identity();
      const first = await store.claim(input);
      const { id, attemptToken } = first.asset;
      const firstKeys = imageAssetObjectKeys(id, attemptToken, "image/webp");
      await assert.rejects(store.markReady(id, attemptToken), error => error.code === "image_attempt_lost");
      // These are database transition tests, not a claim of durable objects.
      await store.markUploading(id, attemptToken, {
        storageKey: firstKeys.primary, storageBucket: "synthetic-bucket", thumbnailKey: null, printKey: null,
        mimeType: "image/webp", byteSize: 1000, width: 1600, height: 900,
      });
      await assert.rejects(store.markReady(id, attemptToken));
      await store.fail(id, attemptToken, "test_storage_failure", true);
      const retry = await store.claim(input);
      assert.equal(retry.kind, "claimed");
      assert.equal(retry.asset.id, id);
      assert.notEqual(retry.asset.attemptToken, attemptToken);
      assert.equal(retry.asset.attemptCount, 2);
      const retryKeys = imageAssetObjectKeys(id, retry.asset.attemptToken, "image/webp");
      await store.markUploading(id, retry.asset.attemptToken, {
        storageKey: retryKeys.primary, storageBucket: "synthetic-bucket", thumbnailKey: retryKeys.thumbnail, printKey: retryKeys.print,
        mimeType: "image/webp", byteSize: 1000, width: 1600, height: 900,
      });
      await store.markReady(id, retry.asset.attemptToken);
      await store.fail(id, attemptToken, "stale_failure", false);
      await assert.rejects(store.markReady(id, attemptToken), error => error.code === "image_attempt_lost");
      const lostResponseRetry = await store.claim(input);
      assert.equal(lostResponseRetry.kind, "ready");
      assert.equal(lostResponseRetry.asset.id, id);
      assert.equal(lostResponseRetry.asset.primaryState, "ready");
      assert.equal(lostResponseRetry.asset.thumbnailState, "ready");
      assert.equal(lostResponseRetry.asset.printState, "ready");
      assert.equal(lostResponseRetry.asset.attemptHistory[0].storageKey, firstKeys.primary);
    });
    await t.test("expired attempts can resume, terminal failures cannot be retried automatically", async () => {
      const input = identity();
      const first = await store.claim(input);
      await db.update(imageAssetsTable).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(imageAssetsTable.id, first.asset.id));
      const resumed = await store.claim(input);
      assert.equal(resumed.kind, "claimed");
      assert.notEqual(resumed.asset.attemptToken, first.asset.attemptToken);
      await store.fail(resumed.asset.id, resumed.asset.attemptToken, "invalid_image_content", false);
      assert.equal((await store.claim(input)).kind, "failed");
    });
    await t.test("identity fields never accept inline image data or arbitrary URLs", async () => {
      await assert.rejects(store.claim({ ...identity(), clientKey: "data:image/jpeg;base64,abc" }),
        error => error.code === "invalid_image_identity");
      const first = await store.claim(identity());
      await assert.rejects(store.markUploading(first.asset.id, first.asset.attemptToken, {
        storageKey: "uploads/../someone-else.jpg", storageBucket: "synthetic-bucket", thumbnailKey: null, printKey: null, mimeType: "image/jpeg",
        byteSize: 1000, width: 1, height: 1,
      }), error => error.code === "invalid_image_output_reference");
    });
  } finally {
    await pool?.end();
    await pg.stop();
  }
});

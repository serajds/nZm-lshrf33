import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

test("image lifecycle confirms real isolated storage before publishing a fenced identity", async t => {
  process.env.NODE_ENV = "development";
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const testBucket = process.env.IMAGE_AUDIT_BUCKET_ID;
  assert.ok(testBucket, "Explicit independent IMAGE_AUDIT_BUCKET_ID required");
  assert.ok(testBucket !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Separate test storage required");
  const pg = await isolatedPostgres();
  let pool, dir;
  const attemptedKeys = new Set();
  let cloud;
  try {
    // Refuse SDK access to any other bucket, without changing the default
    // configuration even in this private test process.
    const { objectStorageClient } = await import("../artifacts/api-server/src/lib/objectStorage.ts");
    const originalBucket = objectStorageClient.bucket.bind(objectStorageClient);
    objectStorageClient.bucket = (id, ...args) => {
      if (id !== testBucket) throw new Error("Nonisolated storage access refused");
      const bucket = originalBucket(id, ...args);
      const file = bucket.file.bind(bucket);
      bucket.file = (name, ...args) => {
        const object = file(name, ...args);
        const stream = object.createWriteStream.bind(object);
        object.createWriteStream = (...args) => {
          if (!/^uploads\/image-[a-f0-9-]+(?:-thumb|-print)?\.(?:webp|jpg|png)$/.test(name)) throw new Error("Unowned test object refused");
          attemptedKeys.add(name.slice("uploads/".length));
          return stream(...args);
        };
        return object;
      };
      return bucket;
    };
    const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
    const sharp = require("sharp");
    const schema = await import("../lib/db/src/index.ts");
    const { db, projectsTable, projectFilesTable } = schema;
    pool = schema.pool;
    const { imageAssetStore } = await import("../artifacts/api-server/src/lib/image-asset-store.ts");
    const { createImageLifecycle } = await import("../artifacts/api-server/src/lib/image-lifecycle.ts");
    const { createImageProcessor } = await import("../artifacts/api-server/src/lib/image-processing.ts");
    const { resolveStoredImageForRead } = await import("../artifacts/api-server/src/lib/image-read-reference.ts");
    const storage = await import("../artifacts/api-server/src/lib/fileStorage.ts");
    cloud = storage;
    const [{ id: projectId }] = await db.insert(projectsTable).values({
      name: "Synthetic lifecycle", location: "Synthetic", ownerEntity: "Synthetic",
      supervisorEntity: "Synthetic", contractor: "Synthetic",
    }).returning();
    await mkdir("generated-artifacts", { recursive: true });
    dir = await mkdtemp(path.resolve("generated-artifacts/image-lifecycle-"));
    const sourcePath = path.join(dir, "synthetic-source.jpg");
    await writeFile(sourcePath, await sharp({
      create: { width: 2400, height: 1800, channels: 3, background: "#527083" },
    }).jpeg().toBuffer());
    const processor = createImageProcessor({ workerPath: path.resolve("artifacts/api-server/dist/image-processing-worker.mjs") });
    const track = {
      upload: async (name, ...args) => {
        return storage.uploadBufferToCloud(name, args[0], args[1], { ...args[2], bucketId: testBucket });
      },
      verify: (name, expected, signal) => storage.verifyUploadObject(name, expected, signal, testBucket),
      delete: name => storage.deleteImageObjectStrict(name, testBucket),
    };
    const input = () => ({
      principal: `synthetic-user:${projectId}`, authorizedScope: `project:${projectId}:report`, clientKey: randomUUID(),
      userId: null, projectId, profile: "report", sourcePath,
      onCommit: async (tx, asset) => {
        const name = asset.storageKey.slice("uploads/".length);
        const [file] = await tx.insert(projectFilesTable).values({
          projectId, filename: name, originalName: "Synthetic", category: "image",
          fileUrl: `/api/uploads/${name}`, fileSize: asset.byteSize, mimeType: asset.mimeType,
        }).returning();
        return file.id;
      },
    });
    const normal = createImageLifecycle({ processor });
    await t.test("ready means primary, thumbnail and JPEG print are stored and only one file reference is committed", async () => {
      const request = input();
      const first = await normal.upload(request);
      assert.equal(first.image.state, "ready");
      assert.equal(first.image.width, 1600);
      assert.ok(first.image.thumbnailKey.endsWith("-thumb.webp"));
      assert.ok(first.image.printKey.endsWith("-print.jpg"));
      assert.ok(first.projectFileId);
      await assert.rejects(
        () => cloud.verifyUploadObject(first.image.storageKey.slice("uploads/".length), {
          byteSize: first.image.byteSize, mimeType: first.image.mimeType, sha256: "0".repeat(64),
        }, undefined, testBucket),
        /stored_image_hash_mismatch/,
      );
      const before = attemptedKeys.size;
      const repeated = await normal.upload(request);
      assert.equal(repeated.image.id, first.image.id);
      assert.equal(repeated.projectFileId, first.projectFileId);
      assert.equal(attemptedKeys.size, before, "Lost response retry must not write again");
      const rows = await db.select().from(projectFilesTable);
      assert.equal(rows.length, 1);
    });
    await t.test("a lost storage acknowledgement is verified without duplicate creation", async () => {
      let first = true;
      const lifecycle = createImageLifecycle({ processor, storage: {
        ...track,
        upload: async (...args) => {
          await track.upload(...args);
          if (first) { first = false; throw new Error("simulated_lost_acknowledgement"); }
        },
      } });
      assert.equal((await lifecycle.upload(input())).image.state, "ready");
    });
    await t.test("partial storage failure is not success; retry reuses identity with a new fenced attempt", async () => {
      let calls = 0;
      const request = input();
      const lifecycle = createImageLifecycle({ processor, storage: {
        ...track, upload: async (...args) => {
          if (++calls === 2) throw new Error("simulated_storage_unavailable");
          return track.upload(...args);
        },
      } });
      await assert.rejects(lifecycle.upload(request), error => error.code === "image_storage_or_commit_failed" && error.retryable);
      const retried = await normal.upload(request);
      const row = await imageAssetStore.get(retried.image.id);
      assert.equal(row.attemptCount, 2);
      assert.equal(row.attemptHistory.length, 1);
      assert.notEqual(row.storageKey, row.attemptHistory[0].storageKey);
      assert.equal(await storage.getUploadObjectSize(row.attemptHistory[0].storageKey.slice("uploads/".length), testBucket), null);
      assert.equal(row.cleanupPending, true, "Uncertain old attempts remain discoverable after a successful retry");
    });
    await t.test("a failed reference transaction rolls back and a retry publishes one file", async () => {
      const request = input();
      let fail = true;
      const commit = request.onCommit;
      request.onCommit = async (...args) => {
        const id = await commit(...args);
        if (fail) { fail = false; throw new Error("simulated_reference_failure"); }
        return id;
      };
      const before = (await db.select().from(projectFilesTable)).length;
      await assert.rejects(normal.upload(request));
      assert.equal((await db.select().from(projectFilesTable)).length, before);
      await normal.upload(request);
      assert.equal((await db.select().from(projectFilesTable)).length, before + 1);
    });
    await t.test("a lost COMMIT acknowledgement never deletes successfully published objects", async () => {
      const lifecycle = createImageLifecycle({ processor, storage: track, store: {
        ...imageAssetStore,
        markReady: async (...args) => {
          await imageAssetStore.markReady(...args);
          throw new Error("simulated_commit_acknowledgement_loss");
        },
      } });
      const result = await lifecycle.upload(input());
      assert.equal(result.image.state, "ready");
      assert.ok(await storage.getUploadObjectSize(result.image.storageKey.slice("uploads/".length), testBucket));
    });
    await t.test("cancelled input never starts storage or leaks an admission lease", async () => {
      const controller = new AbortController();
      controller.abort();
      const count = attemptedKeys.size;
      await assert.rejects(normal.upload({ ...input(), signal: controller.signal }), error => error.code === "cancelled");
      assert.equal(attemptedKeys.size, count);
    });
    await t.test("read resolution selects stored variants without conversion or storage writes", async () => {
      const result = await normal.upload(input());
      const filename = result.image.storageKey.slice("uploads/".length);
      const writes = attemptedKeys.size;
      const thumbnail = await resolveStoredImageForRead(filename, "thumbnail");
      const print = await resolveStoredImageForRead(filename, "print");
      const preview = await resolveStoredImageForRead(filename, "report");
      assert.equal(thumbnail.kind, "ready");
      assert.ok(thumbnail.bucketId === testBucket);
      assert.ok(thumbnail.filename.endsWith("-thumb.webp"));
      assert.equal(print.mimeType, "image/jpeg");
      assert.equal(preview.storageKey, print.storageKey);
      assert.equal(preview.mimeType, "image/jpeg");
      assert.equal(attemptedKeys.size, writes);
      assert.equal((await resolveStoredImageForRead("legacy-synthetic.jpg", "thumbnail")).kind, "legacy");
    });
    await t.test("JPEG fallback shares its print object instead of recompressing and storing it twice", async () => {
      const before = attemptedKeys.size;
      const result = await normal.upload({ ...input(), format: "jpeg" });
      assert.equal(result.image.mimeType, "image/jpeg");
      assert.equal(result.image.printKey, result.image.storageKey);
      assert.ok(result.image.thumbnailKey.endsWith("-thumb.jpg"));
      assert.equal(attemptedKeys.size - before, 2);
      const print = await resolveStoredImageForRead(result.image.storageKey.slice("uploads/".length), "print");
      assert.equal(print.mimeType, "image/jpeg");
    });
  } finally {
    // Exact names recorded before SDK calls, not an inventory/orphan sweep.
    let cleanupFailures = 0;
    if (cloud) for (const key of attemptedKeys) {
      try { await cloud.deleteFromCloudStrict(key, testBucket); } catch { cleanupFailures++; }
    }
    try { await pool?.end(); } finally { await pg.stop(); }
    if (dir) await rm(dir, { recursive: true, force: true });
    assert.equal(cleanupFailures, 0, "Synthetic object cleanup must finish");
  }
});
